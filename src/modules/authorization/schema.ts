import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../identity/schema.js';
import { goals } from '../goals/schema.js';

export const ENVELOPE_STATUSES = [
  'proposed',
  'active',
  'superseded',
  'revoked',
  'rejected',
] as const;

/**
 * A bounded, versioned authorization for one goal: "Nova may email Rahul these three times,
 * book whichever he accepts, and follow up once." Approval binds to terms_hash.
 * Expiry and exhaustion are evaluated by policy at execution time, not stored as status.
 */
export const authorizationEnvelopes = pgTable(
  'authorization_envelopes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status', { enum: ENVELOPE_STATUSES }).notNull(),
    /** What the user reads and approves. */
    summary: text('summary').notNull(),
    /** What policy enforces. */
    terms: jsonb('terms').notNull(),
    termsHash: text('terms_hash').notNull(),
    statusReason: text('status_reason'),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
  },
  (t) => [
    check(
      'authorization_envelopes_status_check',
      sql`${t.status} in (${sql.raw(ENVELOPE_STATUSES.map((v) => `'${v}'`).join(', '))})`,
    ),
    unique('authorization_envelopes_goal_version_uq').on(t.goalId, t.version),
    uniqueIndex('authorization_envelopes_one_active_per_goal')
      .on(t.goalId)
      .where(sql`status = 'active'`),
    index('authorization_envelopes_goal_idx').on(t.goalId, t.status),
  ],
);
