/**
 * Secret redaction applied to every outgoing string, and to queue entries at
 * enqueue time (defense in depth: the wire layer redacts again).
 */

interface Pattern {
  type: string;
  regex: RegExp;
}

const PATTERNS: Pattern[] = [
  { type: 'aws-key', regex: /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g },
  { type: 'github-token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/g },
  { type: 'github-pat', regex: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { type: 'openai-key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'anthropic-key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'slack-token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: 'stripe-key', regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { type: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
  { type: 'private-key', regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
  { type: 'bragvault-token', regex: /\bbv_[A-Za-z0-9_-]{20,}\b/g },
  // Authorization: Bearer <anything-to-end-of-token>
  { type: 'auth-header', regex: /\b(authorization\s*[:=]\s*)(["']?)(?:bearer|basic|token)\s+[^\s"',;]+\2/gi },
  { type: 'url-credentials', regex: /(?<=\/\/)[^\s/@:]+:[^\s/@]+@/g },
];

const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret|private[_-]?key|auth)/i;

// Assignment forms, checked in order:
//  key = "value with spaces"  /  "key": "value"   (quoted value, any content)
const QUOTED_ASSIGNMENT = new RegExp(
  `(["']?)\\b${SECRET_KEY.source}\\b\\1(\\s*[:=]\\s*)("([^"\\\\]|\\\\.)*"|'([^'\\\\]|\\\\.)*')`,
  'gi',
);
//  key = value  /  key: value   (unquoted, no spaces)
const BARE_ASSIGNMENT = new RegExp(
  `(["']?)\\b${SECRET_KEY.source}\\b\\1(\\s*[:=]\\s*)([^\\s"',;]+)`,
  'gi',
);

/**
 * Short plain words after a secret-looking key are usually prose, not
 * secrets ("auth: added login flow"); anything with digits, symbols,
 * mixed case, or length >= 8 is treated as a secret.
 */
function looksLikeProse(value: string): boolean {
  return /^[a-z]{1,7}$/.test(value);
}

/** Shannon entropy per character, used to catch generic high-entropy blobs. */
export function entropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const ENTROPY_CANDIDATE = /\b[A-Za-z0-9+/_=-]{32,}\b/g;

export function redact(text: string): string {
  let out = text;
  for (const { type, regex } of PATTERNS) {
    if (type === 'auth-header') {
      out = out.replace(regex, (_m, prefix: string, quote: string) => `${prefix}${quote}[REDACTED:auth-header]${quote}`);
    } else {
      out = out.replace(regex, `[REDACTED:${type}]`);
    }
  }
  out = out.replace(
    QUOTED_ASSIGNMENT,
    (_m, keyQuote: string, key: string, sep: string) => `${keyQuote}${key}${keyQuote}${sep}"[REDACTED:secret]"`,
  );
  out = out.replace(
    BARE_ASSIGNMENT,
    (m, keyQuote: string, key: string, sep: string, value: string) =>
      looksLikeProse(value) ? m : `${keyQuote}${key}${keyQuote}${sep}[REDACTED:secret]`,
  );
  // Entropy heuristic: long random-looking tokens that survived the patterns.
  out = out.replace(ENTROPY_CANDIDATE, (m) => {
    if (m.includes('[REDACTED')) return m;
    // Skip things that look like hex hashes of common lengths (git SHAs etc.)
    if (/^[0-9a-f]{32,64}$/i.test(m)) return m;
    return entropy(m) > 4.5 ? '[REDACTED:high-entropy]' : m;
  });
  return out;
}

/** Redact every string field of a JSON-serializable value, in place. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
