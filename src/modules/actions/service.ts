import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../platform/db/client.js';
import type { Clock } from '../../platform/clock.js';
import type { Logger } from '../../platform/logger.js';
import { contentHash } from '../../platform/hashing.js';
import { uuidv7 } from '../../platform/ids.js';
import { enqueue } from '../../platform/jobs/queue.js';
import { emailsForEntities } from '../brain/index.js';
import { getGoal, isTerminalGoalStatus, participantEntityIds } from '../goals/index.js';
import { activeEnvelopeForGoal } from '../authorization/index.js';
import { evaluatePolicy, type PolicyDecision } from '../policy/index.js';
import {
  NotPerformedError,
  type AnyCapability,
  type CapabilityRegistry,
  type DispatchResult,
  type ExecutionContext,
} from '../capabilities/index.js';
import { actions, actionTransitions, receipts } from './schema.js';
import { canTransitionAction, PERMIT_CONSUMING, type ActionStatus } from './state.js';
import { dispatchActionJob, reconcileActionJob, verifyActionJob } from './jobs.js';

export type Action = typeof actions.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;

export interface ActionDeps {
  db: Db;
  clock: Clock;
  registry: CapabilityRegistry;
  logger: Logger;
  /** Non-prod only: see PolicyInput.recipientAllowlist. */
  recipientAllowlist?: ReadonlySet<string> | undefined;
  limits?: Partial<ActionLimits>;
}

export interface ActionLimits {
  maxDispatchAttempts: number;
  maxReconcileAttempts: number;
  maxVerifyAttempts: number;
  /** An action left in `dispatching` longer than this is presumed orphaned by a dead worker. */
  staleDispatchMs: number;
}

const DEFAULT_LIMITS: ActionLimits = {
  maxDispatchAttempts: 5,
  maxReconcileAttempts: 10,
  maxVerifyAttempts: 10,
  staleDispatchMs: 5 * 60_000,
};

function limits(deps: ActionDeps): ActionLimits {
  return { ...DEFAULT_LIMITS, ...deps.limits };
}

function backoff(clock: Clock, attempt: number): Date {
  const ms = Math.min(2 ** attempt * 1000, 15 * 60_000);
  return new Date(clock.now().getTime() + ms);
}

export class IllegalActionTransition extends Error {}

/** Compare-and-set a status change and append it to the audit trail. Returns false if the row moved. */
async function transition(
  db: DbOrTx,
  clock: Clock,
  action: Pick<Action, 'id'>,
  from: ActionStatus,
  to: ActionStatus,
  reason: string,
  patch: Partial<typeof actions.$inferInsert> = {},
): Promise<boolean> {
  if (!canTransitionAction(from, to)) throw new IllegalActionTransition(`${from} -> ${to}`);
  const now = clock.now();
  const rows = await db
    .update(actions)
    .set({ ...patch, status: to, updatedAt: now })
    .where(and(eq(actions.id, action.id), eq(actions.status, from)))
    .returning({ id: actions.id });
  if (rows.length === 0) return false;
  await db
    .insert(actionTransitions)
    .values({ id: uuidv7(), actionId: action.id, fromStatus: from, toStatus: to, reason, at: now });
  return true;
}

async function mustTransition(...args: Parameters<typeof transition>): Promise<void> {
  if (!(await transition(...args)))
    throw new Error(`action ${args[2].id} was not in status ${args[3]}`);
}

// ---------------------------------------------------------------------------------------------
// Policy evaluation against current state
// ---------------------------------------------------------------------------------------------

async function evaluate(
  db: DbOrTx,
  deps: Pick<ActionDeps, 'clock' | 'recipientAllowlist'>,
  capability: AnyCapability,
  input: unknown,
  goalId: string,
  opts: { excludeActionId?: string; lockEnvelope?: boolean },
): Promise<PolicyDecision> {
  const goal = await getGoal(db, goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);
  const participants = await participantEntityIds(db, goalId);
  const emails = await emailsForEntities(db, participants);
  const envelope = await activeEnvelopeForGoal(db, goalId, { lock: opts.lockEnvelope ?? false });

  const permitUsage = new Map<string, number>();
  if (envelope) {
    const rows = await db
      .select({ permitId: actions.permitId, n: sql<number>`count(*)::int` })
      .from(actions)
      .where(
        and(
          eq(actions.envelopeId, envelope.id),
          inArray(actions.status, [...PERMIT_CONSUMING]),
          opts.excludeActionId ? ne(actions.id, opts.excludeActionId) : undefined,
        ),
      )
      .groupBy(actions.permitId);
    for (const r of rows) if (r.permitId) permitUsage.set(r.permitId, r.n);
  }

  return evaluatePolicy({
    capability,
    input,
    goal: {
      open: !isTerminalGoalStatus(goal.status),
      participantAddresses: new Set([...emails.values()].flat()),
    },
    envelope,
    permitUsage,
    now: deps.clock.now(),
    recipientAllowlist: deps.recipientAllowlist,
  });
}

