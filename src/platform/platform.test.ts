import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './crypto.js';
import { canonicalJson, contentHash } from './hashing.js';
import { uuidv7 } from './ids.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

const key = () => randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('round-trips and never stores plaintext', () => {
    const box = new SecretBox(key());
    const sealed = box.seal('refresh-token-123', 'connection:abc');
    expect(sealed.includes(Buffer.from('refresh-token-123'))).toBe(false);
    expect(box.open(sealed, 'connection:abc')).toBe('refresh-token-123');
  });

  it('refuses to open with the wrong context (row swapping) or wrong key', () => {
    const box = new SecretBox(key());
    const sealed = box.seal('t', 'connection:abc');
    expect(() => box.open(sealed, 'connection:other')).toThrow();
    expect(() => new SecretBox(key()).open(sealed, 'connection:abc')).toThrow();
  });

  it('detects tampering', () => {
    const box = new SecretBox(key());
    const sealed = box.seal('t', 'a');
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 1;
    expect(() => box.open(sealed, 'a')).toThrow();
  });
});

describe('hashing', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(contentHash({ x: 1, y: 2 })).toBe(contentHash({ y: 2, x: 1 }));
  });

  it('changes when content changes', () => {
    expect(contentHash({ body: 'Tue 14:00' })).not.toBe(contentHash({ body: 'Tue 15:00' }));
  });
});

describe('uuidv7', () => {
  it('is a v7 uuid and sorts by time', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe('config', () => {
  it('reports invalid keys without echoing secret values', () => {
    const secret = 'not-a-valid-key-but-secret';
    let message = '';
    try {
      loadConfig({ DATABASE_URL: 'postgres://x', NOVA_MASTER_KEY: secret });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('NOVA_MASTER_KEY');
    expect(message).not.toContain(secret);
  });

  const base = { DATABASE_URL: 'postgres://nova@localhost:5432/nova', NOVA_MASTER_KEY: key() };
  const messageOf = (env: Record<string, string>): string => {
    try {
      loadConfig(env);
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  };

  it('defaults to the dev environment and a local release', () => {
    const c = loadConfig({ ...base, NOVA_RECIPIENT_ALLOWLIST: 'me@example.com' });
    expect(c.NOVA_ENV).toBe('dev');
    expect(c.NOVA_RELEASE).toBe('local');
    expect(c.HEALTH_PORT).toBeUndefined();
  });

  it('requires a recipient allowlist outside prod', () => {
    expect(messageOf({ ...base })).toContain('NOVA_RECIPIENT_ALLOWLIST');
    expect(messageOf({ ...base, NOVA_ENV: 'staging' })).toContain('NOVA_RECIPIENT_ALLOWLIST');
  });

  it('treats an empty allowlist as a configuration error, not as "no restriction"', () => {
    expect(messageOf({ ...base, NOVA_ENV: 'staging', NOVA_RECIPIENT_ALLOWLIST: '' })).toContain(
      'NOVA_RECIPIENT_ALLOWLIST',
    );
    expect(messageOf({ ...base, NOVA_ENV: 'staging', NOVA_RECIPIENT_ALLOWLIST: ' , ' })).toContain(
      'NOVA_RECIPIENT_ALLOWLIST',
    );
  });

  it('rejects a malformed allowlist entry', () => {
    expect(
      messageOf({ ...base, NOVA_ENV: 'staging', NOVA_RECIPIENT_ALLOWLIST: 'me@example.com,nope' }),
    ).toContain('NOVA_RECIPIENT_ALLOWLIST');
  });

  it('normalises allowlist entries to trimmed lowercase', () => {
    const c = loadConfig({
      ...base,
      NOVA_ENV: 'staging',
      NOVA_RECIPIENT_ALLOWLIST: ' Me@Example.com , you@example.com',
    });
    expect(c.NOVA_RECIPIENT_ALLOWLIST).toEqual(['me@example.com', 'you@example.com']);
  });

  it('allows prod without an allowlist, and with one', () => {
    expect(loadConfig({ ...base, NOVA_ENV: 'prod' }).NOVA_RECIPIENT_ALLOWLIST).toBeUndefined();
    expect(
      loadConfig({ ...base, NOVA_ENV: 'prod', NOVA_RECIPIENT_ALLOWLIST: 'me@example.com' })
        .NOVA_RECIPIENT_ALLOWLIST,
    ).toEqual(['me@example.com']);
  });

  it('accepts the Cloud SQL unix-socket database URL used on Cloud Run', () => {
    const c = loadConfig({
      ...base,
      NOVA_ENV: 'staging',
      NOVA_RECIPIENT_ALLOWLIST: 'me@example.com',
      DATABASE_URL:
        'postgresql://nova:p%40ss@localhost/nova?host=/cloudsql/proj:asia-south1:nova-staging',
      NOVA_RELEASE: 'abc123',
      HEALTH_PORT: '8080',
    });
    expect(c.NOVA_RELEASE).toBe('abc123');
    expect(c.HEALTH_PORT).toBe(8080);
  });

  it('rejects an unknown environment name', () => {
    expect(
      messageOf({ ...base, NOVA_ENV: 'production', NOVA_RECIPIENT_ALLOWLIST: 'a@b.co' }),
    ).toContain('NOVA_ENV');
  });
});

describe('logger', () => {
  it('redacts tokens', () => {
    let out = '';
    const sink = new Writable({
      write(chunk: Buffer, _e, cb) {
        out += chunk.toString();
        cb();
      },
    });
    createLogger('info', sink).info({ connection: { refreshToken: 'super-secret' } }, 'x');
    expect(out).not.toContain('super-secret');
    expect(out).toContain('[redacted]');
  });
});
