import type { GitCommitInfo, SessionInfo } from '../types.js';

/**
 * Deterministic significance scoring (0-100), ported from the BragVault
 * Electron folder-observer prototype and extended with merge/tag bonuses
 * and session scoring. No model calls.
 */

export function scoreCommit(commit: GitCommitInfo): number {
  let score = 0;

  const message = commit.message.toLowerCase();
  if (message.includes('feat:') || message.includes('feature')) score += 30;
  if (message.includes('fix:') || message.includes('bug')) score += 25;
  if (message.includes('refactor:')) score += 15;
  if (message.includes('perf:') || message.includes('performance')) score += 20;
  if (message.includes('release') || message.includes('launch') || message.includes('ship')) score += 20;
  if (message.includes('migrat')) score += 15;

  const linesChanged = commit.insertions + commit.deletions;
  if (commit.filesChanged > 5) score += 20;
  if (linesChanged > 100) score += 20;
  if (linesChanged > 1000) score += 10;

  if (commit.isMerge) score += 15;
  if (commit.tags.length > 0) score += 30;

  return Math.min(score, 100);
}

export function scoreSession(session: SessionInfo): number {
  let score = 0;
  if ((session.durationMinutes ?? 0) >= 15) score += 20;
  if ((session.durationMinutes ?? 0) >= 60) score += 15;
  if ((session.filesTouchedCount ?? 0) >= 3) score += 20;
  if ((session.filesTouchedCount ?? 0) >= 10) score += 15;
  if ((session.promptCount ?? 0) >= 5) score += 10;
  if ((session.toolUseCount ?? 0) >= 20) score += 10;
  return Math.min(score, 100);
}
