import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import os from 'node:os';
import { ensureConfigFile, isRepoDenied } from '../store/config.js';
import { loadCredentials, saveCredentials } from '../store/credentials.js';
import { loadState, updateState } from '../store/state.js';
import { readRecentEvents } from '../store/journal.js';
import { enqueue, listQueued, queueDepth } from '../store/queue.js';
import { GitWatcher } from '../capture/gitWatcher.js';
import { scoreSession } from '../capture/significance.js';
import { queueStructuredEvent, commitClientEventId } from '../capture/queueEvent.js';
import { flushQueue, Syncer, toWireEvent, PLUGIN_VERSION } from '../sync/syncer.js';
import { redact } from '../privacy/redact.js';
import { BragvaultClient } from '../sync/client.js';
import { repoInfo, isGitRepo, repoRoot } from '../capture/git.js';


function sourceTool(): string {
  return process.env.BRAGVAULT_SOURCE_TOOL ?? 'unknown';
}

type WorkspaceRepo = { denied: true } | { denied: false; repo?: Awaited<ReturnType<typeof repoInfo>> };

async function workspaceRepo(config: ReturnType<typeof ensureConfigFile>): Promise<WorkspaceRepo> {
  const cwd = process.cwd();
  if (!(await isGitRepo(cwd))) return { denied: false };
  // Deny-listed repos are never captured at all — not even agent-authored
  // narratives about the work done in them.
  const root = await repoRoot(cwd).catch(() => cwd);
  if (isRepoDenied(config, root)) return { denied: true };
  return { denied: false, repo: await repoInfo(cwd) };
}

const DENIED_MESSAGE =
  'This repository is on the BragVault deny list (capture.denyRepos), so nothing is recorded here.';

