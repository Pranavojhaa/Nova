import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for secrets at rest (OAuth refresh tokens).
 *
 * Each value gets a fresh random data key; the data key is wrapped by the master key.
 * Rotating the master key means re-wrapping data keys, not re-encrypting payloads.
 * The master key comes from config (in production: the host's secret manager / KMS).
 *
 * Layout: version(1) | wrapIv(12) | wrapTag(16) | wrappedKey(32) | iv(12) | tag(16) | ciphertext
 */
const VERSION = 1;
const ALG = 'aes-256-gcm';

export class SecretBox {
  private readonly masterKey: Buffer;

  constructor(masterKeyBase64: string) {
    const key = Buffer.from(masterKeyBase64, 'base64');
    if (key.length !== 32) throw new Error('master key must be 32 bytes');
    this.masterKey = key;
  }

  /** `aad` binds the ciphertext to its context (e.g. the connection id) so rows can't be swapped. */
  seal(plaintext: string, aad: string): Buffer {
    const dataKey = randomBytes(32);
    const [wrapIv, wrapTag, wrappedKey] = encrypt(this.masterKey, dataKey, Buffer.from(aad));
    const [iv, tag, ciphertext] = encrypt(
      dataKey,
      Buffer.from(plaintext, 'utf8'),
      Buffer.from(aad),
    );
    return Buffer.concat([
      Buffer.from([VERSION]),
      wrapIv,
      wrapTag,
      wrappedKey,
      iv,
      tag,
      ciphertext,
    ]);
  }

  open(sealed: Buffer, aad: string): string {
    if (sealed[0] !== VERSION) throw new Error('unsupported secret format');
    let o = 1;
    const take = (n: number) => sealed.subarray(o, (o += n));
    const wrapIv = take(12);
    const wrapTag = take(16);
    const wrappedKey = take(32);
    const iv = take(12);
    const tag = take(16);
    const ciphertext = sealed.subarray(o);
    const dataKey = decrypt(this.masterKey, wrapIv, wrapTag, wrappedKey, Buffer.from(aad));
    return decrypt(dataKey, iv, tag, ciphertext, Buffer.from(aad)).toString('utf8');
  }
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): [Buffer, Buffer, Buffer] {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext];
}

function decrypt(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
