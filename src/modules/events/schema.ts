import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from '../identity/schema.js';
import { goals } from '../goals/schema.js';

/** Normalized observations of the world or the user. Deduplicated by (source, external_id). */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(), // 'gmail' | 'calendar' | 'user' | 'timer' | 'system'
    externalId: text('external_id').notNull(),
    type: text('type').notNull(), // 'email.received' | 'user.message' | 'expectation.expired' | ...
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    routedAt: timestamp('routed_at', { withTimezone: true }),
  },
  (t) => [
    unique('events_source_external_uq').on(t.source, t.externalId),
    index('events_unrouted_idx').on(t.routedAt),
  ],
);

/** What a waiting goal is waiting for, and until when. */
export const expectations = pgTable(
  'expectations',
  {
    id: uuid('id').primaryKey(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    matcher: jsonb('matcher').notNull(), // e.g. {type:'email_reply', threadId, fromEntityId}
    deadline: timestamp('deadline', { withTimezone: true }),
    status: text('status', { enum: ['open', 'matched', 'expired', 'cancelled'] }).notNull(),
    matchedEventId: uuid('matched_event_id').references(() => events.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('expectations_goal_status_idx').on(t.goalId, t.status)],
);
