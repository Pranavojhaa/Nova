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
