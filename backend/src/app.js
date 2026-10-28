import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { db } from './db/index.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { router as auth } from './modules/auth.routes.js';
import { router as attendance } from './modules/attendance.routes.js';
import { router as beats } from './modules/beats.routes.js';
import { router as outlets } from './modules/outlets.routes.js';
import { router as products } from './modules/products.routes.js';
import { router as orders } from './modules/orders.routes.js';
import { router as field } from './modules/field.routes.js';
import { router as insights } from './modules/insights.routes.js';
import { router as samplePads } from './modules/samplepads.routes.js';
import { router as admin } from './modules/admin.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.corsOrigins, credentials: false }));
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  if (!env.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: req => req.url === '/api/health' } }));

  // Uploaded images use random 24-byte names; served read-only.
  app.use('/uploads', express.static(env.uploadDir, { fallthrough: false, maxAge: '7d', index: false, dotfiles: 'deny' }));

  app.get('/api/health', async (_req, res) => {
    try { await db.ping(); res.json({ status: 'ok', database: 'up' }); }
    catch { res.status(503).json({ status: 'degraded', database: 'down' }); }
  });

  app.use('/api/auth', auth);
  const api = express.Router();
  api.use(authenticate);
  api.use('/attendance', attendance);
  api.use('/admin', admin);
  for (const r of [beats, outlets, products, orders, field, insights, samplePads]) api.use(r);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
