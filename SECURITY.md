# Security Policy

## Reporting a vulnerability

Please email security@hi5.works with details. We aim to acknowledge reports
within 48 hours. Do not open public issues for security problems.

## Scope notes

- The plugin never transmits file contents or diffs.
- All outgoing strings pass through the redaction layer in
  `src/privacy/redact.ts`; bypasses of that layer are in scope and
  particularly appreciated.
- Credentials are stored at `~/.bragvault/credentials.json` with mode 0600.
