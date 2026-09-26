import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';
import { createDatabase } from '../platform/db/client.js';
import { buildServer } from '../api/server.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);
const app = buildServer({ db: database.db, logger });

const shutdown = async () => {
  await app.close();
  await database.close();
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
