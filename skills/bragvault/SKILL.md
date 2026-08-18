---
name: bragvault
description: Log the user's engineering accomplishments to BragVault. Use when the user asks to log/record/brag about work, when a substantial task completes (feature shipped, tricky bug fixed, perf win, migration done, incident resolved), or when the user asks about their BragVault status or recent accomplishments.
---

# BragVault accomplishment logging

BragVault is the user's system of record for engineering impact. This plugin's
MCP tools let you record their accomplishments; captured events stay local and
sync to their BragVault account when connected.

## When to log

Call `log_accomplishment` when:

- The user explicitly asks ("log this", "add to my brag doc", "record this win").
- You just completed **substantial** work with the user: a feature shipped, a
  non-trivial bug diagnosed and fixed, a measurable performance improvement, a
  migration or refactor landed, an incident resolved.

Do **not** log routine edits, work-in-progress, failed attempts, or trivial
changes. One log per piece of work — the plugin absorbs related git commits
automatically. When unsure whether something is worth logging, offer: "Want me
to log this to BragVault?"

## How to write it

- `title`: short headline, e.g. "Shipped retry logic for sync queue".
- `summary`: 2-3 sentences, action-verb first person implied ("Implemented…",
  "Diagnosed and fixed…"). **Only include numbers the user actually stated or
  that you measured together** — never invent metrics.
- `category`: pick the best fit (major_milestone, small_win, incident_resolution,
  optimization, refactoring, tooling, mentorship, …).
- `impact`: quantified impact if and only if explicitly known.
- `technologies`: what was actually used.

## Session summaries

At the end of a substantial session (many files, real outcomes), you may call
`capture_session_summary` with a 1-3 sentence narrative of what was
accomplished. Skip trivial sessions.

## Account and status

- `get_status` answers "is BragVault recording?", queue depth, and connection state.
- If sync reports "not connected", offer to run `connect`: it returns a URL and
  device code the user approves in their browser. Never ask the user to paste
  tokens into the conversation.
- `preview_sync` shows exactly what would be uploaded — offer it if the user
  has privacy questions.
