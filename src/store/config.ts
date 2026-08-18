import fs from 'node:fs';
import path from 'node:path';
import { bragvaultHome, configPath } from './paths.js';
import { atomicWriteFileSync } from './atomicWrite.js';

export interface BragvaultConfig {
  /** Backend origin, e.g. https://bragvault.hi5.works */
  endpoint: string;
  sync: {
    /** On by default; nothing uploads until the user connects an account. */
    enabled: boolean;
    batchSize: number;
    flushIntervalMs: number;
  };
  capture: {
    git: {
      enabled: boolean;
      pollIntervalMs: number;
      /** Only candidates scoring at or above this sync; everything journals. */
      minSignificance: number;
    };
    /** Repo basenames or absolute paths never captured at all. */
    denyRepos: string[];
  };
  privacy: {
    /** Include commit messages (redacted) in synced events. */
    shareCommitMessages: boolean;
    /** Share the repo directory basename with the backend. */
    shareRepoName: boolean;
  };
}

export const DEFAULT_CONFIG: BragvaultConfig = {
  endpoint: 'https://bragvault.hi5.works',
  sync: {
    enabled: true,
    batchSize: 50,
    flushIntervalMs: 60_000,
  },
  capture: {
    git: {
      enabled: true,
      pollIntervalMs: 30_000,
      minSignificance: 20,
    },
    denyRepos: [],
  },
  privacy: {
    shareCommitMessages: true,
    shareRepoName: true,
  },
};

function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return (override === undefined ? base : (override as T));
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const baseVal = (base as Record<string, unknown>)[k];
    out[k] = deepMerge(baseVal, v);
  }
  return out as T;
}

export function ensureHome(): void {
  fs.mkdirSync(bragvaultHome(), { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(bragvaultHome(), 0o700);
  } catch {
    // best effort on platforms without POSIX modes
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
}

/** Enforce sane bounds on user-editable values so a bad config file cannot
 * hang the flush loop or hammer the backend. */
function sanitize(config: BragvaultConfig): BragvaultConfig {
  const d = DEFAULT_CONFIG;
  config.sync.batchSize = clamp(config.sync.batchSize, 1, 50, d.sync.batchSize);
  config.sync.flushIntervalMs = clamp(config.sync.flushIntervalMs, 3_000, 3_600_000, d.sync.flushIntervalMs);
  config.capture.git.pollIntervalMs = clamp(config.capture.git.pollIntervalMs, 2_000, 3_600_000, d.capture.git.pollIntervalMs);
  config.capture.git.minSignificance = clamp(config.capture.git.minSignificance, 0, 100, d.capture.git.minSignificance);
  if (!Array.isArray(config.capture.denyRepos)) config.capture.denyRepos = [];
  if (typeof config.endpoint !== 'string' || !/^https?:\/\//.test(config.endpoint)) {
    config.endpoint = d.endpoint;
  }
  config.sync.enabled = Boolean(config.sync.enabled);
  config.capture.git.enabled = Boolean(config.capture.git.enabled);
  config.privacy.shareCommitMessages = Boolean(config.privacy.shareCommitMessages);
  config.privacy.shareRepoName = Boolean(config.privacy.shareRepoName);
  return config;
}

export function loadConfig(): BragvaultConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return sanitize(deepMerge(DEFAULT_CONFIG, JSON.parse(raw)));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: BragvaultConfig): void {
  ensureHome();
  atomicWriteFileSync(configPath(), JSON.stringify(config, null, 2) + '\n');
}

/** Write the default config file if none exists, so users can discover knobs. */
export function ensureConfigFile(): BragvaultConfig {
  if (!fs.existsSync(configPath())) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  return loadConfig();
}

export function isRepoDenied(config: BragvaultConfig, repoPath: string): boolean {
  const normalize = (p: string) => path.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
  const target = normalize(repoPath);
  const base = path.basename(target);
  return config.capture.denyRepos.some((d) => {
    const deny = normalize(d);
    return deny === base || deny === target;
  });
}
