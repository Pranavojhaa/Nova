import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';
import { createDatabase } from '../platform/db/client.js';
import { systemClock } from '../platform/clock.js';
import { startHealthServer } from '../platform/health.js';
import { startWorker } from '../platform/jobs/worker.js';
import { CapabilityRegistry } from '../modules/capabilities/index.js';
import { ACTION_CRONTAB, actionJobHandlers } from '../modules/actions/index.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL).child({
  env: config.NOVA_ENV,
  release: config.NOVA_RELEASE,
});
const database = createDatabase(config.DATABASE_URL);

// Real capabilities (Gmail, Google Calendar) are registered here from M1 on.
const registry = new CapabilityRegistry([]);

const runner = await startWorker({
  pgPool: database.pool,
  logger,
  handlers: [
    ...actionJobHandlers({
      db: database.db,
      clock: systemClock,
      registry,
      logger,
      recipientAllowlist: config.NOVA_RECIPIENT_ALLOWLIST
        ? new Set(config.NOVA_RECIPIENT_ALLOWLIST)
        : undefined,
    }),
  ],
  crontab: ACTION_CRONTAB,
});

// Cloud Run's startup probe hits this port: it must only pass once the job runner is actually
// running. Starting the health server before `startWorker` resolved let a worker that throws at
// boot still get a Ready revision, so staging would smoke-tag the digest and prod would receive
// a crash-looping worker.
const health = config.HEALTH_PORT
  ? await startHealthServer(config.HEALTH_PORT, {
      env: config.NOVA_ENV,
      release: config.NOVA_RELEASE,
    })
  : undefined;
logger.info(
  { recipientAllowlistSize: config.NOVA_RECIPIENT_ALLOWLIST?.length ?? 'unrestricted' },
  'worker started',
);

await runner.promise;
health?.close();
await database.close();
