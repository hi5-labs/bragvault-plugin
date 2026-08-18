import { describe, expect, it } from 'vitest';
import { redact, redactDeep, entropy } from '../src/privacy/redact.js';

describe('redact', () => {
  // Fixtures are built at runtime so realistic token shapes never appear as
  // literals in source (GitHub push protection would flag them for every
  // contributor).
  const cases: Array<[string, string, string]> = [
    ['aws key', `creds ${'AKIA'}IOSFODNN7EXAMPLE here`, '[REDACTED:aws-key]'],
    ['github token', `push with ${'ghp'}_${'0123456789abcdefghijklmnopqrstuvwxyz'}AB`, '[REDACTED:github-token]'],
    ['github pat', `use ${'github'}_pat_${'11ABCDEFG0123456789abcdefghijklm'}`, '[REDACTED:github-pat]'],
    ['openai key', `set ${'sk'}-proj-${'abcdefghijklmnopqrstuvwx12345'}`, '[REDACTED:openai-key]'],
    ['slack token', `bot ${'xoxb'}-${'1234567890'}-${'abcdefghij'}`, '[REDACTED:slack-token]'],
    ['stripe key', `charge with ${'sk'}_live_${'abcdefghijklmnopqrstuvwx'}`, '[REDACTED:'],
    ['jwt', `auth ${'eyJ'}hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${'eyJ'}zdWIiOiIxMjM0NTY3ODkwIn0.${'dozjgNryP4J3jVmNHl0w5N'}_XgL0n3I9PlFUP0THsR8U`, '[REDACTED:jwt]'],
    ['bragvault token', `token ${'bv'}_${'abcdefghijklmnopqrstuvwxyz123456'}`, '[REDACTED:bragvault-token]'],
    ['password assignment', 'set password=SuperSecret123! now', '[REDACTED:secret]'],
    ['url credentials', 'clone https://user:hunter22secret@github.com/x/y.git', '[REDACTED'],
  ];

  it.each(cases)('redacts %s', (_name, input, marker) => {
    const out = redact(input);
    expect(out).toContain(marker.startsWith('[') ? marker : marker);
    expect(out).not.toEqual(input);
  });

  it('redacts quoted values with spaces', () => {
    const out = redact('set password="Super Secret 123" for staging');
    expect(out).toContain('[REDACTED:secret]');
    expect(out).not.toContain('Super Secret 123');
  });

  it('redacts JSON-style quoted keys', () => {
    const out = redact('{"password": "hunter22secret", "user": "bob"}');
    expect(out).toContain('[REDACTED:secret]');
    expect(out).not.toContain('hunter22secret');
    expect(out).toContain('"user": "bob"');
  });

  it('redacts camelCase apiKey assignments', () => {
    const out = redact('const apiKey = "abc123def456";');
    expect(out).toContain('[REDACTED:secret]');
    expect(out).not.toContain('abc123def456');
  });

  it('redacts Authorization headers', () => {
    const out = redact('curl -H "Authorization: Bearer abc.def.ghi-jkl"');
    expect(out).toContain('[REDACTED:auth-header]');
    expect(out).not.toContain('abc.def.ghi-jkl');
  });

  it('redacts short numeric/symbol secrets', () => {
    expect(redact('password=12345')).toContain('[REDACTED:secret]');
    expect(redact('token=aB3!x')).toContain('[REDACTED:secret]');
  });

  it('leaves prose after secret-like words alone', () => {
    const msg = 'auth: added login flow';
    expect(redact(msg)).toEqual(msg);
  });

  it('redacts client_secret assignments', () => {
    const out = redact('client_secret=verysecret99 in env');
    expect(out).toContain('[REDACTED:secret]');
  });

  it('redacts PEM blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----';
    expect(redact(`key:\n${pem}`)).toContain('[REDACTED:private-key]');
  });

  it('leaves ordinary commit messages alone', () => {
    const msg = 'feat: add retry logic to sync queue with exponential backoff';
    expect(redact(msg)).toEqual(msg);
  });

  it('leaves git SHAs alone', () => {
    const msg = 'revert 3f8a1b2c4d5e6f708192a3b4c5d6e7f801234567';
    expect(redact(msg)).toEqual(msg);
  });

  it('redacts high-entropy blobs', () => {
    const blob = 'A7f$k9Lm2QwXzP0v5RtY8uB3nH6jD1cE4gS7iK0oM9pZ'.replace(/[$]/g, 'x');
    const out = redact(`token ${blob}`);
    expect(out).toContain('[REDACTED:high-entropy]');
  });

  it('redactDeep walks nested objects', () => {
    const obj = { a: 'password=topsecret123', b: [{ c: 'plain text' }] };
    const out = redactDeep(obj);
    expect(out.a).toContain('[REDACTED:secret]');
    expect(out.b[0]!.c).toEqual('plain text');
  });

  it('entropy is higher for random strings', () => {
    expect(entropy('aaaaaaaaaa')).toBeLessThan(entropy('a8Fk2$pQz!'));
  });
});
