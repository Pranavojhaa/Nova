import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';
import { createDatabase } from '../platform/db/client.js';
import { migrateDatabase } from '../platform/db/migrate.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL).child({
  env: config.NOVA_ENV,
  release: config.NOVA_RELEASE,
});
const database = createDatabase(config.DATABASE_URL);
try {
  await migrateDatabase(database);
  logger.info('migrations applied');
} finally {
  await database.close();
}
