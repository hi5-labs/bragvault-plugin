# Contributing

Thanks for helping build BragVault's plugin!

## Ground rules

- **No LLM calls in this codebase.** The plugin must work on nothing but the
  user's editor subscription. CI rejects model-provider dependencies.
- **Local-first.** New capture features must journal locally and respect
  `sync.enabled`, the significance threshold, and the repo deny list.
- **Redact before send.** Anything that leaves the machine goes through
  `redactDeep()`. Add patterns with tests in `tests/redact.test.ts`.
- No native modules — `npx -y bragvault` must work without build toolchains.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Tests set `BRAGVAULT_HOME` to a temp directory; never touch the real
`~/.bragvault` in tests.

## Pull requests

Keep changes focused; include tests for behavior changes. The API contract in
`docs/api-contract.md` + `src/sync/types.ts` only changes with a version bump
and a matching backend change.
