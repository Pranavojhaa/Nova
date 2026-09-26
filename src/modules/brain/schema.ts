import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from '../identity/schema.js';

/** People and organizations Nova knows about. Facts and preferences land in M1. */
export const entities = pgTable('entities', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['person', 'org'] }).notNull(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const entityIdentifiers = pgTable(
  'entity_identifiers',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['email', 'name', 'alias', 'phone'] }).notNull(),
    /** Normalized: emails lowercased and trimmed. */
    value: text('value').notNull(),
    source: text('source').notNull(),
  },
  (t) => [
    unique('entity_identifiers_uq').on(t.entityId, t.kind, t.value),
    index('entity_identifiers_value_idx').on(t.kind, t.value),
  ],
);
