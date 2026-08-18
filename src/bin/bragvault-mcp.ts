import { runMcpServer } from '../mcp/server.js';
import { runHook } from '../hooks/runHook.js';
import { ensureConfigFile } from '../store/config.js';
import { loadState } from '../store/state.js';
import { listQueued } from '../store/queue.js';
import { toWireEvent } from '../sync/syncer.js';

/**
 * Single binary, three modes:
 *   bragvault-mcp                 stdio MCP server (what editors launch)
 *   bragvault-mcp --hook <tool>   hook entrypoint (Claude Code Stop, Cursor sessionEnd, Codex notify)
 *   bragvault-mcp --preview       print the exact JSON pending sync, then exit
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === '--preview') {
    const config = ensureConfigFile();
    const state = loadState();
    const wire = listQueued().map((e) => toWireEvent(e, state.deviceId, config));
    process.stdout.write(JSON.stringify(wire, null, 2) + '\n');
    return;
  }

  if (args[0] === '--hook') {
    // Codex notify passes its JSON payload as an argv entry; Claude Code and
    // Cursor hooks stream it on stdin. Forward both.
    await runHook(args[1] ?? 'unknown', args[2]);
    // Exit explicitly: a host that keeps our stdin open must not keep the
    // hook process alive past its work.
    process.exit(0);
  }

  await runMcpServer();
}

main().catch((err) => {
  // Stderr only: stdout belongs to the MCP protocol.
  console.error('[bragvault]', err instanceof Error ? err.message : err);
  process.exit(1);
});
