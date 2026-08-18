import type { BragvaultConfig } from '../store/config.js';
import { isRepoDenied } from '../store/config.js';
import { loadState, updateState } from '../store/state.js';
import { appendToJournal, newEventId, readRecentEvents, hasJournaledCommit } from '../store/journal.js';
import type { JournalEvent } from '../types.js';
import { countRange, isGitRepo, listCommits, nthOldestInRange, repoInfo, repoRoot, toCommitInfo, userEmail } from './git.js';
import { withFileLock } from '../store/lock.js';
import { scoreCommit } from './significance.js';
import { commitToStructured } from './templates.js';

export type CandidateHandler = (event: JournalEvent) => void;

/**
 * Passive git capture for one workspace. Runs inside the MCP server process:
 * polls `git log` and journals the user's own new commits. On start it
 * backfills from the persisted per-repo cursor, covering commits made while
 * no editor session was open.
 */
export class GitWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repoPath: string,
    private readonly config: BragvaultConfig,
    private readonly onCandidate: CandidateHandler,
  ) {}

  async start(): Promise<void> {
    if (!this.config.capture.git.enabled) return;
    if (!(await isGitRepo(this.repoPath))) return;
    // Deny-check the canonical repo root so starting in a subdirectory
    // cannot bypass a basename or path entry.
    const root = await repoRoot(this.repoPath).catch(() => this.repoPath);
    if (isRepoDenied(this.config, root)) return;

    this.running = true;
    try {
      await this.poll(true);
    } catch {
      // Startup capture must never take the MCP server down; retry on the next tick.
    }
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.poll(false);
      } catch {
        // git failures (locks, detached worktrees) are expected; retry next tick
      }
      this.timer = setTimeout(tick, this.config.capture.git.pollIntervalMs);
      this.timer.unref?.();
    };
    this.timer = setTimeout(tick, this.config.capture.git.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Cap per poll so a huge offline range cannot overflow git's stdout
   * buffer; the cursor advances page by page across successive polls. */
  private static readonly PAGE_SIZE = 500;

  private async poll(isBackfill: boolean): Promise<void> {
    const info = await repoInfo(this.repoPath);
    const repoKey = info.remoteHash ?? info.name;
    const state = loadState();
    const cursor = state.repoCursors[repoKey];

    let endRev: string | undefined;
    if (cursor) {
      const total = await countRange(this.repoPath, cursor);
      if (total > GitWatcher.PAGE_SIZE) {
        endRev = (await nthOldestInRange(this.repoPath, cursor, GitWatcher.PAGE_SIZE, total)) ?? undefined;
      }
    }

    const commits = await listCommits(
      this.repoPath,
      cursor ? { sinceHash: cursor, endRev } : { maxCount: isBackfill ? 10 : 1 },
    );
    if (commits.length === 0) return;

    // Without a configured author identity we cannot distinguish the user's
    // commits from teammates' (e.g. after a pull) — capture nothing.
    const email = await userEmail(this.repoPath);
    if (!email) return;

    // Dedup-check + journal + cursor advance form one inter-process critical
    // section so two editors watching the same repo don't double-journal.
    withFileLock('capture', () => {
      const recent = readRecentEvents(500);

      // Oldest first so journal order is chronological.
      for (const raw of [...commits].reverse()) {
        // After a `git pull`, teammates' commits appear too; only capture our own.
        if (raw.authorEmail.toLowerCase() !== email.toLowerCase()) continue;
        if (hasJournaledCommit(raw.hash, repoKey, recent)) continue;

        const commit = toCommitInfo(raw);
        const significance = scoreCommit(commit);
        const event: JournalEvent = {
          id: newEventId(),
          kind: 'git_commit',
          occurredAt: raw.authoredAt,
          capturedAt: new Date().toISOString(),
          sourceTool: process.env.BRAGVAULT_SOURCE_TOOL ?? 'unknown',
          repo: info,
          git: commit,
          structured: commitToStructured(commit, info),
          significance,
        };
        // Enqueue before journaling: a crash in between leaves the commit
        // unmarked and it is reprocessed next poll (the deterministic queue id
        // and server-side commit dedupe make the retry harmless). The reverse
        // order would mark it seen and permanently skip the sync.
        if (significance >= this.config.capture.git.minSignificance) {
          this.onCandidate(event);
        }
        appendToJournal(event);
      }

      const newest = commits[0];
      if (newest) {
        updateState((s) => {
          s.repoCursors[repoKey] = newest.hash;
        });
      }
    });
  }
}
