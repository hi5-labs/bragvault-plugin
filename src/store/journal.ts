import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { journalDir } from './paths.js';
import type { JournalEvent } from '../types.js';

/**
 * Append-only NDJSON journal, rotated monthly. This is the user's raw local
 * history; it is never uploaded.
 */

export function newEventId(): string {
  return `evt_${crypto.randomBytes(10).toString('hex')}`;
}

function fileForDate(date: Date): string {
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return path.join(journalDir(), `${month}.ndjson`);
}

export function appendToJournal(event: JournalEvent): void {
  fs.mkdirSync(journalDir(), { recursive: true, mode: 0o700 });
  const file = fileForDate(new Date(event.capturedAt));
  fs.appendFileSync(file, JSON.stringify(event) + '\n', { mode: 0o600 });
  // mkdir/append modes only apply on creation; tighten pre-existing paths too.
  try {
    fs.chmodSync(journalDir(), 0o700);
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort on platforms without POSIX modes
  }
}

/** Read journal events, newest months first, up to `limit` events. */
export function readRecentEvents(limit = 50): JournalEvent[] {
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(journalDir())
      .filter((f) => f.endsWith('.ndjson'))
      .sort()
      .reverse();
  } catch {
    return [];
  }

  const events: JournalEvent[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(journalDir(), file), 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        events.push(JSON.parse(line) as JournalEvent);
      } catch {
        // skip corrupt line
      }
    }
    if (events.length >= limit) break;
  }
  return events;
}

/** True if a git commit hash has already been journaled (dedup across restarts). */
export function hasJournaledCommit(commitHash: string, repoKey: string | undefined, recent: JournalEvent[]): boolean {
  return recent.some(
    (e) =>
      e.kind === 'git_commit' &&
      e.git?.hash === commitHash &&
      (repoKey === undefined || e.repo?.remoteHash === repoKey || e.repo?.name === repoKey),
  );
}
