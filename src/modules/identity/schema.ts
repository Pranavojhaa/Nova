import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Convention for every user-owned table: it references users(id) with ON DELETE CASCADE,
 * directly or through its parent, so account deletion removes all of a user's data.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
