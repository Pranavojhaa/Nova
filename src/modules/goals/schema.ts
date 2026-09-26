import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../identity/schema.js';
import { entities } from '../brain/schema.js';

export const GOAL_STATUSES = [
  'active',
  'waiting',
  'awaiting_user',
  'completed',
  'failed',
  'cancelled',
] as const;
export const TASK_STATUSES = ['todo', 'doing', 'done', 'skipped'] as const;

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The user's own words. */
    intent: text('intent').notNull(),
    /** Structured outcome, e.g. {type:'meeting', durationMinutes:30, window:{...}}. Changing it is a material change. */
    outcomeSpec: jsonb('outcome_spec').notNull(),
    status: text('status', { enum: GOAL_STATUSES }).notNull(),
    deadline: timestamp('deadline', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'goals_status_check',
      sql`${t.status} in (${sql.raw(GOAL_STATUSES.map((v) => `'${v}'`).join(', '))})`,
    ),
    index('goals_user_status_idx').on(t.userId, t.status),
  ],
);

/**
 * The only entities external effects of this goal may target. Set from the user's instruction
 * and confirmed identity resolution, never from content Nova reads (recipient pinning).
 */
export const goalParticipants = pgTable(
  'goal_participants',
  {
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.goalId, t.entityId] })],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('todo'),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tasks_goal_idx').on(t.goalId, t.position)],
);
