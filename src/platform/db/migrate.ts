import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { runMigrations as runWorkerMigrations } from 'graphile-worker';
import type { Database } from './client.js';

/**
 * Applies Nova's schema (drizzle/*.sql, generated and committed) and graphile-worker's own schema.
 * Migrations are forward-only; a bad migration is fixed by a new migration.
 */
export async function migrateDatabase(
  database: Database,
  migrationsFolder = 'drizzle',
): Promise<void> {
  await migrate(database.db, { migrationsFolder });
  await runWorkerMigrations({ pgPool: database.pool });
}
