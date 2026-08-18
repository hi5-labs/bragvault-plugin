import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueue, listQueued, queueDepth } from '../src/store/queue.js';
import { saveCredentials } from '../src/store/credentials.js';
import { DEFAULT_CONFIG } from '../src/store/config.js';
import { flushQueue, toWireEvent } from '../src/sync/syncer.js';
import { findOverlappingCandidates } from '../src/capture/correlate.js';
import type { QueuedEvent } from '../src/types.js';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'bragvault-test-'));
  process.env.BRAGVAULT_HOME = home;
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.BRAGVAULT_HOME;
  vi.restoreAllMocks();
});

function queued(id: string, overrides: Partial<QueuedEvent> = {}): QueuedEvent {
  return {
    clientEventId: id,
    kind: 'git_commit',
    occurredAt: '2026-08-17T12:00:00Z',
    sourceTool: 'cursor',
    significance: 40,
    structured: { title: 'feat: sync', summary: 'Committed "feat: sync" in demo.' },
    repo: { name: 'demo', remoteHash: 'r1' },
    git: {
      hash: 'abc123',
      message: 'feat: sync password=SuperSecret99x',
      filesChanged: 1,
      insertions: 10,
      deletions: 0,
      fileTypes: { '.ts': 1 },
      isMerge: false,
      tags: [],
    },
    evidence: ['evt_1'],
    ...overrides,
  };
}

describe('toWireEvent', () => {
  it('redacts secrets and applies privacy settings', () => {
    const wire = toWireEvent(queued('id-1-aaaaaaaa'), 'dev_x', DEFAULT_CONFIG);
    expect(wire.source.commit_message).toContain('[REDACTED:secret]');
    expect(wire.source.repo).toBe('demo');
    expect(wire.source.device_id).toBe('dev_x');
  });

  it('omits commit messages and repo names when configured off', () => {
    const config = {
      ...DEFAULT_CONFIG,
      privacy: { shareCommitMessages: false, shareRepoName: false },
    };
    const wire = toWireEvent(queued('id-2-aaaaaaaa'), 'dev_x', config);
    expect(wire.source.commit_message).toBeUndefined();
    expect(wire.source.repo).toBeUndefined();
    expect(wire.source.repo_hash).toBe('r1');
  });
});

describe('flushQueue', () => {
  it('reports not connected without credentials and keeps the queue', async () => {
    enqueue(queued('id-3-aaaaaaaa'));
    const result = await flushQueue(DEFAULT_CONFIG);
    expect(result.error).toContain('not connected');
    expect(queueDepth()).toBe(1);
  });

  it('acks synced events on success', async () => {
    saveCredentials({ token: 'bv_test' });
    enqueue(queued('id-4-aaaaaaaa'));
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, results: [{ client_event_id: 'id-4-aaaaaaaa', id: 7, status: 'processed', deduplicated: false }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const result = await flushQueue(DEFAULT_CONFIG);
    expect(result.synced).toBe(1);
    expect(queueDepth()).toBe(0);
  });

  it('keeps the queue on server errors', async () => {
    saveCredentials({ token: 'bv_test' });
    enqueue(queued('id-5-aaaaaaaa'));
    global.fetch = vi.fn(async () => new Response('oops', { status: 500 })) as unknown as typeof fetch;
    const result = await flushQueue(DEFAULT_CONFIG);
    expect(result.failed).toBe(1);
    expect(queueDepth()).toBe(1);
  });

  it('acks deduplicated events', async () => {
    saveCredentials({ token: 'bv_test' });
    enqueue(queued('id-6-aaaaaaaa'));
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, results: [{ client_event_id: 'id-6-aaaaaaaa', id: 7, status: 'processed', deduplicated: true }] }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const result = await flushQueue(DEFAULT_CONFIG);
    expect(result.deduplicated).toBe(1);
    expect(queueDepth()).toBe(0);
  });
});

describe('findOverlappingCandidates', () => {
  it('finds same-repo commits within the window without deleting them', () => {
    enqueue(queued('commit-1-aaaa', { occurredAt: '2026-08-17T11:30:00Z' }));
    enqueue(queued('commit-2-aaaa', { occurredAt: '2026-08-17T09:00:00Z' })); // outside 2h window

    const brag = queued('brag-1-aaaaaa', {
      kind: 'manual_brag',
      occurredAt: '2026-08-17T12:00:00Z',
      git: undefined,
      evidence: ['evt_brag'],
    });
    const { evidence, commitHashes, absorbedIds } = findOverlappingCandidates(brag);
    expect(commitHashes).toEqual(['abc123']);
    expect(evidence).toContain('evt_brag');
    expect(absorbedIds).toEqual(['commit-1-aaaa']);
    // finding does not delete; the caller acks after enqueueing the merge
    expect(listQueued()).toHaveLength(2);
  });

  it('does not match other repos', () => {
    enqueue(queued('commit-other-a', { repo: { name: 'other', remoteHash: 'r2' } }));
    const brag = queued('brag-2-aaaaaa', { kind: 'manual_brag', git: undefined });
    const { commitHashes, absorbedIds } = findOverlappingCandidates(brag);
    expect(commitHashes).toEqual([]);
    expect(absorbedIds).toEqual([]);
  });

  it('does not match when the accomplishment has no repo', () => {
    enqueue(queued('commit-3-aaaa'));
    const brag = queued('brag-3-aaaaaa', { kind: 'manual_brag', git: undefined, repo: undefined });
    expect(findOverlappingCandidates(brag).absorbedIds).toEqual([]);
  });

  it('requires remote-hash equality when either side has one', () => {
    enqueue(queued('commit-4-aaaa', { repo: { name: 'app', remoteHash: 'hash-a' } }));
    const brag = queued('brag-4-aaaaaa', { kind: 'manual_brag', git: undefined, repo: { name: 'app', remoteHash: 'hash-b' } });
    expect(findOverlappingCandidates(brag).absorbedIds).toEqual([]);
  });
});
