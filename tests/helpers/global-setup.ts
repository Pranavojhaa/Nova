import { createDatabase } from '../../src/platform/db/client.js';
import { migrateDatabase } from '../../src/platform/db/migrate.js';
import { TEST_DATABASE_URL } from './db.js';

/** Rebuilds the test database from migrations once per run, proving migrations apply cleanly. */
export default async function setup(): Promise<void> {
  const database = createDatabase(TEST_DATABASE_URL);
  try {
    await database.pool.query(
      'drop schema if exists public cascade; drop schema if exists drizzle cascade; drop schema if exists graphile_worker cascade; create schema public;',
    );
    await migrateDatabase(database);
  } finally {
    await database.close();
  }
}
