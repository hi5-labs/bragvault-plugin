import { ensureConfigFile, isRepoDenied } from '../store/config.js';
import { appendToJournal, newEventId } from '../store/journal.js';
import { scoreSession } from '../capture/significance.js';
import { sessionToStructured } from '../capture/templates.js';
import { isGitRepo, repoInfo, repoRoot } from '../capture/git.js';
import { queueStructuredEvent } from '../capture/queueEvent.js';
import { parseClaudeCodeHookInput } from './claudeCode.js';
import type { RepoInfo, SessionInfo } from '../types.js';

/**
 * Hook entrypoint: reads the host tool's hook payload from stdin, derives a
 * deterministic session digest, and journals/queues it when significant.
 * Used by Claude Code SessionEnd, Cursor sessionEnd, and Codex notify.
 */
export async function runHook(tool: string, argvPayload?: string): Promise<void> {
  process.env.BRAGVAULT_SOURCE_TOOL = process.env.BRAGVAULT_SOURCE_TOOL ?? tool;
  const config = ensureConfigFile();

  // Codex notify delivers the payload as an argv entry; others use stdin.
  const stdin = argvPayload ?? (await readStdin());
  let session: SessionInfo = {};
  let cwd = process.cwd();

  if (tool === 'claude-code') {
    const parsed = await parseClaudeCodeHookInput(stdin);
    session = parsed.session;
    cwd = parsed.cwd ?? cwd;
  } else {
    // Cursor sessionEnd / Codex notify payloads are JSON; take what maps over.
    try {
      const data = JSON.parse(stdin) as Record<string, unknown>;
      if (typeof data['cwd'] === 'string') cwd = data['cwd'];
      if (typeof data['duration_minutes'] === 'number') session.durationMinutes = data['duration_minutes'];
    } catch {
      // no usable payload; still record a minimal session marker below
    }
  }

  let repo: RepoInfo | undefined;
  if (await isGitRepo(cwd)) {
    // Deny-listed repos are never captured — not even session timing.
    const root = await repoRoot(cwd).catch(() => cwd);
    if (isRepoDenied(config, root)) return;
    repo = await repoInfo(cwd);
  }

  // A digest with no repo context and no measurable stats says nothing;
  // journaling hundreds of them is pure noise (SessionEnd fires for every
  // tiny or headless session).
  const hasStats = Boolean(
    session.durationMinutes || session.filesTouchedCount || session.promptCount || session.toolUseCount,
  );
  if (!repo && !hasStats) return;

  const significance = scoreSession(session);
  const structured = sessionToStructured(session, repo);

  if (significance < config.capture.git.minSignificance) {
    // Below threshold: keep the local record, sync nothing.
    appendToJournal({
      id: newEventId(),
      kind: 'session_summary',
      occurredAt: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
      sourceTool: tool,
      repo,
      session,
      structured,
      significance,
    });
    return;
  }

  // Shared path with the MCP tools: correlation absorbs overlapping git
  // candidates so the same work does not sync twice. No network flush here:
  // hooks run under tight time budgets (Claude SessionEnd ~1.5s); the MCP
  // server's background syncer uploads the queued event shortly after.
  queueStructuredEvent('session_summary', structured, { repo, session, sourceTool: tool }, significance);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      // Release stdin so an open-but-quiet pipe can't keep the process alive.
      process.stdin.pause();
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      resolve(data);
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', settle);
    process.stdin.on('error', settle);
    setTimeout(settle, 3000).unref?.();
  });
}
