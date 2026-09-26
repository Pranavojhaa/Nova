import { customType, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from '../identity/schema.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * A user's authorization to an external provider (Google first, not only).
 * Tokens are stored sealed by SecretBox with the connection id as AAD; plaintext never touches the DB.
 */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'google'
    externalAccountId: text('external_account_id').notNull(),
    scopes: text('scopes').array().notNull(),
    tokenCiphertext: bytea('token_ciphertext').notNull(),
    syncState: jsonb('sync_state').notNull().default({}),
    status: text('status', { enum: ['active', 'revoked', 'error'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('connections_provider_account_uq').on(t.provider, t.externalAccountId)],
);