// ---------------------------------------------------------------------------------------------
// Propose
// ---------------------------------------------------------------------------------------------

export interface ProposeInput {
  userId: string;
  goalId: string;
  taskId?: string;
  goalRunId?: string;
  capability: string;
  input: unknown;
  /** Names the effect ("initial-proposal-email"). Same key within a goal = same effect. */
  semanticKey: string;
}

export interface ProposeResult {
  action: Action;
  /** False when an action with this idempotency key already existed. */
  created: boolean;
  /** True when it existed with a different payload: the caller asked for a different effect under the same key. */
  conflict: boolean;
}

export async function proposeAction(deps: ActionDeps, p: ProposeInput): Promise<ProposeResult> {
  const capability = deps.registry.get(p.capability);
  if (!capability) throw new Error(`unknown capability ${p.capability}`);
  const parsed = capability.input.safeParse(p.input);
  if (!parsed.success)
    throw new Error(`invalid input for ${p.capability}: ${parsed.error.message}`);

  const idempotencyKey = `${p.goalId}:${p.capability}:${p.semanticKey}`;
  const hash = contentHash(parsed.data);

  return deps.db.transaction(async (tx) => {
    const decision = await evaluate(tx, deps, capability, parsed.data, p.goalId, {});
    const status: ActionStatus =
      decision.decision === 'allow'
        ? 'authorized'
        : decision.decision === 'deny'
          ? 'denied'
          : 'awaiting_authorization';
    const now = deps.clock.now();
    const id = uuidv7();
    const inserted = await tx
      .insert(actions)
      .values({
        id,
        userId: p.userId,
        goalId: p.goalId,
        taskId: p.taskId ?? null,
        goalRunId: p.goalRunId ?? null,
        capability: p.capability,
        input: parsed.data,
        contentHash: hash,
        idempotencyKey,
        status,
        policyDecision: decision.decision,
        policyReason: decision.reason,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: actions.idempotencyKey })
      .returning();

    const row = inserted[0];
    if (!row) {
      const [existing] = await tx
        .select()
        .from(actions)
        .where(eq(actions.idempotencyKey, idempotencyKey));
      if (!existing) throw new Error('idempotency conflict but no existing row');
      return { action: existing, created: false, conflict: existing.contentHash !== hash };
    }
    await tx.insert(actionTransitions).values({
      id: uuidv7(),
      actionId: id,
      fromStatus: 'proposed',
      toStatus: status,
      reason: `policy:${decision.reason}`,
      at: now,
    });
    if (status === 'authorized')
      await enqueue(tx, dispatchActionJob, { actionId: id }, { jobKey: `action:${id}` });
    return { action: row, created: true, conflict: false };
  });
}

/** After an envelope is approved (or revoked), re-run policy for actions waiting on authorization. */
export async function reevaluateAwaitingActions(
  deps: ActionDeps,
  goalId: string,
): Promise<Action[]> {
  const released: Action[] = [];
  const waiting = await deps.db
    .select()
    .from(actions)
    .where(and(eq(actions.goalId, goalId), eq(actions.status, 'awaiting_authorization')));
  for (const a of waiting) {
    const capability = deps.registry.get(a.capability);
    if (!capability) continue;
    await deps.db.transaction(async (tx) => {
      const decision = await evaluate(tx, deps, capability, a.input, a.goalId, {
        excludeActionId: a.id,
      });
      if (decision.decision === 'allow') {
        if (
          await transition(
            tx,
            deps.clock,
            a,
            'awaiting_authorization',
            'authorized',
            `policy:${decision.reason}`,
            { policyDecision: 'allow', policyReason: decision.reason },
          )
        ) {
          await enqueue(tx, dispatchActionJob, { actionId: a.id }, { jobKey: `action:${a.id}` });
          released.push(a);
        }
      } else if (decision.decision === 'deny') {
        await transition(
          tx,
          deps.clock,
          a,
          'awaiting_authorization',
          'denied',
          `policy:${decision.reason}`,
          { policyDecision: 'deny', policyReason: decision.reason },
        );
      }
    });
  }
  return released;
}

// ---------------------------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------------------------

