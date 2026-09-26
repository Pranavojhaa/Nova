/**
 * Authority decisions. Pure and deterministic: no database, no network, no model.
 * The model's output is a request, never a permission; nothing here reads model rationale.
 *
 * Evaluated twice for every external effect: when the action is proposed, and again
 * immediately before dispatch (inside the transaction that reserves the permit), so a
 * revoked or superseded envelope stops work that was already queued.
 */
import type { RiskClass } from '../capabilities/index.js';

export interface PolicyPermit {
  id: string;
  capability: string;
  recipients: Array<{ entityId: string; address: string }>;
  maxUses: number;
  constraints: Record<string, unknown>;
}

export interface PolicyEnvelope {
  id: string;
  version: number;
  status: string;
  terms: { permits: PolicyPermit[]; expiresAt: string };
}

export interface PolicyCapability {
  name: string;
  risk: RiskClass;
  externalTargets(input: unknown): string[];
  permitAllows?(input: unknown, constraints: Record<string, unknown>): boolean;
}

export interface PolicyInput {
  capability: PolicyCapability;
  input: unknown;
  goal: { open: boolean; participantAddresses: ReadonlySet<string> };
  envelope: PolicyEnvelope | undefined;
  /** Uses already consumed per permit id by *other* actions. */
  permitUsage: ReadonlyMap<string, number>;
  now: Date;
}

export type PolicyReason =
  | 'goal_not_open'
  | 'destructive_not_authorizable'
  | 'recipient_not_pinned'
  | 'low_risk'
  | 'own_resources'
  | 'covered_by_envelope'
  | 'envelope_expired'
  | 'permit_exhausted'
  | 'no_covering_permit'
  | 'no_active_envelope';

export type PolicyDecision =
  | {
      decision: 'allow';
      reason: PolicyReason;
      permit?: { envelopeId: string; envelopeVersion: number; permitId: string };
    }
  | { decision: 'require_authorization'; reason: PolicyReason }
  | { decision: 'deny'; reason: PolicyReason };

export function evaluatePolicy(p: PolicyInput): PolicyDecision {
  if (!p.goal.open) return { decision: 'deny', reason: 'goal_not_open' };
  if (p.capability.risk === 'destructive')
    return { decision: 'deny', reason: 'destructive_not_authorizable' };

  // Recipient pinning: the hard boundary against prompt injection. Checked before anything
  // can grant authority, and independent of what the model or any email says.
  const targets = p.capability.externalTargets(p.input);
  if (targets.some((t) => !p.goal.participantAddresses.has(t))) {
    return { decision: 'deny', reason: 'recipient_not_pinned' };
  }

  if (p.capability.risk === 'read' || p.capability.risk === 'draft')
    return { decision: 'allow', reason: 'low_risk' };
  if (p.capability.risk === 'write_self' && targets.length === 0)
    return { decision: 'allow', reason: 'own_resources' };

  // communicate_external (or write_self that reaches someone): needs a covering permit.
  const env = p.envelope;
  if (!env || env.status !== 'active')
    return { decision: 'require_authorization', reason: 'no_active_envelope' };
  if (new Date(env.terms.expiresAt) <= p.now)
    return { decision: 'require_authorization', reason: 'envelope_expired' };

  let exhausted = false;
  for (const permit of env.terms.permits) {
    if (permit.capability !== p.capability.name) continue;
    const allowed = new Set(permit.recipients.map((r) => r.address));
    if (!targets.every((t) => allowed.has(t))) continue;
    if (p.capability.permitAllows && !p.capability.permitAllows(p.input, permit.constraints))
      continue;
    if ((p.permitUsage.get(permit.id) ?? 0) >= permit.maxUses) {
      exhausted = true;
      continue;
    }
    return {
      decision: 'allow',
      reason: 'covered_by_envelope',
      permit: { envelopeId: env.id, envelopeVersion: env.version, permitId: permit.id },
    };
  }
  return {
    decision: 'require_authorization',
    reason: exhausted ? 'permit_exhausted' : 'no_covering_permit',
  };
}
