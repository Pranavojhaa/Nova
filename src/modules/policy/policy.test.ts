import { describe, expect, it } from 'vitest';
import {
  evaluatePolicy,
  type PolicyCapability,
  type PolicyEnvelope,
  type PolicyInput,
} from './index.js';

const RAHUL = 'rahul@example.com';
const NOW = new Date('2026-10-01T09:00:00Z');

const email: PolicyCapability = {
  name: 'email.send',
  risk: 'communicate_external',
  externalTargets: (i) => (i as { to: string[] }).to,
  permitAllows: (i, c) =>
    c['threadId'] === undefined || c['threadId'] === (i as { threadId?: string }).threadId,
};

const envelope = (overrides: Partial<PolicyEnvelope> = {}): PolicyEnvelope => ({
  id: 'env-1',
  version: 1,
  status: 'active',
  terms: {
    expiresAt: '2026-10-08T00:00:00Z',
    permits: [
      {
        id: 'initial-email',
        capability: 'email.send',
        recipients: [{ entityId: 'e-rahul', address: RAHUL }],
        maxUses: 1,
        constraints: {},
      },
    ],
  },
  ...overrides,
});

function run(overrides: Partial<PolicyInput> = {}) {
  return evaluatePolicy({
    capability: email,
    input: { to: [RAHUL] },
    goal: { open: true, participantAddresses: new Set([RAHUL]) },
    envelope: envelope(),
    permitUsage: new Map(),
    now: NOW,
    ...overrides,
  });
}

describe('evaluatePolicy', () => {
  it('allows an external email covered by an active envelope permit', () => {
    expect(run()).toEqual({
      decision: 'allow',
      reason: 'covered_by_envelope',
      permit: { envelopeId: 'env-1', envelopeVersion: 1, permitId: 'initial-email' },
    });
  });

  it('denies a recipient outside the goal participants even if an envelope exists (injection defense)', () => {
    expect(run({ input: { to: ['attacker@evil.com'] } })).toEqual({
      decision: 'deny',
      reason: 'recipient_not_pinned',
    });
    expect(run({ input: { to: [RAHUL, 'attacker@evil.com'] } })).toEqual({
      decision: 'deny',
      reason: 'recipient_not_pinned',
    });
  });

  it('pins recipients for every risk class, not only external communication', () => {
    const read: PolicyCapability = {
      name: 'email.search',
      risk: 'read',
      externalTargets: () => ['attacker@evil.com'],
    };
    expect(run({ capability: read })).toEqual({ decision: 'deny', reason: 'recipient_not_pinned' });
  });

  it('requires authorization without an active envelope', () => {
    expect(run({ envelope: undefined })).toEqual({
      decision: 'require_authorization',
      reason: 'no_active_envelope',
    });
    expect(run({ envelope: envelope({ status: 'revoked' }) })).toEqual({
      decision: 'require_authorization',
      reason: 'no_active_envelope',
    });
    expect(run({ envelope: envelope({ status: 'superseded' }) })).toEqual({
      decision: 'require_authorization',
      reason: 'no_active_envelope',
    });
  });

  it('requires authorization once the envelope has expired', () => {
    expect(run({ now: new Date('2026-10-08T00:00:00Z') })).toEqual({
      decision: 'require_authorization',
      reason: 'envelope_expired',
    });
  });

  it('requires authorization once the permit is used up', () => {
    expect(run({ permitUsage: new Map([['initial-email', 1]]) })).toEqual({
      decision: 'require_authorization',
      reason: 'permit_exhausted',
    });
  });

  it('requires authorization when a permit exists for another recipient on the goal', () => {
    const other = 'rahul.work@example.com';
    expect(
      run({
        input: { to: [other] },
        goal: { open: true, participantAddresses: new Set([RAHUL, other]) },
      }),
    ).toEqual({
      decision: 'require_authorization',
      reason: 'no_covering_permit',
    });
  });

  it('applies capability-specific permit constraints', () => {
    const env = envelope();
    const permit = env.terms.permits[0];
    if (!permit) throw new Error('fixture');
    permit.constraints = { threadId: 't-1' };
    expect(run({ envelope: env, input: { to: [RAHUL], threadId: 't-2' } }).decision).toBe(
      'require_authorization',
    );
    expect(run({ envelope: env, input: { to: [RAHUL], threadId: 't-1' } }).decision).toBe('allow');
  });

  it('never lets an envelope authorize destructive actions', () => {
    const del: PolicyCapability = {
      name: 'email.send',
      risk: 'destructive',
      externalTargets: () => [],
    };
    expect(run({ capability: del })).toEqual({
      decision: 'deny',
      reason: 'destructive_not_authorizable',
    });
  });

  it('allows reads and drafts, and write_self with no external targets, without an envelope', () => {
    for (const risk of ['read', 'draft', 'write_self'] as const) {
      const cap: PolicyCapability = { name: `x.${risk}`, risk, externalTargets: () => [] };
      expect(run({ capability: cap, envelope: undefined }).decision).toBe('allow');
    }
  });

  it('treats write_self that reaches another person as external', () => {
    const invite: PolicyCapability = {
      name: 'calendar.create_event',
      risk: 'write_self',
      externalTargets: () => [RAHUL],
    };
    expect(run({ capability: invite, envelope: undefined })).toEqual({
      decision: 'require_authorization',
      reason: 'no_active_envelope',
    });
  });

  it('denies everything on a closed goal', () => {
    expect(run({ goal: { open: false, participantAddresses: new Set([RAHUL]) } })).toEqual({
      decision: 'deny',
      reason: 'goal_not_open',
    });
  });

  describe('recipient allowlist (dev and staging)', () => {
    const ONLY_ME = new Set(['pranav@example.com']);

    it('denies a pinned, envelope-covered recipient who is not allowlisted', () => {
      expect(run({ recipientAllowlist: ONLY_ME })).toEqual({
        decision: 'deny',
        reason: 'recipient_not_allowlisted',
      });
    });

    it('allows an allowlisted recipient, comparing case-insensitively', () => {
      const mixed = 'Rahul@Example.com';
      const env = envelope();
      const permit = env.terms.permits[0];
      if (!permit) throw new Error('fixture');
      permit.recipients = [{ entityId: 'e-rahul', address: mixed }];
      expect(
        run({
          input: { to: [mixed] },
          goal: { open: true, participantAddresses: new Set([mixed]) },
          envelope: env,
          recipientAllowlist: new Set([RAHUL]),
        }).decision,
      ).toBe('allow');
    });

    it('applies to every risk class, including reads', () => {
      const read: PolicyCapability = {
        name: 'email.search',
        risk: 'read',
        externalTargets: () => [RAHUL],
      };
      expect(run({ capability: read, envelope: undefined, recipientAllowlist: ONLY_ME })).toEqual({
        decision: 'deny',
        reason: 'recipient_not_allowlisted',
      });
    });

    it('reports recipient pinning first when both rules fail', () => {
      expect(run({ input: { to: ['attacker@evil.com'] }, recipientAllowlist: ONLY_ME })).toEqual({
        decision: 'deny',
        reason: 'recipient_not_pinned',
      });
    });

    it('does not affect actions with no external targets', () => {
      const own: PolicyCapability = {
        name: 'x.own',
        risk: 'write_self',
        externalTargets: () => [],
      };
      expect(run({ capability: own, envelope: undefined, recipientAllowlist: ONLY_ME })).toEqual({
        decision: 'allow',
        reason: 'own_resources',
      });
    });
  });
});