export type DispatchOutcome =
  | 'noop'
  | 'sent_to_reconciliation'
  | 'blocked_by_policy'
  | 'succeeded'
  | 'failed_retryable'
  | 'failed_permanent'
  | 'uncertain';

function executionContext(a: Action): ExecutionContext {
  return {
    actionId: a.id,
    userId: a.userId,
    idempotencyKey: a.idempotencyKey,
    contentHash: a.contentHash,
  };
}

export async function dispatchAction(deps: ActionDeps, actionId: string): Promise<DispatchOutcome> {
  const { clock, logger } = deps;
  const lim = limits(deps);

  // Phase 1 (one transaction): final policy check, reserve the permit, mark dispatching, commit.
  const prepared = await deps.db.transaction(
    async (tx): Promise<{ action: Action; capability: AnyCapability } | DispatchOutcome> => {
      const [a] = await tx.select().from(actions).where(eq(actions.id, actionId)).for('update');
      if (!a) return 'noop';

      // Re-entry after a crash: we cannot know whether the provider acted. Never dispatch again from here.
      if (a.status === 'dispatching' || a.status === 'reconciling' || a.status === 'uncertain') {
        if (a.status !== 'uncertain')
          await mustTransition(tx, clock, a, a.status, 'uncertain', 'reentered while in flight');
        await enqueue(
          tx,
          reconcileActionJob,
          { actionId: a.id },
          { jobKey: `action:${a.id}:reconcile` },
        );
        return 'sent_to_reconciliation';
      }
      if (a.status !== 'authorized' && a.status !== 'failed_retryable') return 'noop';

      const capability = deps.registry.get(a.capability);
      if (!capability) {
        await mustTransition(
          tx,
          clock,
          a,
          a.status,
          a.status === 'authorized' ? 'cancelled' : 'failed_permanent',
          'capability no longer registered',
        );
        return 'failed_permanent';
      }
      if (contentHash(a.input) !== a.contentHash) {
        await mustTransition(
          tx,
          clock,
          a,
          a.status,
          a.status === 'authorized' ? 'cancelled' : 'failed_permanent',
          'content hash mismatch',
        );
        return 'failed_permanent';
      }

      const decision = await evaluate(tx, deps, capability, a.input, a.goalId, {
        excludeActionId: a.id,
        lockEnvelope: true,
      });
      if (decision.decision !== 'allow') {
        const to: ActionStatus =
          decision.decision === 'deny' ? 'cancelled' : 'awaiting_authorization';
        await mustTransition(tx, clock, a, a.status, to, `policy at dispatch:${decision.reason}`, {
          policyDecision: decision.decision,
          policyReason: decision.reason,
        });
        return 'blocked_by_policy';
      }

      await mustTransition(tx, clock, a, a.status, 'prepared', `policy:${decision.reason}`, {
        policyDecision: 'allow',
        policyReason: decision.reason,
        envelopeId: decision.permit?.envelopeId ?? null,
        envelopeVersion: decision.permit?.envelopeVersion ?? null,
        permitId: decision.permit?.permitId ?? null,
      });
      await mustTransition(tx, clock, a, 'prepared', 'dispatching', 'dispatch', {
        dispatchAttempts: a.dispatchAttempts + 1,
      });
      const [fresh] = await tx.select().from(actions).where(eq(actions.id, a.id));
      if (!fresh) throw new Error('action vanished');
      return { action: fresh, capability };
    },
  );
  if (typeof prepared === 'string') return prepared;

  // Phase 2: the external call, outside any transaction.
  const { action, capability } = prepared;
  let result: DispatchResult;
  try {
    result = await capability.dispatch(action.input, executionContext(action));
  } catch (err) {
    const error = { message: err instanceof Error ? err.message : String(err) };
    return deps.db.transaction(async (tx) => {
      if (err instanceof NotPerformedError) {
        const retry = err.retryable && action.dispatchAttempts < lim.maxDispatchAttempts;
        const to: ActionStatus = retry ? 'failed_retryable' : 'failed_permanent';
        if (
          !(await transition(
            tx,
            clock,
            action,
            'dispatching',
            to,
            `not performed: ${error.message}`,
            { lastError: error },
          ))
        )
          return 'noop';
        if (retry)
          await enqueue(
            tx,
            dispatchActionJob,
            { actionId: action.id },
            { jobKey: `action:${action.id}`, runAt: backoff(clock, action.dispatchAttempts) },
          );
        return to;
      }
      // Timeout, network error, unknown failure: the provider may or may not have acted.
      if (
        !(await transition(
          tx,
          clock,
          action,
          'dispatching',
          'uncertain',
          `outcome unknown: ${error.message}`,
          { lastError: error },
        ))
      )
        return 'noop';
      await enqueue(
        tx,
        reconcileActionJob,
        { actionId: action.id },
        { jobKey: `action:${action.id}:reconcile` },
      );
      return 'uncertain';
    });
  }

  // Phase 3: record the receipt.
  return deps.db.transaction(async (tx) => {
    if (!(await transition(tx, clock, action, 'dispatching', 'succeeded', 'provider accepted'))) {
      // The sweeper already moved it to uncertain; reconciliation will find the stamped artifact.
      logger.warn({ actionId: action.id }, 'late dispatch success; leaving to reconciliation');
      return 'noop';
    }
    await insertReceipt(tx, clock, action, result, 'dispatch');
    await enqueue(
      tx,
      verifyActionJob,
      { actionId: action.id },
      { jobKey: `action:${action.id}:verify` },
    );
    return 'succeeded';
  });
}

