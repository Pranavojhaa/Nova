import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../../src/platform/db/client.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://nova:nova@localhost:5432/nova_test';

export function testDatabase(): Database {
  return createDatabase(TEST_DATABASE_URL);
}

/** Empties every Nova table and the job queue between tests. */
export async function resetDatabase(database: Database): Promise<void> {
  const { rows } = await database.pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  if (tables) await database.db.execute(sql.raw(`truncate ${tables} cascade`));
  await database.db.execute(sql.raw(`delete from graphile_worker._private_jobs`));
}

export async function queuedJobs(
  database: Database,
): Promise<Array<{ task: string; key: string | null; payload: unknown }>> {
  const { rows } = await database.pool.query<{
    task: string;
    key: string | null;
    payload: unknown;
  }>(
    `select t.identifier as task, j.key, j.payload
       from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id = j.task_id
      order by j.id`,
  );
  return rows;
}
