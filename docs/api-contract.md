# BragVault Plugin API Contract

The wire contract between this plugin and the BragVault backend (`/api/plugin`).
TypeScript definitions: [`src/sync/types.ts`](../src/sync/types.ts).

Design principle: **the backend is a lean receiver.** It registers incoming
events as already-processed accomplishments — no AI analysis, no Celery jobs.
Structuring happens client-side (deterministic templates for passive events,
the host coding agent for rich ones).

## Authentication

Personal Access Token, format `bv_<random>`, sent as `Authorization: Bearer bv_...`.
Tokens are minted in the web app or through the device-auth flow below and are
stored hashed server-side.

## Endpoints

### `POST /api/plugin/device-auth/start` (unauthenticated)

```json
{ "device_name": "claude-code on ivans-mbp" }
```

→ `{ "ok": true, "code": "XKCD-1234", "device_secret": "<43-char urlsafe>", "verify_url": "https://.../connect?code=XKCD-1234", "expires_in": 600, "poll_interval": 5 }`

RFC 8628-style split: the short `code` is only for browser approval; the
high-entropy `device_secret` is the poll credential and never leaves the
machine. Codes are single-use and expire in ~10 minutes. Approval claims are
atomic (Lua CAS), so concurrent approvals mint exactly one token.

### `POST /api/plugin/device-auth/poll` (unauthenticated)

```json
{ "code": "XKCD-1234", "device_secret": "<from start>" }
```

→ `{ "ok": true, "status": "pending" | "approved" | "expired" | "denied", "token": "bv_...", "user_id": 1, "email": "..." }`

A wrong `device_secret` is rejected (403). `token` is present only when
`status == "approved"`, exactly once — the handover atomically deletes the
pairing, so a second poll returns `expired`.

### `GET /api/plugin/me`

Token validation + server-driven plugin config.

→ `{ "ok": true, "user_id": 1, "email": "...", "token_name": "...", "scopes": ["events:write"], "plugin_config": { "min_significance": 20, "max_batch_size": 50 } }`

### `POST /api/plugin/events/batch`

Batch ingest, max 50 events. Each event:

```json
{
  "client_event_id": "8f14e45f-...-uuid",
  "kind": "manual_brag | git_commit | session_summary",
  "occurred_at": "2026-08-17T14:03:00Z",
  "significance": 65,
  "title": "Shipped retry logic for sync queue",
  "summary": "Implemented exponential-backoff retry ...",
  "category": "optimization",
  "impact": "p95 latency -19%",
  "context": "branch main",
  "technologies": ["TypeScript", "MCP"],
  "source": {
    "tool": "claude-code",  // "git" for passive commit events: no tool authored them
    "plugin_version": "0.1.0",
    "device_id": "dev_9f2c...",
    "repo": "product",
    "repo_hash": "sha256-of-origin-url",
    "branch": "main",
    "commit_sha": "abc123",
    "commit_message": "feat: ... (redacted client-side)",
    "files_changed": 12,
    "additions": 340,
    "deletions": 25,
    "evidence_commits": ["def456"]
  }
}
```

→ `{ "ok": true, "results": [{ "client_event_id": "...", "id": 812, "status": "processed", "deduplicated": false }] }`

Server behavior:

- Dedupe on `(user_id, client_event_id)` and on `(user_id, repo_hash, commit_sha)`;
  duplicates return the existing id with `"deduplicated": true`.
- Create the DataPoint directly in `status='processed'` with the supplied
  structured fields as the version payload, `achievement_sources=['Plugin']`,
  and `metadata.source='plugin'` plus the `source` object.
- **Never** enqueue AI analysis for plugin events.
- Per-item validation errors return `"error"` for that item without failing the batch.

### `GET /api/plugin/events/<id>/status`

→ `{ "ok": true, "id": 812, "status": "processed", "user_confirmation_status": "confirmed", "amount_awarded": 100 }`

Lets the plugin report "3 accomplishments verified, +120 credits".

## Client behavior

- Batched flush on queue growth + 60s timer; exponential backoff (30s → 30min) on 5xx/network.
- 4xx validation errors drop the event (after redaction there is nothing sensitive in the queue files, so users can inspect what was dropped).
- 401 pauses sync and surfaces reconnection in `get_status`.
- Fully offline-tolerant: the queue grows until connected.