async function insertReceipt(
  tx: DbOrTx,
  clock: Clock,
  a: Action,
  r: DispatchResult,
  via: 'dispatch' | 'reconciliation',
): Promise<void> {
  await tx.insert(receipts).values({
    id: uuidv7(),
    actionId: a.id,
    userId: a.userId,
    goalId: a.goalId,
    taskId: a.taskId,
    capability: a.capability,
    provider: r.provider,
    providerRef: r.providerRef,
    contentHash: a.contentHash,
    policyReason: a.policyReason,
    envelopeId: a.envelopeId,
    envelopeVersion: a.envelopeVersion,
    permitId: a.permitId,
    obtainedVia: via,
    details: r.details ?? {},
    recordedAt: clock.now(),
  });
}

// ---------------------------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------------------------

export type ReconcileOutcome =
  'noop' | 'found' | 'not_found_retrying' | 'still_unknown' | 'gave_up';

export async function reconcileAction(
  deps: ActionDeps,
  actionId: string,
): Promise<ReconcileOutcome> {
  const { clock, logger } = deps;
  const lim = limits(deps);

  const claimed = await deps.db.transaction(async (tx) => {
    const [a] = await tx.select().from(actions).where(eq(actions.id, actionId)).for('update');
    if (!a) return undefined;
    if (a.status === 'reconciling')
      await mustTransition(tx, clock, a, 'reconciling', 'uncertain', 'reconcile re-entered');
    else if (a.status !== 'uncertain') return undefined;
    await mustTransition(tx, clock, a, 'uncertain', 'reconciling', 'reconcile', {
      reconcileAttempts: a.reconcileAttempts + 1,
    });
    return { ...a, reconcileAttempts: a.reconcileAttempts + 1 };
  });
  if (!claimed) return 'noop';
  const capability = deps.registry.get(claimed.capability);
  if (!capability) throw new Error(`capability ${claimed.capability} not registered`);

  let found: Awaited<ReturnType<AnyCapability['reconcile']>>;
  try {
    found = await capability.reconcile(claimed.input, executionContext(claimed));
  } catch (err) {
    const error = { message: err instanceof Error ? err.message : String(err) };
    return deps.db.transaction(async (tx) => {
      await mustTransition(
        tx,
        clock,
        claimed,
        'reconciling',
        'uncertain',
        `reconcile inconclusive: ${error.message}`,
        { lastError: error },
      );
      if (claimed.reconcileAttempts >= lim.maxReconcileAttempts) {
        // Stays uncertain. A human must look; never guess. (User notification lands with M2.)
        logger.error(
          { actionId: claimed.id },
          'action outcome unknown after max reconcile attempts',
        );
        return 'gave_up';
      }
      await enqueue(
        tx,
        reconcileActionJob,
        { actionId: claimed.id },
        {
          jobKey: `action:${claimed.id}:reconcile`,
          runAt: backoff(clock, claimed.reconcileAttempts),
        },
      );
      return 'still_unknown';
    });
  }

  return deps.db.transaction(async (tx) => {
    if (found.found) {
      await mustTransition(
        tx,
        clock,
        claimed,
        'reconciling',
        'succeeded',
        'found by reconciliation',
      );
      await insertReceipt(tx, clock, claimed, found.result, 'reconciliation');
      await enqueue(
        tx,
        verifyActionJob,
        { actionId: claimed.id },
        { jobKey: `action:${claimed.id}:verify` },
      );
      return 'found';
    }
    // Authoritatively absent: safe to try again, subject to policy and attempt limits.
    await mustTransition(
      tx,
      clock,
      claimed,
      'reconciling',
      'failed_retryable',
      'reconciliation: not performed',
    );
    if (claimed.dispatchAttempts >= lim.maxDispatchAttempts) {
      await mustTransition(
        tx,
        clock,
        claimed,
        'failed_retryable',
        'failed_permanent',
        'max dispatch attempts',
      );
      return 'gave_up';
    }
    await enqueue(
      tx,
      dispatchActionJob,
      { actionId: claimed.id },
      { jobKey: `action:${claimed.id}` },
    );
    return 'not_found_retrying';
  });
}

