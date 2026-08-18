import { describe, expect, it } from 'vitest';
import { scoreCommit, scoreSession } from '../src/capture/significance.js';
import type { GitCommitInfo } from '../src/types.js';

function commit(overrides: Partial<GitCommitInfo> = {}): GitCommitInfo {
  return {
    hash: 'abc123',
    message: 'update stuff',
    filesChanged: 1,
    insertions: 5,
    deletions: 2,
    fileTypes: { '.ts': 1 },
    isMerge: false,
    tags: [],
    ...overrides,
  };
}

describe('scoreCommit', () => {
  it('scores a trivial commit below the default threshold', () => {
    expect(scoreCommit(commit())).toBeLessThan(20);
  });

  it('scores feat commits at 30+', () => {
    expect(scoreCommit(commit({ message: 'feat: add sync engine' }))).toBeGreaterThanOrEqual(30);
  });

  it('scores fixes at 25+', () => {
    expect(scoreCommit(commit({ message: 'fix: race condition in queue' }))).toBeGreaterThanOrEqual(25);
  });

  it('adds size bonuses', () => {
    const big = commit({ filesChanged: 10, insertions: 300, deletions: 50 });
    expect(scoreCommit(big)).toBeGreaterThanOrEqual(40);
  });

  it('gives tagged releases a big boost', () => {
    expect(scoreCommit(commit({ tags: ['v1.0.0'] }))).toBeGreaterThanOrEqual(30);
  });

  it('caps at 100', () => {
    const max = commit({
      message: 'feat: fix perf release migration feature bug performance',
      filesChanged: 100,
      insertions: 5000,
      deletions: 2000,
      isMerge: true,
      tags: ['v2'],
    });
    expect(scoreCommit(max)).toBe(100);
  });
});

describe('scoreSession', () => {
  it('scores an empty session at 0', () => {
    expect(scoreSession({})).toBe(0);
  });

  it('scores a substantial session above threshold', () => {
    expect(scoreSession({ durationMinutes: 90, filesTouchedCount: 12, promptCount: 20, toolUseCount: 50 })).toBeGreaterThanOrEqual(60);
  });
});
