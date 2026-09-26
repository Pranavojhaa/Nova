import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';
import { createDatabase } from '../platform/db/client.js';
import { systemClock } from '../platform/clock.js';
import { startWorker } from '../platform/jobs/worker.js';
import { CapabilityRegistry } from '../modules/capabilities/index.js';
import { ACTION_CRONTAB, actionJobHandlers } from '../modules/actions/index.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);

// Real capabilities (Gmail, Google Calendar) are registered here from M1 on.
const registry = new CapabilityRegistry([]);

const runner = await startWorker({
  pgPool: database.pool,
  logger,
  handlers: [...actionJobHandlers({ db: database.db, clock: systemClock, registry, logger })],
  crontab: ACTION_CRONTAB,
});
logger.info('worker started');

await runner.promise;
await database.close();
