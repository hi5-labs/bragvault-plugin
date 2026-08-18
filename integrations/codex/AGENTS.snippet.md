# Add to your AGENTS.md

## BragVault

The `bragvault` MCP server records my engineering accomplishments (local-first,
optional sync to my BragVault account).

- When I ask to log/record/brag about work, or when we complete a substantial
  milestone (feature shipped, non-trivial bug fixed, measurable perf win,
  migration landed, incident resolved), call `log_accomplishment`. Summary:
  action-verb first, 2-3 sentences, no invented metrics.
- Don't log routine edits or WIP. When unsure, ask me first.
- If sync says "not connected" and I want syncing, use `connect` and give me
  the URL + device code to approve in my browser. Never ask me for tokens.