export async function runMcpServer(): Promise<void> {
  const config = ensureConfigFile();

  const server = new McpServer({ name: 'bragvault', version: PLUGIN_VERSION });

  server.registerTool(
    'log_accomplishment',
    {
      title: 'Log an accomplishment to BragVault',
      description:
        'Record a completed, substantial piece of engineering work as a BragVault accomplishment. ' +
        'Call this when the user explicitly asks to log/brag about something, or when you have just ' +
        'finished a milestone worth recording: a feature shipped, a non-trivial bug fixed, a performance ' +
        'win with numbers, a migration or incident resolved. Do NOT call it for routine edits, ' +
        'work-in-progress, or trivial changes. Write the summary in first person implied, starting with ' +
        'an action verb, and only include impact numbers the user actually stated.',
      inputSchema: {
        title: z.string().max(100).describe('Short headline for the accomplishment'),
        summary: z
          .string()
          .describe('2-3 sentences starting with an action verb. Only include metrics that were explicitly stated.'),
        category: z
          .enum([
            'major_milestone',
            'small_win',
            'mentorship',
            'collaboration',
            'code_review',
            'documentation',
            'incident_resolution',
            'optimization',
            'refactoring',
            'tooling',
            'recognition',
            'experiment',
            'heroic_save',
          ])
          .optional()
          .describe('Best-fitting category for the work'),
        impact: z.string().optional().describe('Quantified impact, only if explicitly known (e.g. "p95 latency -19%")'),
        context: z.string().optional().describe('Team/project context, only if known'),
        technologies: z.array(z.string()).optional().describe('Technologies involved'),
        occurred_at: z.string().optional().describe('ISO datetime when the work completed; omit for now'),
      },
    },
    async (args) => {
      const ws = await workspaceRepo(config);
      if (ws.denied) {
        return { content: [{ type: 'text' as const, text: DENIED_MESSAGE }] };
      }
      const repo = ws.repo;
      const queued = queueStructuredEvent(
        'manual_brag',
        {
          title: args.title,
          summary: args.summary,
          category: args.category ?? null,
          impact: args.impact ?? null,
          context: args.context ?? null,
          technologies: args.technologies ?? [],
        },
        { repo, occurredAt: args.occurred_at, sourceTool: sourceTool() },
        80,
      );
      const sync = await flushQueue(config);
      const syncNote = sync.synced > 0 ? 'synced to BragVault' : sync.error ? `stored locally (${sync.error})` : 'stored locally';
      return {
        content: [
          {
            type: 'text' as const,
            text: `Accomplishment logged (${queued.clientEventId}); ${syncNote}. Evidence absorbed: ${queued.evidence.length} item(s).`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'capture_session_summary',
    {
      title: 'Capture a session summary',
      description:
        'Record a summary of the current working session when a substantial session concludes. ' +
        'Provide a narrative of what was accomplished plus rough stats. Skip trivial sessions.',
      inputSchema: {
        narrative: z.string().describe('What was accomplished this session, 1-3 sentences, action-verb style'),
        duration_minutes: z.number().int().positive().optional(),
        files_touched: z.number().int().nonnegative().optional(),
        prompt_count: z.number().int().nonnegative().optional(),
        technologies: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const ws = await workspaceRepo(config);
      if (ws.denied) {
        return { content: [{ type: 'text' as const, text: DENIED_MESSAGE }] };
      }
      const repo = ws.repo;
      const session = {
        durationMinutes: args.duration_minutes,
        filesTouchedCount: args.files_touched,
        promptCount: args.prompt_count,
      };
      const significance = Math.max(scoreSession(session), 30);
      const queued = queueStructuredEvent(
        'session_summary',
        {
          title: args.narrative.slice(0, 100),
          summary: args.narrative,
          category: 'small_win',
          technologies: args.technologies ?? [],
        },
        { repo, session, sourceTool: sourceTool() },
        significance,
      );
      await flushQueue(config);
      return {
        content: [{ type: 'text' as const, text: `Session summary captured (${queued.clientEventId}).` }],
      };
    },
  );

  server.registerTool(
    'get_status',
    {
      title: 'BragVault plugin status',
      description:
        'Report BragVault plugin state: account connection, sync queue depth, last sync time, and capture settings. ' +
        "Use when the user asks about BragVault's status or whether their work is being recorded.",
      inputSchema: {},
    },
    async () => {
      const creds = loadCredentials();
      const state = loadState();
      const status = {
        connected: Boolean(creds),
        account: creds?.email ?? null,
        endpoint: config.endpoint,
        sync_enabled: config.sync.enabled,
        queue_depth: queueDepth(),
        last_sync_at: state.lastSyncAt ?? null,
        git_capture_enabled: config.capture.git.enabled,
        min_significance: config.capture.git.minSignificance,
        source_tool: sourceTool(),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
    },
  );

  server.registerTool(
    'list_recent',
    {
      title: 'List recent BragVault captures',
      description: 'List recently captured accomplishments and activity from the local BragVault journal.',
      inputSchema: {
        limit: z.number().int().positive().max(50).optional().describe('Max entries to return (default 10)'),
      },
    },
    async (args) => {
      // Journal entries are raw; redact anything surfaced into agent context.
      const events = readRecentEvents(args.limit ?? 10).map((e) => ({
        kind: e.kind,
        occurred_at: e.occurredAt,
        title: e.structured?.title ? redact(e.structured.title) : undefined,
        significance: e.significance,
        repo: e.repo?.name,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(events, null, 2) }] };
    },
  );

  server.registerTool(
    'connect',
    {
      title: 'Connect BragVault account',
      description:
        'Start connecting this machine to a BragVault account so captured accomplishments sync. ' +
        'Returns a URL and code for the user to approve in their browser; then call connect again ' +
        'with the code to complete. Use when the user asks to connect/sign in to BragVault, or when ' +
        'sync is failing because no account is connected.',
      inputSchema: {
        code: z.string().optional().describe('The device code from a previous connect call, to poll for completion'),
      },
    },
    async (args) => {
      const client = new BragvaultClient(config.endpoint);
      if (!args.code) {
        const start = await client.deviceAuthStart(`${sourceTool()} on ${os.hostname()}`);
        // The poll credential stays on this machine; only the short code is
        // shown to the user (and is useless for polling without the secret).
        updateState((s) => {
          s.pendingAuth = { code: start.code, deviceSecret: start.device_secret, startedAt: new Date().toISOString() };
        });
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Ask the user to open ${start.verify_url} and approve code ${start.code} while logged in to BragVault. ` +
                `Then call connect again with code="${start.code}" to complete the connection.`,
            },
          ],
        };
      }
      const pending = loadState().pendingAuth;
      if (!pending || pending.code !== args.code) {
        return {
          content: [
            { type: 'text' as const, text: 'No pairing in progress for that code — call connect without arguments to start over.' },
          ],
        };
      }
      const poll = await client.deviceAuthPoll(args.code, pending.deviceSecret);
      if (poll.status === 'approved' && poll.token) {
        // Credentials first: the backend hands the token over exactly once,
        // so it must be durable before the pairing record is dropped.
        saveCredentials({
          token: poll.token,
          userId: poll.user_id,
          email: poll.email,
          connectedAt: new Date().toISOString(),
        });
        updateState((s) => {
          delete s.pendingAuth;
        });
        const flushed = await flushQueue(config);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Connected as ${poll.email ?? 'user'}. Flushed ${flushed.synced} queued event(s).`,
            },
          ],
        };
      }
      return {
        content: [{ type: 'text' as const, text: `Connection status: ${poll.status}. Ask the user to approve, then retry.` }],
      };
    },
  );

  server.registerTool(
    'preview_sync',
    {
      title: 'Preview pending sync payload',
      description:
        'Show the exact JSON that would be sent to the BragVault backend for the currently queued events. ' +
        'Nothing is sent. Use when the user wants to verify what data leaves their machine.',
      inputSchema: {},
    },
    async () => {
      const state = loadState();
      const wire = listQueued().map((e) => toWireEvent(e, state.deviceId, config));
      return { content: [{ type: 'text' as const, text: JSON.stringify(wire, null, 2) }] };
    },
  );

  // Passive capture + background sync live in this process for the lifetime
  // of the editor session. The watcher journals every commit; significant
  // ones become sync-queue candidates here.
  const watcher = new GitWatcher(process.cwd(), config, (event) => {
    if (!event.structured || !event.git) return;
    const repoKey = event.repo?.remoteHash ?? event.repo?.name ?? 'unknown';
    enqueue({
      // Deterministic id: reprocessing the same commit overwrites the same
      // queue file instead of duplicating it.
      clientEventId: commitClientEventId(repoKey, event.git.hash),
      kind: event.kind,
      occurredAt: event.occurredAt,
      sourceTool: event.sourceTool,
      significance: event.significance,
      structured: event.structured,
      repo: event.repo,
      git: event.git,
      evidence: [event.id],
    });
  });
  const syncer = new Syncer(config);
  await watcher.start();
  syncer.start();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
