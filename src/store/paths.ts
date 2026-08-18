import os from 'node:os';
import path from 'node:path';

/**
 * Root of all local BragVault state. Override with BRAGVAULT_HOME (used by
 * tests and by users who want the journal somewhere else).
 */
export function bragvaultHome(): string {
  return process.env.BRAGVAULT_HOME ?? path.join(os.homedir(), '.bragvault');
}

export function configPath(): string {
  return path.join(bragvaultHome(), 'config.json');
}

export function credentialsPath(): string {
  return path.join(bragvaultHome(), 'credentials.json');
}

export function statePath(): string {
  return path.join(bragvaultHome(), 'state.json');
}

export function journalDir(): string {
  return path.join(bragvaultHome(), 'journal');
}

export function queueDir(): string {
  return path.join(bragvaultHome(), 'queue');
}
