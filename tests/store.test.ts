import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendToJournal, newEventId, readRecentEvents, hasJournaledCommit } from '../src/store/journal.js';
import { enqueue, listQueued, ack, queueDepth } from '../src/store/queue.js';
import { loadConfig, saveConfig, DEFAULT_CONFIG, isRepoDenied } from '../src/store/config.js';
import { loadCredentials, saveCredentials, clearCredentials } from '../src/store/credentials.js';
import { loadState, saveState } from '../src/store/state.js';
import type { JournalEvent, QueuedEvent } from '../src/types.js';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'bragvault-test-'));
  process.env.BRAGVAULT_HOME = home;
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.BRAGVAULT_HOME;
});

function journalEvent(overrides: Partial<JournalEvent> = {}): JournalEvent {
  return {
    id: newEventId(),
    kind: 'git_commit',
    occurredAt: new Date().toISOString(),
    capturedAt: new Date().toISOString(),
    sourceTool: 'claude-code',
    significance: 40,
    git: {
      hash: 'deadbeef',
      message: 'feat: thing',
      filesChanged: 2,
      insertions: 10,
      deletions: 1,
      fileTypes: { '.ts': 2 },
      isMerge: false,
      tags: [],
    },
    repo: { name: 'demo', remoteHash: 'r1' },
    ...overrides,
  };
}

describe('journal', () => {
  it('appends and reads back newest first', () => {
    const a = journalEvent();
    const b = journalEvent({ git: { ...a.git!, hash: 'cafe1234' } });
    appendToJournal(a);
    appendToJournal(b);
    const events = readRecentEvents(10);
    expect(events).toHaveLength(2);
    expect(events[0]!.git!.hash).toBe('cafe1234');
  });

  it('detects already-journaled commits', () => {
    const a = journalEvent();
    appendToJournal(a);
    const recent = readRecentEvents(10);
    expect(hasJournaledCommit('deadbeef', 'r1', recent)).toBe(true);
    expect(hasJournaledCommit('other', 'r1', recent)).toBe(false);
  });
});

describe('queue', () => {
  function queued(id: string): QueuedEvent {
    return {
      clientEventId: id,
      kind: 'manual_brag',
      occurredAt: new Date().toISOString(),
      sourceTool: 'cursor',
      significance: 80,
      structured: { title: 'T', summary: 'Did a thing.' },
      evidence: [],
    };
  }

  it('enqueues, lists, and acks', () => {
    enqueue(queued('11111111-1111-1111-1111-111111111111'));
    enqueue(queued('22222222-2222-2222-2222-222222222222'));
    expect(queueDepth()).toBe(2);
    expect(listQueued()).toHaveLength(2);
    ack('11111111-1111-1111-1111-111111111111');
    expect(queueDepth()).toBe(1);
    expect(listQueued()[0]!.clientEventId).toBe('22222222-2222-2222-2222-222222222222');
  });
});

describe('config', () => {
  it('returns defaults when no file exists', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('merges user overrides over defaults', () => {
    saveConfig({ ...DEFAULT_CONFIG, sync: { ...DEFAULT_CONFIG.sync, enabled: false } });
    const cfg = loadConfig();
    expect(cfg.sync.enabled).toBe(false);
    expect(cfg.capture.git.pollIntervalMs).toBe(DEFAULT_CONFIG.capture.git.pollIntervalMs);
  });

  it('honors the repo deny list', () => {
    const cfg = { ...DEFAULT_CONFIG, capture: { ...DEFAULT_CONFIG.capture, denyRepos: ['secret-repo'] } };
    expect(isRepoDenied(cfg, '/home/me/secret-repo')).toBe(true);
    expect(isRepoDenied(cfg, '/home/me/public-repo')).toBe(false);
  });
});

describe('credentials', () => {
  it('round-trips and enforces 0600', () => {
    saveCredentials({ token: 'bv_test_token_1234567890', email: 'a@b.c' });
    const creds = loadCredentials();
    expect(creds?.token).toBe('bv_test_token_1234567890');
    const mode = fs.statSync(path.join(home, 'credentials.json')).mode & 0o777;
    expect(mode).toBe(0o600);
    clearCredentials();
    expect(loadCredentials()).toBeNull();
  });
});

describe('state', () => {
  it('creates a stable device id and persists cursors', () => {
    const s1 = loadState();
    expect(s1.deviceId).toMatch(/^dev_/);
    s1.repoCursors['r1'] = 'abc';
    saveState(s1);
    const s2 = loadState();
    expect(s2.deviceId).toBe(s1.deviceId);
    expect(s2.repoCursors['r1']).toBe('abc');
  });
});
