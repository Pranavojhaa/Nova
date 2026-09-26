import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../platform/db/client.js';
import { uuidv7 } from '../../platform/ids.js';
import { users } from './schema.js';

export type User = typeof users.$inferSelect;

export async function createUser(
  db: DbOrTx,
  input: { email: string; displayName?: string; timezone?: string },
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      id: uuidv7(),
      email: input.email.toLowerCase(),
      displayName: input.displayName ?? null,
      timezone: input.timezone ?? 'UTC',
    })
    .returning();
  if (!row) throw new Error('insert users returned no row');
  return row;
}

export async function getUser(db: DbOrTx, id: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}
