/**
 * Post-deploy smoke test: the expected release is serving, healthy, and reaching its database.
 * Usage: pnpm smoke --api <url> --release <sha> [--worker <url>]
 */
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export interface SmokeTarget {
  apiUrl: string;
  release: string;
  workerUrl?: string | undefined;
}

interface Probe {
  status: number;
  body: unknown;
  error?: string;
}

async function probe(f: typeof fetch, url: string): Promise<Probe> {
  try {
    const res = await f(url);
    const body: unknown = await res.json().catch(() => undefined);
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: undefined, error: e instanceof Error ? e.message : String(e) };
  }
}

function releaseOf(body: unknown): string {
  const r = (body as { release?: unknown } | undefined)?.release;
  return typeof r === 'string' ? r : 'unknown';
}

async function checkOnce(t: SmokeTarget, f: typeof fetch): Promise<string[]> {
  const problems: string[] = [];
  const api = t.apiUrl.replace(/\/+$/, '');
  const health = await probe(f, `${api}/healthz`);
  if (health.status !== 200)
    problems.push(
      `api /healthz returned ${health.status}${health.error ? ` (${health.error})` : ''}`,
    );
  const ready = await probe(f, `${api}/readyz`);
  if (ready.status !== 200)
    problems.push(`api /readyz returned ${ready.status} (database unreachable?)`);
  const version = await probe(f, `${api}/version`);
  const serving = releaseOf(version.body);
  if (serving !== t.release)
    problems.push(`api is serving release ${serving}, expected ${t.release}`);
  if (t.workerUrl) {
    const worker = await probe(f, `${t.workerUrl.replace(/\/+$/, '')}/healthz`);
    if (worker.status !== 200) problems.push(`worker /healthz returned ${worker.status}`);
    else if (releaseOf(worker.body) !== t.release)
      problems.push(`worker is running release ${releaseOf(worker.body)}, expected ${t.release}`);
  }
  return problems;
}

export async function smoke(
  t: SmokeTarget,
  opts: { fetch?: typeof fetch; attempts?: number; delayMs?: number } = {},
): Promise<string[]> {
  const f = opts.fetch ?? fetch;
  const attempts = opts.attempts ?? 20;
  const delayMs = opts.delayMs ?? 3000;
  let problems: string[] = [];
  for (let i = 0; i < attempts; i++) {
    problems = await checkOnce(t, f);
    if (problems.length === 0) return [];
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { api: { type: 'string' }, release: { type: 'string' }, worker: { type: 'string' } },
  });
  if (!values.api || !values.release) {
    console.error('usage: pnpm smoke --api <url> --release <sha> [--worker <url>]');
    process.exit(2);
  }
  const problems = await smoke({
    apiUrl: values.api,
    release: values.release,
    workerUrl: values.worker,
  });
  if (problems.length > 0) {
    console.error(`smoke test FAILED:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`smoke test passed: release ${values.release} is healthy`);
}
