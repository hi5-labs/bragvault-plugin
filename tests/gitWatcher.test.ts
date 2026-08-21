import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitWatcher } from '../src/capture/gitWatcher.js';
import { DEFAULT_CONFIG } from '../src/store/config.js';
import { readRecentEvents } from '../src/store/journal.js';
import { listCommits, toCommitInfo } from '../src/capture/git.js';
import type { JournalEvent } from '../src/types.js';

let home: string;
let repo: string;

function sh(cwd: string, cmd: string, args: string[]): void {
  execFileSync(cmd, args, { cwd, stdio: 'ignore' });
}

function gitCommit(message: string, file: string, content: string): void {
  fs.writeFileSync(path.join(repo, file), content);
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', message, '--no-gpg-sign']);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'bragvault-test-'));
  process.env.BRAGVAULT_HOME = home;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bragvault-repo-'));
  sh(repo, 'git', ['init', '-q']);
  sh(repo, 'git', ['config', 'user.email', 'dev@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Dev']);
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
  delete process.env.BRAGVAULT_HOME;
});

describe('listCommits', () => {
  it('parses commits with numstat and tags', async () => {
    gitCommit('feat: first thing', 'a.ts', 'export const a = 1;\n');
    sh(repo, 'git', ['tag', 'v0.1.0']);
    const commits = await listCommits(repo, { maxCount: 10 });
    expect(commits).toHaveLength(1);
    const info = toCommitInfo(commits[0]!);
    expect(info.message).toBe('feat: first thing');
    expect(info.filesChanged).toBe(1);
    expect(info.insertions).toBe(1);
    expect(info.fileTypes['.ts']).toBe(1);
    expect(info.tags).toContain('v0.1.0');
  });

  it('returns only commits after sinceHash', async () => {
    gitCommit('one', 'a.ts', 'a\n');
    const [first] = await listCommits(repo, { maxCount: 1 });
    gitCommit('two', 'b.ts', 'b\n');
    gitCommit('three', 'c.ts', 'c\n');
    const after = await listCommits(repo, { sinceHash: first!.hash });
    expect(after.map((c) => c.message)).toEqual(['three', 'two']);
  });
});

describe('GitWatcher', () => {
  it('backfills own commits on start and skips other authors', async () => {
    gitCommit('feat: mine', 'a.ts', 'a\n');
    sh(repo, 'git', ['config', 'user.email', 'teammate@example.com']);
    gitCommit('feat: not mine', 'b.ts', 'b\n');
    sh(repo, 'git', ['config', 'user.email', 'dev@example.com']);
    gitCommit('fix: mine again with a real bug fix', 'c.ts', 'c\n');

    const candidates: JournalEvent[] = [];
    const watcher = new GitWatcher(repo, DEFAULT_CONFIG, (e) => candidates.push(e));
    await watcher.start();
    watcher.stop();

    const journaled = readRecentEvents(10);
    const messages = journaled.map((e) => e.git!.message);
    expect(messages).toContain('feat: mine');
    expect(messages).toContain('fix: mine again with a real bug fix');
    expect(messages).not.toContain('feat: not mine');
    // significant candidates got queued (feat=30, fix=25 >= threshold 20)
    expect(candidates.length).toBe(2);
  });

  it('does not re-journal commits across restarts', async () => {
    gitCommit('feat: once', 'a.ts', 'a\n');
    const w1 = new GitWatcher(repo, DEFAULT_CONFIG, () => {});
    await w1.start();
    w1.stop();
    const w2 = new GitWatcher(repo, DEFAULT_CONFIG, () => {});
    await w2.start();
    w2.stop();
    const events = readRecentEvents(10).filter((e) => e.kind === 'git_commit');
    expect(events).toHaveLength(1);
  });

  it('picks up commits made while stopped (backfill via cursor)', async () => {
    gitCommit('feat: first', 'a.ts', 'a\n');
    const w1 = new GitWatcher(repo, DEFAULT_CONFIG, () => {});
    await w1.start();
    w1.stop();

    gitCommit('feat: made offline', 'b.ts', 'b\n');
    const w2 = new GitWatcher(repo, DEFAULT_CONFIG, () => {});
    await w2.start();
    w2.stop();

    const messages = readRecentEvents(10).map((e) => e.git!.message);
    expect(messages).toContain('feat: made offline');
  });

  it('attributes passive commits to git, not a tool', async () => {
    process.env.BRAGVAULT_SOURCE_TOOL = 'cursor';
    gitCommit('feat: neutral attribution', 'a.ts', 'a\n');
    const watcher = new GitWatcher(repo, DEFAULT_CONFIG, () => {});
    await watcher.start();
    watcher.stop();
    delete process.env.BRAGVAULT_SOURCE_TOOL;
    const events = readRecentEvents(10);
    expect(events[0]!.sourceTool).toBe('git');
  });

  it('skips polling when the session is idle (startup backfill exempt)', async () => {
    gitCommit('feat: while active', 'a.ts', 'a\n');
    const watcher = new GitWatcher(repo, DEFAULT_CONFIG, () => {}, () => false);
    // Startup backfill runs regardless: opening a session is activity.
    await watcher.start();
    watcher.stop();
    expect(readRecentEvents(10)).toHaveLength(1);

    // New commit while idle: a manual tick must observe nothing.
    gitCommit('feat: while idle', 'b.ts', 'b\n');
    await watcher.pollOnce(false);
    expect(readRecentEvents(10)).toHaveLength(1);

    // Same tick with activity present captures it.
    const active = new GitWatcher(repo, DEFAULT_CONFIG, () => {}, () => true);
    await active.pollOnce(false);
    expect(readRecentEvents(10)).toHaveLength(2);
  });

  it('tolerates a repo with no commits yet', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bragvault-empty-'));
    sh(empty, 'git', ['init', '-q']);
    const watcher = new GitWatcher(empty, DEFAULT_CONFIG, () => {});
    await expect(watcher.start()).resolves.toBeUndefined();
    watcher.stop();
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('respects the deny list', async () => {
    gitCommit('feat: secret work', 'a.ts', 'a\n');
    const config = {
      ...DEFAULT_CONFIG,
      capture: { ...DEFAULT_CONFIG.capture, denyRepos: [path.basename(repo)] },
    };
    const watcher = new GitWatcher(repo, config, () => {});
    await watcher.start();
    watcher.stop();
    expect(readRecentEvents(10)).toHaveLength(0);
  });
});
