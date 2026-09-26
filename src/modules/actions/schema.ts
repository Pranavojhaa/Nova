import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../identity/schema.js';
import { goals, tasks } from '../goals/schema.js';
import { authorizationEnvelopes } from '../authorization/schema.js';
import { goalRuns } from '../agenda/schema.js';

export const ACTION_STATUSES = [
  'proposed',
  'denied',
  'awaiting_authorization',
  'authorized',
  'prepared',
  'dispatching',
  'uncertain',
  'reconciling',
  'succeeded',
  'failed_retryable',
  'failed_permanent',
  'verified',
  'verification_failed',
  'cancelled',
] as const;

/** One proposed call to one capability with a frozen payload. The ledger of every external effect. */
export const actions = pgTable(
  'actions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    goalRunId: uuid('goal_run_id').references(() => goalRuns.id, { onDelete: 'set null' }),
    capability: text('capability').notNull(),
    input: jsonb('input').notNull(),
    contentHash: text('content_hash').notNull(),
    /** goal:capability:semantic-target. A re-proposal of the same effect collides here instead of duplicating. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status', { enum: ACTION_STATUSES }).notNull(),
    policyDecision: text('policy_decision', {
      enum: ['allow', 'require_authorization', 'deny'],
    }).notNull(),
    policyReason: text('policy_reason').notNull(),
    envelopeId: uuid('envelope_id').references(() => authorizationEnvelopes.id),
    envelopeVersion: integer('envelope_version'),
    permitId: text('permit_id'),
    dispatchAttempts: integer('dispatch_attempts').notNull().default(0),
    reconcileAttempts: integer('reconcile_attempts').notNull().default(0),
    verifyAttempts: integer('verify_attempts').notNull().default(0),
    lastError: jsonb('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      'actions_status_check',
      sql`${t.status} in (${sql.raw(ACTION_STATUSES.map((v) => `'${v}'`).join(', '))})`,
    ),
    index('actions_goal_idx').on(t.goalId, t.status),
    index('actions_status_updated_idx').on(t.status, t.updatedAt),
    index('actions_permit_idx').on(t.envelopeId, t.permitId),
  ],
);

/** Append-only history of every status change: the audit trail for "why did Nova do this?". */
export const actionTransitions = pgTable(
  'action_transitions',
  {
    id: uuid('id').primaryKey(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status', { enum: ACTION_STATUSES }).notNull(),
    toStatus: text('to_status', { enum: ACTION_STATUSES }).notNull(),
    reason: text('reason').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [index('action_transitions_action_idx').on(t.actionId, t.at)],
);

/**
 * Proof an external effect happened: what was sent, where, under which authorization,
 * and whether an independent re-read confirmed it.
 */
export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey(),
  actionId: uuid('action_id')
    .notNull()
    .unique()
    .references(() => actions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  goalId: uuid('goal_id')
    .notNull()
    .references(() => goals.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  capability: text('capability').notNull(),
  provider: text('provider').notNull(),
  providerRef: text('provider_ref').notNull(),
  contentHash: text('content_hash').notNull(),
  policyReason: text('policy_reason').notNull(),
  envelopeId: uuid('envelope_id').references(() => authorizationEnvelopes.id),
  envelopeVersion: integer('envelope_version'),
  permitId: text('permit_id'),
  /** How the effect was confirmed to have happened: the dispatch response, or reconciliation after uncertainty. */
  obtainedVia: text('obtained_via', { enum: ['dispatch', 'reconciliation'] }).notNull(),
  details: jsonb('details').notNull().default({}),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  verificationStatus: text('verification_status', { enum: ['pending', 'verified', 'failed'] })
    .notNull()
    .default('pending'),
  verificationEvidence: jsonb('verification_evidence'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
});
