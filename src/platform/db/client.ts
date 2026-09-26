import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

export type Db = NodePgDatabase;
/** A transaction handle. Functions that write take `DbOrTx` so callers control atomicity. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string, onError?: (err: Error) => void): Database {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle client can error (e.g. server restart); without a handler that crashes the process.
  const handle = onError ?? (() => undefined);
  pool.on('error', handle);
  pool.on('connect', (client) => client.on('error', handle));
  const db = drizzle(pool);
  return { db, pool, close: () => pool.end() };
}
