import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { goals } from '../goals/schema.js';
import { events } from '../events/schema.js';

/** One wake of a goal (a "turn"): trigger -> context -> decision. Also the reasoning audit trail. */
export const goalRuns = pgTable(
  'goal_runs',
  {
    id: uuid('id').primaryKey(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    triggerEventId: uuid('trigger_event_id').references(() => events.id, { onDelete: 'set null' }),
    context: jsonb('context'),
    decision: jsonb('decision'),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    status: text('status', { enum: ['running', 'done', 'error'] }).notNull(),
    error: jsonb('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('goal_runs_goal_idx').on(t.goalId, t.startedAt)],
);
