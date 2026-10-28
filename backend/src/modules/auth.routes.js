import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { authenticate, signAccessToken } from '../middleware/auth.js';
import { HttpError, badRequest } from '../utils/http.js';
import { sendOtp } from '../services/notify.js';

export const router = Router();

const mobileSchema = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: env.isTest ? 1000 : 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes.' } });

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

export const toUserDto = u => ({
  id: u.UserId, empCode: u.EmpCode, name: u.FullName, mobile: u.Mobile, email: u.Email, role: u.RoleCode,
  designation: u.Designation, region: u.Region, territory: u.Territory,
  manager: u.ManagerId ? { id: u.ManagerId, name: u.ManagerName, designation: u.ManagerDesignation } : null,
});
const USER_SQL = `SELECT u.*, m.FullName AS ManagerName, m.Designation AS ManagerDesignation
                  FROM dbo.Users u LEFT JOIN dbo.Users m ON m.UserId = u.ManagerId`;

async function issueTokens(user) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await db.query(
    `INSERT dbo.RefreshTokens (UserId, TokenHash, ExpiresAt) VALUES (@id, @hash, DATEADD(DAY, @days, SYSUTCDATETIME()))`,
    { id: user.UserId, hash: sha256(refreshToken), days: env.refreshTokenDays });
  const dto = toUserDto(user);
  return { accessToken: signAccessToken(dto), refreshToken, user: dto };
}

/* POST /auth/otp/request  { mobile } */
router.post('/otp/request', otpLimiter, async (req, res) => {
  const mobile = mobileSchema.parse(req.body?.mobile);
  const user = await db.one('SELECT UserId, IsActive FROM dbo.Users WHERE Mobile = @mobile', { mobile });
  // Same response whether or not the number exists, so the endpoint cannot be used to discover users.
  const response = { sent: true, channels: ['SMS', 'WhatsApp'], expiresInSeconds: env.otpTtlSeconds };
  if (!user || !user.IsActive) return res.json(response);

  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.query(
    `UPDATE dbo.OtpCodes SET ConsumedAt = SYSUTCDATETIME() WHERE UserId = @id AND ConsumedAt IS NULL;
     INSERT dbo.OtpCodes (UserId, CodeHash, ExpiresAt) VALUES (@id, @hash, DATEADD(SECOND, @ttl, SYSUTCDATETIME()))`,
    { id: user.UserId, hash: await bcrypt.hash(otp, 8), ttl: env.otpTtlSeconds });
  await sendOtp(mobile, otp);
  res.json(env.otpDevEcho ? { ...response, devOtp: otp } : response);
});

/* POST /auth/otp/verify  { mobile, otp } */
router.post('/otp/verify', otpLimiter, async (req, res) => {
  const { mobile, otp } = z.object({ mobile: mobileSchema, otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit OTP') }).parse(req.body);
  const row = await db.one(
    `SELECT TOP 1 o.OtpId, o.CodeHash, o.Attempts, CASE WHEN o.ExpiresAt < SYSUTCDATETIME() THEN 1 ELSE 0 END AS Expired, u.UserId
       FROM dbo.OtpCodes o JOIN dbo.Users u ON u.UserId = o.UserId
      WHERE u.Mobile = @mobile AND u.IsActive = 1 AND o.ConsumedAt IS NULL
      ORDER BY o.CreatedAt DESC`, { mobile });
  if (!row) throw new HttpError(401, 'Request a new OTP to continue');
  if (row.Expired) throw new HttpError(401, 'OTP has expired — request a new one');
  if (row.Attempts >= env.otpMaxAttempts) throw new HttpError(429, 'Too many wrong attempts — request a new OTP');

  if (!(await bcrypt.compare(otp, row.CodeHash))) {
    await db.query('UPDATE dbo.OtpCodes SET Attempts = Attempts + 1 WHERE OtpId = @id', { id: row.OtpId });
    throw new HttpError(401, 'Incorrect OTP');
  }
  await db.query('UPDATE dbo.OtpCodes SET ConsumedAt = SYSUTCDATETIME() WHERE OtpId = @id', { id: row.OtpId });
  const user = await db.one(`${USER_SQL} WHERE u.UserId = @id`, { id: row.UserId });
  res.json(await issueTokens(user));
});

/* POST /auth/refresh  { refreshToken } — rotates the refresh token */
router.post('/refresh', async (req, res) => {
  const token = z.string().min(20).parse(req.body?.refreshToken);
  const row = await db.one(
    `UPDATE dbo.RefreshTokens SET RevokedAt = SYSUTCDATETIME()
     OUTPUT inserted.UserId
     WHERE TokenHash = @hash AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()`, { hash: sha256(token) });
  if (!row) throw new HttpError(401, 'Session expired — please sign in again');
  const user = await db.one(`${USER_SQL} WHERE u.UserId = @id AND u.IsActive = 1`, { id: row.UserId });
  if (!user) throw new HttpError(401, 'Account is inactive');
  res.json(await issueTokens(user));
});

/* POST /auth/logout  { refreshToken } */
router.post('/logout', async (req, res) => {
  const token = req.body?.refreshToken;
  if (typeof token !== 'string') throw badRequest('refreshToken is required');
  await db.query('UPDATE dbo.RefreshTokens SET RevokedAt = SYSUTCDATETIME() WHERE TokenHash = @hash AND RevokedAt IS NULL', { hash: sha256(token) });
  res.status(204).end();
});

router.get('/me', authenticate, async (req, res) => {
  const user = await db.one(`${USER_SQL} WHERE u.UserId = @id`, { id: req.user.id });
  if (!user) throw new HttpError(401, 'Account not found');
  res.json(toUserDto(user));
});
