import type { ACTION_STATUSES } from './schema.js';

export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * intent -> idempotency key -> prepare -> commit -> dispatch -> (uncertain -> reconcile) -> receipt -> verify
 *
 * The one rule that prevents duplicate side effects: once an action has reached `dispatching`,
 * the only way back to another dispatch is through reconciliation proving the effect did not happen.
 */
const ALLOWED: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ['authorized', 'awaiting_authorization', 'denied'],
  awaiting_authorization: ['authorized', 'denied', 'cancelled'],
  authorized: ['prepared', 'awaiting_authorization', 'cancelled'],
  prepared: ['dispatching', 'cancelled'],
  dispatching: ['succeeded', 'failed_retryable', 'failed_permanent', 'uncertain'],
  uncertain: ['reconciling'],
  reconciling: ['succeeded', 'failed_retryable', 'uncertain'],
  failed_retryable: ['prepared', 'awaiting_authorization', 'cancelled', 'failed_permanent'],
  succeeded: ['verified', 'verification_failed'],
  verified: [],
  verification_failed: [],
  failed_permanent: [],
  denied: [],
  cancelled: [],
};

export function canTransitionAction(from: ActionStatus, to: ActionStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function isTerminalActionStatus(s: ActionStatus): boolean {
  return ALLOWED[s].length === 0;
}

/** Statuses in which an action holds one use of its permit. */
export const PERMIT_CONSUMING: readonly ActionStatus[] = [
  'prepared',
  'dispatching',
  'uncertain',
  'reconciling',
  'succeeded',
  'failed_retryable',
  'verified',
  'verification_failed',
];

export const ALL_TRANSITIONS = ALLOWED;
