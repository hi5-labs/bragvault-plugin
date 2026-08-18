import { listQueued } from '../store/queue.js';
import type { QueuedEvent, RepoInfo } from '../types.js';

/** Commits within this window of an agent-logged accomplishment are treated as
 * the same piece of work and absorbed as evidence instead of syncing twice. */
const WINDOW_MS = 2 * 60 * 60 * 1000;

function sameRepo(a: RepoInfo, b: RepoInfo): boolean {
  // A remote hash is authoritative; two repos that both have one must match
  // on it (equal basenames like "app" are not enough).
  if (a.remoteHash || b.remoteHash) return a.remoteHash === b.remoteHash;
  return a.name === b.name;
}

/**
 * Find passive git candidates describing the same work as an agent-logged
 * accomplishment (same repo, within the time window). Returns their evidence
 * plus the queue ids to acknowledge — the caller must enqueue the merged
 * event FIRST and only then ack the absorbed ids, so a crash between the two
 * steps duplicates rather than loses events.
 */
export function findOverlappingCandidates(accomplishment: QueuedEvent): {
  evidence: string[];
  commitHashes: string[];
  absorbedIds: string[];
} {
  const evidence: string[] = [...accomplishment.evidence];
  const commitHashes: string[] = [];
  const absorbedIds: string[] = [];
  const at = Date.parse(accomplishment.occurredAt);

  for (const queued of listQueued()) {
    if (queued.clientEventId === accomplishment.clientEventId) continue;
    if (queued.kind !== 'git_commit') continue;
    // Absorb only on a positive same-repo match; unknown repos never absorb.
    if (!accomplishment.repo || !queued.repo) continue;
    if (!sameRepo(accomplishment.repo, queued.repo)) continue;
    const delta = Math.abs(Date.parse(queued.occurredAt) - at);
    if (Number.isNaN(delta) || delta > WINDOW_MS) continue;

    evidence.push(...queued.evidence);
    if (queued.git?.hash) commitHashes.push(queued.git.hash);
    absorbedIds.push(queued.clientEventId);
  }

  return { evidence: [...new Set(evidence)], commitHashes, absorbedIds };
}
