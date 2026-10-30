import { env, assertConfig } from './config/env.js';
import { logger } from './utils/logger.js';
import { db } from './db/index.js';
import { createApp } from './app.js';
import { faceEngine } from './services/face.js';

assertConfig();
const app = createApp();
const server = app.listen(env.port, () => logger.info(`Marketing Management API listening on :${env.port} (${env.nodeEnv})`));

db.ping().then(() => logger.info('database connected')).catch(err => logger.error({ err }, 'database not reachable at startup'));
faceEngine.warmUp().catch(err => logger.error({ err }, 'face models failed to load — selfie attendance will be unavailable'));

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down`);
  server.close(async () => {
    await db.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', err => logger.error({ err }, 'unhandled rejection'));
