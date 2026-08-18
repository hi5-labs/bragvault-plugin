import fs from 'node:fs';
import readline from 'node:readline';
import type { SessionInfo } from '../types.js';

interface ParsedHook {
  session: SessionInfo;
  cwd?: string;
}

/**
 * Parse a Claude Code Stop/SessionEnd hook payload. The payload includes
 * `transcript_path` (session JSONL); we derive deterministic stats from it —
 * no content leaves the machine, and nothing here calls a model.
 */
export async function parseClaudeCodeHookInput(stdin: string): Promise<ParsedHook> {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(stdin) as Record<string, unknown>;
  } catch {
    return { session: {} };
  }

  const cwd = typeof payload['cwd'] === 'string' ? (payload['cwd'] as string) : undefined;
  const transcriptPath = typeof payload['transcript_path'] === 'string' ? (payload['transcript_path'] as string) : undefined;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { session: {}, cwd };

  let promptCount = 0;
  let toolUseCount = 0;
  const filesTouched = new Set<string>();
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  const rl = readline.createInterface({
    input: fs.createReadStream(transcriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const ts = typeof entry['timestamp'] === 'string' ? Date.parse(entry['timestamp'] as string) : NaN;
    if (!Number.isNaN(ts)) {
      if (firstTs === null) firstTs = ts;
      lastTs = ts;
    }
    if (entry['type'] === 'user') promptCount += 1;
    const message = entry['message'] as Record<string, unknown> | undefined;
    const content = message?.['content'];
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b['type'] === 'tool_use') {
          toolUseCount += 1;
          const input = b['input'] as Record<string, unknown> | undefined;
          const fp = input?.['file_path'];
          if (typeof fp === 'string' && (b['name'] === 'Edit' || b['name'] === 'Write' || b['name'] === 'NotebookEdit')) {
            filesTouched.add(fp);
          }
        }
      }
    }
  }

  const session: SessionInfo = {
    promptCount,
    toolUseCount,
    filesTouchedCount: filesTouched.size,
  };
  if (firstTs !== null && lastTs !== null && lastTs > firstTs) {
    session.durationMinutes = Math.round((lastTs - firstTs) / 60_000);
  }
  return { session, cwd };
}
