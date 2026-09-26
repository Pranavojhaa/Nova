import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createLogger } from '../src/platform/logger.js';
import { createDatabase } from '../src/platform/db/client.js';
import { testDatabase } from './helpers/db.js';

const database = testDatabase();
const RELEASE = { env: 'staging', release: 'abc123' };
afterAll(() => database.close());

describe('api', () => {
  it('reports health and readiness', async () => {
    const app = buildServer({ db: database.db, logger: createLogger('silent'), release: RELEASE });
    expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/readyz')).json()).toEqual({ status: 'ready' });
  });

  it('reports not ready when the database is unreachable', async () => {
    const broken = createDatabase('postgres://nova@127.0.0.1:1/nope');
    const app = buildServer({ db: broken.db, logger: createLogger('silent'), release: RELEASE });
    expect((await app.inject('/readyz')).statusCode).toBe(503);
    await broken.close();
  });

  it('reports which environment and release it is running', async () => {
    const app = buildServer({ db: database.db, logger: createLogger('silent'), release: RELEASE });
    const res = await app.inject('/version');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ env: 'staging', release: 'abc123' });
  });
});
