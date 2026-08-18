import fs from 'node:fs';
import crypto from 'node:crypto';
import { statePath } from './paths.js';
import { ensureHome } from './config.js';
import { atomicWriteFileSync } from './atomicWrite.js';
import { withFileLock } from './lock.js';

export interface PluginState {
  deviceId: string;
  /** last-seen commit hash per repo remoteHash (or basename when no remote) */
  repoCursors: Record<string, string>;
  lastSyncAt?: string;
  /** in-flight device pairing: poll credential per user code */
  pendingAuth?: { code: string; deviceSecret: string; startedAt: string };
}

function readState(): PluginState | null {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    return JSON.parse(raw) as PluginState;
  } catch {
    return null;
  }
}

function writeState(state: PluginState): void {
  ensureHome();
  atomicWriteFileSync(statePath(), JSON.stringify(state, null, 2) + '\n', 0o600);
}

/**
 * Load state, creating and persisting it on first use so every caller
 * (watcher, syncer, hooks) agrees on the deviceId.
 */
export function loadState(): PluginState {
  const existing = readState();
  if (existing) return existing;
  const fresh: PluginState = {
    deviceId: `dev_${crypto.randomBytes(8).toString('hex')}`,
    repoCursors: {},
  };
  try {
    writeState(fresh);
  } catch {
    // read-only environments still get a usable in-memory state
  }
  return readState() ?? fresh;
}

export function saveState(state: PluginState): void {
  writeState(state);
}

/**
 * Read-modify-write helper: re-reads the file immediately before writing so
 * concurrent writers (git watcher cursor vs syncer lastSyncAt vs hook
 * process) don't clobber each other's fields.
 */
export function updateState(mutate: (state: PluginState) => void): PluginState {
  return withFileLock('state', () => {
    const state = loadState();
    mutate(state);
    writeState(state);
    return state;
  });
}
