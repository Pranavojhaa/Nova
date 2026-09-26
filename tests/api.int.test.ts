import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createLogger } from '../src/platform/logger.js';
import { createDatabase } from '../src/platform/db/client.js';
import { testDatabase } from './helpers/db.js';

const database = testDatabase();
afterAll(() => database.close());

describe('api', () => {
  it('reports health and readiness', async () => {
    const app = buildServer({ db: database.db, logger: createLogger('silent') });
    expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/readyz')).json()).toEqual({ status: 'ready' });
  });

  it('reports not ready when the database is unreachable', async () => {
    const broken = createDatabase('postgres://nova@127.0.0.1:1/nope');
    const app = buildServer({ db: broken.db, logger: createLogger('silent') });
    expect((await app.inject('/readyz')).statusCode).toBe(503);
    await broken.close();
  });
});
