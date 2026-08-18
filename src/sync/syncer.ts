import type { BragvaultConfig } from '../store/config.js';
import { loadCredentials } from '../store/credentials.js';
import { loadState, updateState } from '../store/state.js';
import { listQueued, ack } from '../store/queue.js';
import { redactDeep } from '../privacy/redact.js';
import type { QueuedEvent } from '../types.js';
import { ApiError, BragvaultClient } from './client.js';
import type { WireEvent } from './types.js';

export const PLUGIN_VERSION = '0.1.0';

/**
 * Apply the privacy settings to a passive event's structured fields. The
 * deterministic templates embed the commit subject and repo name; when
 * sharing is off, regenerate stats-only text so those never leave the
 * machine through title/summary/context either.
 */
function privacySafeStructured(event: QueuedEvent, config: BragvaultConfig) {
  const structured = { ...event.structured };
  const hideMessage = !config.privacy.shareCommitMessages && event.kind === 'git_commit';
  const hideRepo = !config.privacy.shareRepoName;

  if (event.kind === 'git_commit' && event.git && (hideMessage || hideRepo)) {
    const linesChanged = event.git.insertions + event.git.deletions;
    const kindWord = event.git.tags.length > 0 ? 'Tagged release' : event.git.isMerge ? 'Merged branch' : 'Committed';
    const scope = `${event.git.filesChanged} file${event.git.filesChanged === 1 ? '' : 's'}, ${linesChanged} line${linesChanged === 1 ? '' : 's'} changed`;
    const where = hideRepo || !event.repo ? '' : ` in ${event.repo.name}`;
    if (hideMessage) {
      structured.title = `${kindWord} (${scope})`;
      structured.summary = `${kindWord}${where} (${scope}).`;
    } else {
      structured.summary = `${kindWord} "${structured.title}"${where} (${scope}).`;
    }
  }
  if (hideRepo) {
    if (event.kind === 'session_summary' && event.repo) {
      structured.title = structured.title.replace(` in ${event.repo.name}`, '');
      structured.summary = structured.summary.replace(` in ${event.repo.name}`, '');
    }
    // Branch names can identify a repo; drop the templated context too.
    if (structured.context && /^branch /.test(structured.context)) structured.context = null;
  }
  return structured;
}

export function toWireEvent(event: QueuedEvent, deviceId: string, config: BragvaultConfig): WireEvent {
  const structured = privacySafeStructured(event, config);
  const wire: WireEvent = {
    client_event_id: event.clientEventId,
    kind: event.kind,
    occurred_at: event.occurredAt,
    significance: event.significance,
    title: structured.title,
    summary: structured.summary,
    category: structured.category ?? null,
    impact: structured.impact ?? null,
    context: structured.context ?? null,
    technologies: structured.technologies ?? [],
    source: {
      tool: event.sourceTool,
      plugin_version: PLUGIN_VERSION,
      device_id: deviceId,
      repo: config.privacy.shareRepoName ? event.repo?.name : undefined,
      repo_hash: event.repo?.remoteHash,
      branch: config.privacy.shareRepoName ? event.repo?.branch : undefined,
      commit_sha: event.git?.hash,
      commit_message: config.privacy.shareCommitMessages ? event.git?.message : undefined,
      files_changed: event.git?.filesChanged,
      additions: event.git?.insertions,
      deletions: event.git?.deletions,
      session_duration_minutes: event.session?.durationMinutes,
      evidence_commits: event.evidence.filter((e) => !e.startsWith('evt_')),
    },
  };
  // Redaction is the last step before the payload leaves the machine.
  return redactDeep(wire);
}

export interface SyncResult {
  attempted: number;
  synced: number;
  deduplicated: number;
  failed: number;
  error?: string;
}

/**
 * Flush the queue in batches. Safe to call any time: no credentials or
 * sync disabled means it reports zero work without touching the network.
 */
export async function flushQueue(config: BragvaultConfig): Promise<SyncResult> {
  const result: SyncResult = { attempted: 0, synced: 0, deduplicated: 0, failed: 0 };
  if (!config.sync.enabled) return { ...result, error: 'sync disabled in config' };
  const creds = loadCredentials();
  if (!creds) return { ...result, error: 'not connected (run the connect tool)' };

  const queued = listQueued();
  if (queued.length === 0) return result;

  const state = loadState();
  const client = new BragvaultClient(config.endpoint, creds.token);

  for (let i = 0; i < queued.length; i += config.sync.batchSize) {
    const batch = queued.slice(i, i + config.sync.batchSize);
    result.attempted += batch.length;
    const batchIds = new Set(batch.map((e) => e.clientEventId));
    try {
      const response = await client.ingestBatch({
        events: batch.map((e) => toWireEvent(e, state.deviceId, config)),
      });
      for (const r of response.results) {
        // Never act on ids the server invented — only ack what we sent.
        if (!r.client_event_id || !batchIds.has(r.client_event_id)) continue;
        if (r.error) {
          result.failed += 1;
          // Validation rejects are permanent: drop so the queue can't wedge.
          ack(r.client_event_id);
        } else {
          if (r.deduplicated) result.deduplicated += 1;
          else result.synced += 1;
          ack(r.client_event_id);
        }
      }
    } catch (err) {
      result.failed += batch.length;
      result.error = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // Auth/validation problems affect the whole queue; stop now.
        break;
      }
      // Network/5xx: leave the batch queued and let the next flush retry.
      break;
    }
  }

  if (result.synced > 0 || result.deduplicated > 0) {
    updateState((s) => {
      s.lastSyncAt = new Date().toISOString();
    });
  }
  return result;
}

/** Periodic background flusher with exponential backoff on failures. */
export class Syncer {
  private timer: NodeJS.Timeout | null = null;
  private backoffMs = 0;
  private stopped = false;

  constructor(private readonly config: BragvaultConfig) {}

  start(): void {
    const tick = async () => {
      if (this.stopped) return;
      const result = await flushQueue(this.config).catch(() => null);
      if (result && result.failed > 0 && result.error && !result.error.includes('not connected')) {
        this.backoffMs = Math.min(this.backoffMs === 0 ? 30_000 : this.backoffMs * 2, 30 * 60_000);
      } else {
        this.backoffMs = 0;
      }
      this.timer = setTimeout(tick, this.config.sync.flushIntervalMs + this.backoffMs);
      this.timer.unref?.();
    };
    this.timer = setTimeout(tick, 5_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
