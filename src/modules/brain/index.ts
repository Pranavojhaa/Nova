import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../../platform/db/client.js';
import { uuidv7 } from '../../platform/ids.js';
import { entities, entityIdentifiers } from './schema.js';

export type Entity = typeof entities.$inferSelect;
export type EntityIdentifier = typeof entityIdentifiers.$inferSelect;

export function normalizeEmail(address: string): string {
  return address.trim().toLowerCase();
}

export async function createPerson(
  db: DbOrTx,
  input: { userId: string; displayName: string; emails: string[]; source: string },
): Promise<Entity> {
  const id = uuidv7();
  const [row] = await db
    .insert(entities)
    .values({ id, userId: input.userId, kind: 'person', displayName: input.displayName })
    .returning();
  if (!row) throw new Error('insert entities returned no row');
  if (input.emails.length > 0) {
    await db.insert(entityIdentifiers).values(
      input.emails.map((e) => ({
        id: uuidv7(),
        entityId: id,
        kind: 'email' as const,
        value: normalizeEmail(e),
        source: input.source,
      })),
    );
  }
  return row;
}

/** Email addresses per entity. Used to resolve the goal's pinned recipients for policy. */
export async function emailsForEntities(
  db: DbOrTx,
  entityIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(entityIds.map((id) => [id, []]));
  if (entityIds.length === 0) return result;
  const rows = await db
    .select({ entityId: entityIdentifiers.entityId, value: entityIdentifiers.value })
    .from(entityIdentifiers)
    .where(
      and(inArray(entityIdentifiers.entityId, entityIds), eq(entityIdentifiers.kind, 'email')),
    );
  for (const r of rows) result.get(r.entityId)?.push(r.value);
  return result;
}
