import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import type { Db } from '../platform/db/client.js';
import type { Logger } from '../platform/logger.js';

export interface ApiDeps {
  db: Db;
  logger: Logger;
  release: { env: string; release: string };
}

/**
 * HTTP surface. M0 exposes health only; goal, inbox and envelope routes land with M2.
 * Routes are thin: validate with Zod, call a module's index.ts, return.
 */
export function buildServer(deps: ApiDeps) {
  const app = Fastify({ loggerInstance: deps.logger });

  app.get('/healthz', () => ({ status: 'ok' }));

  app.get('/version', () => deps.release);

  app.get('/readyz', async (_req, reply) => {
    try {
      await deps.db.execute(sql`select 1`);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  return app;
}
