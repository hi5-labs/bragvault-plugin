import fs from 'node:fs';
import path from 'node:path';
import { queueDir } from './paths.js';
import { atomicWriteFileSync } from './atomicWrite.js';
import { redactDeep } from '../privacy/redact.js';
import type { QueuedEvent } from '../types.js';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * File-based sync queue: one JSON file per candidate, deleted on server ack.
 * Survives restarts and works fully offline.
 */

export function enqueue(event: QueuedEvent): void {
  if (!SAFE_ID.test(event.clientEventId)) {
    throw new Error(`Invalid clientEventId: ${event.clientEventId}`);
  }
  fs.mkdirSync(queueDir(), { recursive: true, mode: 0o700 });
  const file = path.join(queueDir(), `${event.clientEventId}.json`);
  // Candidates are redacted at rest; the wire layer redacts again on send.
  atomicWriteFileSync(file, JSON.stringify(redactDeep(event), null, 2) + '\n', 0o600);
}

export function listQueued(): QueuedEvent[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(queueDir()).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const events: QueuedEvent[] = [];
  for (const f of files.sort()) {
    try {
      events.push(JSON.parse(fs.readFileSync(path.join(queueDir(), f), 'utf8')) as QueuedEvent);
    } catch {
      // skip corrupt entry
    }
  }
  return events;
}

export function ack(clientEventId: string): void {
  // Never let an id (e.g. from a server response) escape the queue directory.
  if (!SAFE_ID.test(clientEventId)) return;
  const file = path.join(queueDir(), `${clientEventId}.json`);
  if (path.dirname(file) !== queueDir()) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // already gone
  }
}

export function queueDepth(): number {
  try {
    return fs.readdirSync(queueDir()).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}
