# BragVault Plugin

**Your engineering work, remembered.** BragVault's plugin for [Cursor](https://cursor.com), [Claude Code](https://claude.com/claude-code), and [OpenAI Codex](https://developers.openai.com/codex) passively captures your accomplishments while you work — git commits, coding sessions, and milestones your AI agent notices — keeps the raw history **local**, and optionally syncs structured accomplishments to your [BragVault](https://bragvault.hi5.works) account for a polished, presentable track record.

## Privacy first

- **Everything is captured locally** into `~/.bragvault/journal/` (append-only NDJSON). The journal never uploads.
- **No LLM calls, no API keys.** The plugin contains zero AI code. Rich accomplishment write-ups come from the coding agent you already run, on your existing subscription. Passive events use deterministic templates.
- **File contents and diffs never sync.** Only structured accomplishment summaries, commit stats, and (redacted) commit messages do — and you can turn those off.
- **Secrets are redacted** from every outgoing string (AWS/GitHub/OpenAI/Slack/Stripe keys, JWTs, PEM blocks, `password=`-style assignments, high-entropy blobs).
- **Sync requires connecting an account** — approve a device code in your browser; no tokens pasted into chat. Until then (or forever, if you like) the plugin is local-only.
- **Verify, don't trust:** the `preview_sync` tool (or `bragvault-mcp --preview`) prints the exact JSON that would be sent.

## Install

### Claude Code

```bash
claude plugin marketplace add hi5-labs/bragvault-plugin
```

Then `/plugin install bragvault` — the plugin bundles the MCP server, a `Stop`-hook session capturer, and a skill that teaches the agent when to log accomplishments.

### Cursor

Install from the Cursor marketplace, or add the MCP server manually to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bragvault": {
      "command": "npx",
      "args": ["-y", "bragvault"]
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.bragvault]
command = "npx"
args = ["-y", "bragvault"]
```

See [`integrations/codex/AGENTS.snippet.md`](integrations/codex/AGENTS.snippet.md) for the AGENTS.md snippet that teaches the agent to log milestones.

## What it captures

| Channel | How | What |
|---|---|---|
| Git activity | The MCP server polls `git log` for the open workspace (your commits only; backfills commits made while no editor was open; polling pauses when the session is idle) | Commit stats, tags/releases, merges — template-summarized, attributed to "Git" rather than any tool (the watcher is a witness, not an author) |
| Agent judgment | Your coding agent calls `log_accomplishment` when it recognizes a milestone (or you ask it to) | Structured accomplishment: title, summary, category, impact, technologies |
| Session boundaries | Claude Code `Stop` hook / Cursor `sessionEnd` hook / Codex `notify` | Deterministic session digest (duration, files touched, prompts) |

Everything lands in the local journal; events scoring above a significance threshold (configurable, default 20/100) become sync candidates.

## Connecting your account (optional)

Ask your agent to "connect BragVault" — it will give you a URL and a device code to approve in your browser. Or create a personal access token in the BragVault web app and place it in `~/.bragvault/credentials.json`.

Sync is on by default but does nothing until an account is connected. Disable it any time in `~/.bragvault/config.json` (`sync.enabled: false`), or deny specific repos (`capture.denyRepos`).

## MCP tools

| Tool | Purpose |
|---|---|
| `log_accomplishment` | Record a completed, substantial piece of work |
| `capture_session_summary` | Record an agent-written summary of the current session |
| `get_status` | Connection, queue, and capture status |
| `list_recent` | Recent local captures |
| `connect` | Device-code account connection |
| `preview_sync` | Exact JSON pending upload — nothing is sent |

## Development

```bash
npm install
npm test        # vitest
npm run build   # tsup -> dist/bragvault-mcp.js
```

The backend wire contract lives in [`docs/api-contract.md`](docs/api-contract.md) and [`src/sync/types.ts`](src/sync/types.ts).

## License

[Apache-2.0](LICENSE)