// ---------------------------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------------------------

export type VerifyOutcome = 'noop' | 'verified' | 'verification_failed' | 'pending';

export async function verifyAction(deps: ActionDeps, actionId: string): Promise<VerifyOutcome> {
  const { clock } = deps;
  const lim = limits(deps);
  const [a] = await deps.db.select().from(actions).where(eq(actions.id, actionId));
  if (a?.status !== 'succeeded') return 'noop';
  const [receipt] = await deps.db.select().from(receipts).where(eq(receipts.actionId, a.id));
  if (!receipt) throw new Error(`succeeded action ${a.id} has no receipt`);
  const capability = deps.registry.get(a.capability);
  if (!capability) throw new Error(`capability ${a.capability} not registered`);

  const result = await capability.verify(a.input, executionContext(a), {
    provider: receipt.provider,
    providerRef: receipt.providerRef,
    details: receipt.details as Record<string, unknown>,
  });
  const attempts = a.verifyAttempts + 1;

  return deps.db.transaction(async (tx) => {
    if (result.status === 'pending' && attempts < lim.maxVerifyAttempts) {
      await tx
        .update(actions)
        .set({ verifyAttempts: attempts, updatedAt: clock.now() })
        .where(eq(actions.id, a.id));
      await enqueue(
        tx,
        verifyActionJob,
        { actionId: a.id },
        { jobKey: `action:${a.id}:verify`, runAt: backoff(clock, attempts) },
      );
      return 'pending';
    }
    const ok = result.status === 'verified';
    const to: ActionStatus = ok ? 'verified' : 'verification_failed';
    const evidence =
      result.status === 'pending'
        ? { ...result.evidence, gaveUpAfterAttempts: attempts }
        : result.evidence;
    if (
      !(await transition(tx, clock, a, 'succeeded', to, ok ? 'verified' : 'verification failed', {
        verifyAttempts: attempts,
      }))
    )
      return 'noop';
    await tx
      .update(receipts)
      .set({
        verificationStatus: ok ? 'verified' : 'failed',
        verificationEvidence: evidence,
        verifiedAt: clock.now(),
      })
      .where(eq(receipts.id, receipt.id));
    return to;
  });
}

// ---------------------------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------------------------

/** Moves actions orphaned in `dispatching` (worker died mid-call) to reconciliation. */
export async function sweepStaleDispatches(deps: ActionDeps): Promise<number> {
  const cutoff = new Date(deps.clock.now().getTime() - limits(deps).staleDispatchMs);
  const stale = await deps.db
    .select({ id: actions.id })
    .from(actions)
    .where(and(eq(actions.status, 'dispatching'), lt(actions.updatedAt, cutoff)));
  let moved = 0;
  for (const { id } of stale) {
    await deps.db.transaction(async (tx) => {
      if (
        await transition(tx, deps.clock, { id }, 'dispatching', 'uncertain', 'stale dispatch swept')
      ) {
        await enqueue(
          tx,
          reconcileActionJob,
          { actionId: id },
          { jobKey: `action:${id}:reconcile` },
        );
        moved++;
      }
    });
  }
  return moved;
}

export async function getAction(db: DbOrTx, id: string): Promise<Action | undefined> {
  const [row] = await db.select().from(actions).where(eq(actions.id, id));
  return row;
}

export async function getReceipt(db: DbOrTx, actionId: string): Promise<Receipt | undefined> {
  const [row] = await db.select().from(receipts).where(eq(receipts.actionId, actionId));
  return row;
}

export async function listTransitions(
  db: DbOrTx,
  actionId: string,
): Promise<Array<{ from: ActionStatus; to: ActionStatus; reason: string }>> {
  const rows = await db
    .select()
    .from(actionTransitions)
    .where(eq(actionTransitions.actionId, actionId))
    .orderBy(actionTransitions.at, actionTransitions.id);
  return rows.map((r) => ({ from: r.fromStatus, to: r.toStatus, reason: r.reason }));
}
