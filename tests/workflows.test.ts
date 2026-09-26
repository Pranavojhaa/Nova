import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

describe('ci workflow', () => {
  it('never cancels an in-flight run on main (a half-finished deploy can leave the DB migrated but the API not rolled)', () => {
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(ci).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it('builds and smoke-tests the container image on every run', () => {
    expect(ci).toMatch(/^ {2}image:/m);
    expect(ci).toContain('scripts/ci-image-smoke.sh');
  });
});
