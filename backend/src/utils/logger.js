import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.logLevel,
  redact: ['req.headers.authorization', 'otp', 'refreshToken', 'accessToken'],
});
