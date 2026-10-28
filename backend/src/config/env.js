import 'dotenv/config';
import path from 'node:path';

const str = (k, d) => (process.env[k] ?? d ?? '').toString().trim();
const num = (k, d) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d;
};
const bool = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : /^(1|true|yes)$/i.test(process.env[k]));

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  isTest: str('NODE_ENV') === 'test',
  port: num('PORT', 3000),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:4200').split(',').map(s => s.trim()).filter(Boolean),
  logLevel: str('LOG_LEVEL', 'info'),

  db: {
    server: str('DB_SERVER', 'localhost'),
    port: num('DB_PORT', 1433),
    database: str('DB_NAME', 'MarketingManagement'),
    user: str('DB_USER'),
    password: str('DB_PASSWORD'),
    instanceName: str('DB_INSTANCE') || undefined,
    encrypt: bool('DB_ENCRYPT', false),
    trustServerCertificate: bool('DB_TRUST_SERVER_CERT', true),
    poolMax: num('DB_POOL_MAX', 20),
  },

  jwtSecret: str('JWT_SECRET'),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '8h'),
  refreshTokenDays: num('REFRESH_TOKEN_DAYS', 30),
  otpTtlSeconds: num('OTP_TTL_SECONDS', 300),
  otpMaxAttempts: num('OTP_MAX_ATTEMPTS', 5),
  otpDevEcho: bool('OTP_DEV_ECHO', false),
  smsGatewayUrl: str('SMS_GATEWAY_URL'),
  smsGatewayToken: str('SMS_GATEWAY_TOKEN'),

  timezone: str('APP_TIMEZONE', 'Asia/Kolkata'),
  lateAfter: str('LATE_AFTER', '10:00'),
  taxRate: num('TAX_RATE', 0.05),
  geofenceMeters: num('GEOFENCE_METERS', 50),
  uploadDir: path.resolve(str('UPLOAD_DIR', 'uploads')),
  maxUploadMb: num('MAX_UPLOAD_MB', 5),
};

export function assertConfig() {
  const problems = [];
  if (!env.jwtSecret || env.jwtSecret.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
  if (env.isProd && env.otpDevEcho) problems.push('OTP_DEV_ECHO must be false in production');
  if (!env.db.user) problems.push('DB_USER is required');
  if (problems.length) throw new Error('Invalid configuration:\n - ' + problems.join('\n - '));
}
