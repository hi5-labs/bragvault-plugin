import fs from 'node:fs';
import path from 'node:path';
import { bragvaultHome } from './paths.js';

const LOCK_STALE_MS = 5_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 2_000;

/**
 * Small inter-process mutex via O_EXCL lockfile. Guards read-modify-write of
 * shared state between the MCP server and hook processes. Stale locks (from
 * killed processes) are broken after LOCK_STALE_MS.
 */
export function withFileLock<T>(name: string, fn: () => T): T {
  const lockPath = path.join(bragvaultHome(), `${name}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | null = null;

  for (;;) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        // Can't lock (e.g. read-only home): run unguarded rather than fail.
        return fn();
      }
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue; // lock disappeared between open and stat
      }
      if (Date.now() > deadline) {
        // Give up waiting rather than deadlock; worst case is the pre-lock
        // last-writer-wins behavior.
        return fn();
      }
      const waitUntil = Date.now() + LOCK_RETRY_MS;
      while (Date.now() < waitUntil) {
        // Busy-wait; these critical sections are single-digit milliseconds.
      }
    }
  }

  try {
    return fn();
  } finally {
    try {
      if (fd !== null) fs.closeSync(fd);
      fs.unlinkSync(lockPath);
    } catch {
      // already cleaned up
    }
  }
}
