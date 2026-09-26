import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const promote = readFileSync(new URL('../.github/workflows/promote.yml', import.meta.url), 'utf8');

describe('ci workflow', () => {
  it('never cancels an in-flight run on main (a half-finished deploy can leave the DB migrated but the API not rolled)', () => {
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(ci).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it('builds and smoke-tests the container image on every run', () => {
    expect(ci).toMatch(/^ {2}image:/m);
    expect(ci).toContain('scripts/ci-image-smoke.sh');
  });

  it('validates both Terraform environments and lints shell scripts', () => {
    expect(ci).toMatch(/^ {2}infra:/m);
    expect(ci).toContain('terraform -chdir=infra/terraform fmt -check -recursive');
    expect(ci).toContain('for env in staging prod');
    expect(ci).toContain('shellcheck scripts/*.sh');
  });
});

describe('deploy workflows', () => {
  it('deploys to staging only from pushes to main, once bootstrap has enabled it', () => {
    expect(ci).toMatch(/^ {2}deploy-staging:/m);
    expect(ci).toContain("github.event_name == 'push'");
    expect(ci).toContain("github.ref == 'refs/heads/main'");
    expect(ci).toContain("vars.STAGING_DEPLOY_ENABLED == 'true'");
    expect(ci).toContain('environment: staging');
  });

  it('marks a digest verified only after the staging smoke test passes', () => {
    const smokeAt = ci.indexOf('pnpm smoke');
    const tagAt = ci.indexOf('verified-');
    expect(smokeAt).toBeGreaterThan(-1);
    expect(tagAt).toBeGreaterThan(smokeAt);
  });

  it('promotes to prod only through the production environment, the readiness gate, and a verified digest', () => {
    expect(promote).toContain('workflow_dispatch');
    expect(promote).toContain('environment: production');
    expect(promote).toContain('pnpm readiness');
    expect(promote).toContain('verified-${SHA}');
    expect(promote).toContain('cancel-in-progress: false');
  });

  it('reads the dispatch input only once, into env (never interpolated into a shell script)', () => {
    expect(promote.match(/inputs\.sha/g)).toHaveLength(1);
    expect(promote).toContain('SHA: ${{ inputs.sha }}');
  });

  it('refuses to promote an image whose baked NOVA_RELEASE is not the promoted SHA, before deploying', () => {
    const check = promote.indexOf('NOVA_RELEASE=');
    const deploy = promote.indexOf('scripts/deploy.sh');
    const describeDigest = promote.indexOf('images describe');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(deploy);
    expect(check).toBeGreaterThan(describeDigest);
  });

  it('isolates the prod-readiness gate from GCP credentials (no id-token, no environment)', () => {
    const gateStart = promote.indexOf('\n  gate:');
    const promoteStart = promote.indexOf('\n  promote:');
    expect(gateStart).toBeGreaterThan(-1);
    expect(promoteStart).toBeGreaterThan(gateStart);
    const gateBlock = promote.slice(gateStart, promoteStart);
    expect(gateBlock).not.toContain('id-token');
    expect(gateBlock).not.toContain('environment:');
  });

  it('runs the prod readiness gate in the unprivileged gate job', () => {
    const gateStart = promote.indexOf('\n  gate:');
    const promoteStart = promote.indexOf('\n  promote:');
    const gateBlock = promote.slice(gateStart, promoteStart);
    expect(gateBlock).toContain('pnpm readiness');
  });

  it('re-verifies the promoted SHA is on main inside the privileged job, before any pnpm install or GCP auth', () => {
    const promoteStart = promote.indexOf('\n  promote:');
    const promoteBlock = promote.slice(promoteStart);
    const mergeBaseAt = promoteBlock.indexOf('merge-base --is-ancestor');
    const firstPnpmInstall = promoteBlock.indexOf('pnpm install');
    const authAt = promoteBlock.indexOf('google-github-actions/auth');
    expect(mergeBaseAt).toBeGreaterThan(-1);
    expect(mergeBaseAt).toBeLessThan(firstPnpmInstall);
    expect(mergeBaseAt).toBeLessThan(authAt);
  });

  it('checks ancestry against the fully-qualified remote ref, never the ambiguous "origin/main" (a fetched tag of the same name would shadow it)', () => {
    const ancestorChecks = promote.match(/merge-base --is-ancestor "\$SHA" \S+/g) ?? [];
    expect(ancestorChecks.length).toBe(2);
    for (const check of ancestorChecks) {
      expect(check).toContain('refs/remotes/origin/main');
    }
    expect(promote).not.toMatch(/is-ancestor "\$SHA" origin\/main(?!\S)/);
  });

  it('pins the promote job to run only after the gate job (never trusting a stale or skipped gate)', () => {
    expect(promote).toContain('needs: gate');
  });

  it("runs the gate job's ancestor check before the gate job's own pnpm install", () => {
    const gateStart = promote.indexOf('\n  gate:');
    const promoteStart = promote.indexOf('\n  promote:');
    const gateBlock = promote.slice(gateStart, promoteStart);
    const mergeBaseAt = gateBlock.indexOf('merge-base --is-ancestor');
    const pnpmInstallAt = gateBlock.indexOf('pnpm install');
    expect(mergeBaseAt).toBeGreaterThan(-1);
    expect(pnpmInstallAt).toBeGreaterThan(-1);
    expect(mergeBaseAt).toBeLessThan(pnpmInstallAt);
  });
});
