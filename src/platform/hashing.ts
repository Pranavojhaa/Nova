import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted recursively. Used wherever a hash must be stable
 * (action content hashes, authorization envelope term hashes).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function contentHash(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}
