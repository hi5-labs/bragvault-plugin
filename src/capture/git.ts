import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitCommitInfo, RepoInfo } from '../types.js';

const execFileAsync = promisify(execFile);

/** Thin wrappers over the git CLI. No dependency on simple-git. */

export async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const out = await git(repoPath, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

export async function repoRoot(repoPath: string): Promise<string> {
  return (await git(repoPath, ['rev-parse', '--show-toplevel'])).trim();
}

export async function userEmail(repoPath: string): Promise<string | null> {
  try {
    return (await git(repoPath, ['config', 'user.email'])).trim() || null;
  } catch {
    return null;
  }
}

export async function currentBranch(repoPath: string): Promise<string | undefined> {
  try {
    const b = (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    return b === 'HEAD' ? undefined : b;
  } catch {
    return undefined;
  }
}

export async function repoInfo(repoPath: string): Promise<RepoInfo> {
  const root = await repoRoot(repoPath);
  let remoteHash: string | undefined;
  try {
    const remote = (await git(repoPath, ['remote', 'get-url', 'origin'])).trim();
    if (remote) remoteHash = crypto.createHash('sha256').update(remote).digest('hex');
  } catch {
    // no origin remote
  }
  if (!remoteHash) {
    // Without a remote, identify the repo by its canonical path so two local
    // repos with the same basename never share cursors or queue ids. Still a
    // hash: the path itself is never uploaded. Normalize hard so Windows
    // path-separator/case variants hash identically across git/node versions.
    let canonical = path.resolve(root);
    if (process.platform === 'win32') {
      canonical = canonical.replace(/\\/g, '/').toLowerCase();
    }
    remoteHash = crypto.createHash('sha256').update(`path:${canonical}`).digest('hex');
  }
  return { name: path.basename(root), remoteHash, branch: await currentBranch(repoPath) };
}

/** Number of commits in cursor..HEAD (0 on any failure). */
export async function countRange(repoPath: string, sinceHash: string): Promise<number> {
  try {
    const out = await git(repoPath, ['rev-list', '--count', `${sinceHash}..HEAD`]);
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/** The n-th oldest commit hash in cursor..HEAD, for paging huge backfills. */
export async function nthOldestInRange(repoPath: string, sinceHash: string, n: number, total: number): Promise<string | null> {
  try {
    const out = await git(repoPath, ['rev-list', `${sinceHash}..HEAD`, `--skip=${Math.max(total - n, 0)}`, '--max-count=1']);
    return out.trim() || null;
  } catch {
    return null;
  }
}

export interface RawCommit {
  hash: string;
  parents: string[];
  authorEmail: string;
  authoredAt: string;
  message: string;
  files: { path: string; insertions: number; deletions: number }[];
  tags: string[];
}

const FIELD_SEP = '';
const RECORD_SEP = '';

/**
 * List commits reachable from HEAD, newest first. When `sinceHash` is given,
 * only commits after it (exclusive); otherwise up to `maxCount` recent ones.
 */
export async function listCommits(
  repoPath: string,
  opts: { sinceHash?: string; maxCount?: number; endRev?: string } = {},
): Promise<RawCommit[]> {
  const format = ['%H', '%P', '%ae', '%aI', '%s', '%D'].join(FIELD_SEP);
  const args = ['log', `--format=${RECORD_SEP}${format}`, '--numstat'];
  if (opts.sinceHash) {
    args.push(`${opts.sinceHash}..${opts.endRev ?? 'HEAD'}`);
  } else {
    args.push(`--max-count=${opts.maxCount ?? 10}`);
  }

  let out: string;
  try {
    out = await git(repoPath, args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Repo with no commits yet: nothing to capture.
    if (message.includes('does not have any commits')) return [];
    // Only a genuinely stale cursor (rebased/gc'd hash) falls back to a
    // cursorless listing. Transient failures (locks, spawn errors) rethrow
    // so the caller retries the same range next poll instead of advancing
    // the cursor past unseen commits.
    const staleCursor = /bad revision|unknown revision|bad object|invalid revision range|invalid symmetric difference/i.test(message);
    if (opts.sinceHash && staleCursor) return listCommits(repoPath, { maxCount: opts.maxCount });
    throw err;
  }

  const commits: RawCommit[] = [];
  for (const record of out.split(RECORD_SEP)) {
    if (!record.trim()) continue;
    const [head, ...bodyLines] = record.split('\n');
    if (!head) continue;
    const [hash, parents, authorEmail, authoredAt, message, refs] = head.split(FIELD_SEP);
    if (!hash) continue;
    const files: RawCommit['files'] = [];
    for (const line of bodyLines) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (m && m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
        files.push({
          path: m[3],
          insertions: m[1] === '-' ? 0 : parseInt(m[1], 10),
          deletions: m[2] === '-' ? 0 : parseInt(m[2], 10),
        });
      }
    }
    const tags = (refs ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.startsWith('tag: '))
      .map((r) => r.slice('tag: '.length));
    commits.push({
      hash,
      parents: (parents ?? '').split(' ').filter(Boolean),
      authorEmail: authorEmail ?? '',
      authoredAt: authoredAt ?? new Date(0).toISOString(),
      message: message ?? '',
      files,
      tags,
    });
  }
  return commits;
}

export function toCommitInfo(raw: RawCommit): GitCommitInfo {
  const fileTypes: Record<string, number> = {};
  let insertions = 0;
  let deletions = 0;
  for (const f of raw.files) {
    insertions += f.insertions;
    deletions += f.deletions;
    const ext = path.extname(f.path) || '(none)';
    fileTypes[ext] = (fileTypes[ext] ?? 0) + 1;
  }
  return {
    hash: raw.hash,
    message: raw.message,
    filesChanged: raw.files.length,
    insertions,
    deletions,
    fileTypes,
    isMerge: raw.parents.length > 1,
    tags: raw.tags,
  };
}
