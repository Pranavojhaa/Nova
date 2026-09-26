import type { z } from 'zod';

/**
 * How much an action can affect the world. Declared by the capability, never by the model.
 *  - read:                 observes only
 *  - draft:                creates artifacts only the user sees
 *  - write_self:           changes the user's own resources, nobody else is notified
 *  - communicate_external: reaches another person (email, calendar invite)
 *  - destructive:          deletes or cancels; not authorizable by envelope in v0
 */
export type RiskClass = 'read' | 'draft' | 'write_self' | 'communicate_external' | 'destructive';

export interface ExecutionContext {
  actionId: string;
  userId: string;
  idempotencyKey: string;
  /** Hash of the exact frozen input; stamped on provider artifacts where possible. */
  contentHash: string;
}

export interface DispatchResult {
  provider: string;
  /** Provider's id for the effect (Gmail message id, Calendar event id). */
  providerRef: string;
  details?: Record<string, unknown>;
}

export type ReconcileResult = { found: true; result: DispatchResult } | { found: false };

export type VerifyResult = {
  status: 'verified' | 'failed' | 'pending';
  evidence: Record<string, unknown>;
};

/**
 * The provider said, definitively, that the effect did not happen.
 * Anything else thrown from dispatch is treated as *uncertain* and goes to reconciliation.
 */
export class NotPerformedError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * A controlled interface to an external system.
 *
 * Contract every implementation must honour:
 *  - dispatch stamps ctx.actionId onto the provider artifact (header, extended property) so
 *    reconcile can find it later.
 *  - reconcile returns {found:false} only when it can say so authoritatively. If the provider
 *    is eventually consistent or unreachable, it must throw instead; a false negative
 *    causes a duplicate side effect.
 *  - verify re-reads provider state; it never trusts the dispatch response alone.
 */
export interface Capability<I = unknown> {
  name: string;
  risk: RiskClass;
  input: z.ZodType<I>;
  /** External identities this input would reach (normalized email addresses). Used for pinning. */
  externalTargets(input: I): string[];
  /** Capability-specific check that input stays inside a permit's constraints (e.g. slot is one of the allowed slots). */
  permitAllows?(input: I, constraints: Record<string, unknown>): boolean;
  dispatch(input: I, ctx: ExecutionContext): Promise<DispatchResult>;
  reconcile(input: I, ctx: ExecutionContext): Promise<ReconcileResult>;
  verify(input: I, ctx: ExecutionContext, result: DispatchResult): Promise<VerifyResult>;
}

export type AnyCapability = Capability<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
