import { describe, expect, it } from 'vitest';
import { smoke } from '../scripts/smoke.js';

type Routes = Record<string, { status: number; body?: unknown } | 'network-error'>;

function fakeFetch(...rounds: Routes[]): typeof fetch {
  let call = 0;
  const perRound = 3;
  return ((url: string) => {
    const round = rounds[Math.min(Math.floor(call / perRound), rounds.length - 1)] ?? {};
    call += 1;
    const path = new URL(url).pathname;
    const r = round[path] ?? { status: 404 };
    if (r === 'network-error') return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status }));
  }) as typeof fetch;
}

const healthy: Routes = {
  '/healthz': { status: 200, body: { status: 'ok' } },
  '/readyz': { status: 200, body: { status: 'ready' } },
  '/version': { status: 200, body: { env: 'staging', release: 'abc123' } },
};
const target = { apiUrl: 'https://api.example.test/', release: 'abc123' };

describe('smoke', () => {
  it('passes a healthy deployment of the expected release', async () => {
    expect(await smoke(target, { fetch: fakeFetch(healthy), attempts: 1, delayMs: 0 })).toEqual([]);
  });

  it('fails when a different release is serving (stale revision)', async () => {
    const stale = { ...healthy, '/version': { status: 200, body: { release: 'old999' } } };
    const problems = await smoke(target, { fetch: fakeFetch(stale), attempts: 2, delayMs: 0 });
    expect(problems.join('\n')).toContain('old999');
  });

  it('fails when the database is unreachable', async () => {
    const noDb = { ...healthy, '/readyz': { status: 503 } };
    const problems = await smoke(target, { fetch: fakeFetch(noDb), attempts: 1, delayMs: 0 });
    expect(problems.join('\n')).toContain('/readyz');
  });

  it('reports network errors instead of throwing', async () => {
    const down: Routes = {
      '/healthz': 'network-error',
      '/readyz': 'network-error',
      '/version': 'network-error',
    };
    const problems = await smoke(target, { fetch: fakeFetch(down), attempts: 1, delayMs: 0 });
    expect(problems.length).toBeGreaterThan(0);
  });

  it('retries until a rolling deploy becomes healthy', async () => {
    const booting: Routes = {
      '/healthz': { status: 503 },
      '/readyz': { status: 503 },
      '/version': { status: 503 },
    };
    expect(
      await smoke(target, { fetch: fakeFetch(booting, healthy), attempts: 3, delayMs: 0 }),
    ).toEqual([]);
  });
});
