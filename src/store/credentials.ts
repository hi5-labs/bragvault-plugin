import fs from 'node:fs';
import { credentialsPath } from './paths.js';
import { ensureHome } from './config.js';
import { atomicWriteFileSync } from './atomicWrite.js';

export interface Credentials {
  token: string;
  /** Backend user id, informational only. */
  userId?: number;
  email?: string;
  connectedAt?: string;
}

export function loadCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Credentials;
    if (!parsed.token) return null;
    // A manually created file typically starts 0644; tighten it.
    try {
      fs.chmodSync(credentialsPath(), 0o600);
    } catch {
      // best effort on platforms without POSIX modes
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  ensureHome();
  atomicWriteFileSync(credentialsPath(), JSON.stringify(creds, null, 2) + '\n', 0o600);
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(credentialsPath());
  } catch {
    // already gone
  }
}
