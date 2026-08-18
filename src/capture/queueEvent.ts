import crypto from 'node:crypto';
import { appendToJournal, newEventId } from '../store/journal.js';
import { enqueue, ack } from '../store/queue.js';
import { findOverlappingCandidates } from './correlate.js';
import type { JournalEvent, QueuedEvent, StructuredAccomplishment } from '../types.js';

export interface QueueExtras {
  repo?: JournalEvent['repo'];
  git?: JournalEvent['git'];
  session?: JournalEvent['session'];
  occurredAt?: string;
  sourceTool?: string;
}

/**
 * Shared path for journaling + queueing a structured event, used by MCP tools
 * and hook entrypoints alike so both get correlation (absorbing overlapping
 * passive git candidates) with crash-safe ordering: the merged event is
 * enqueued before the absorbed candidates are acknowledged.
 */
export function queueStructuredEvent(
  kind: JournalEvent['kind'],
  structured: StructuredAccomplishment,
  extras: QueueExtras,
  significance: number,
): QueuedEvent {
  const sourceTool = extras.sourceTool ?? process.env.BRAGVAULT_SOURCE_TOOL ?? 'unknown';
  const journalEvent: JournalEvent = {
    id: newEventId(),
    kind,
    occurredAt: extras.occurredAt ?? new Date().toISOString(),
    capturedAt: new Date().toISOString(),
    sourceTool,
    repo: extras.repo,
    git: extras.git,
    session: extras.session,
    structured,
    significance,
  };

  const queued: QueuedEvent = {
    clientEventId: crypto.randomUUID(),
    kind,
    occurredAt: journalEvent.occurredAt,
    sourceTool,
    significance,
    structured,
    repo: extras.repo,
    git: extras.git,
    session: extras.session,
    evidence: [journalEvent.id],
  };

  // Enqueue the merged event before removing what it absorbs: a crash in
  // between duplicates events (server dedupes) instead of losing them.
  const { evidence, commitHashes, absorbedIds } = findOverlappingCandidates(queued);
  queued.evidence = [...evidence, ...commitHashes];
  enqueue(queued);
  for (const id of absorbedIds) ack(id);
  appendToJournal(journalEvent);
  return queued;
}

/** Deterministic, retry-stable queue id for a passive git commit. */
export function commitClientEventId(repoKey: string, commitHash: string): string {
  const digest = crypto.createHash('sha256').update(`${repoKey}:${commitHash}`).digest('hex');
  return `git-${digest.slice(0, 32)}`;
}
