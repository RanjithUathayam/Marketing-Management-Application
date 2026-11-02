import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { PHONE_ORDER_SCOPE, authenticate, restrictScope, signAccessToken } from '../middleware/auth.js';
import { HttpError, badRequest, notFound } from '../utils/http.js';
import { notify, sendOtp, sendSms } from '../services/notify.js';
import { createLeaveRequest, leaveSchema } from './attendance.routes.js';
import { logger } from '../utils/logger.js';
import { securePath } from '../services/face.js';

export const router = Router();

const mobileSchema = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
// Keyed by IP + mobile so colleagues behind one office NAT don't lock each other out.
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: env.isTest ? 1000 : 10, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: req => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.mobile ?? '').slice(0, 15)}`,
  message: { error: 'Too many attempts. Please wait a few minutes.' } });

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

export const toUserDto = u => ({
  id: u.UserId, empCode: u.EmpCode, name: u.FullName, mobile: u.Mobile, email: u.Email, role: u.RoleCode,
  designation: u.Designation, region: u.Region, territory: u.Territory,
  manager: u.ManagerId ? { id: u.ManagerId, name: u.ManagerName, designation: u.ManagerDesignation } : null,
  hasPhoto: !!u.ProfilePhotoPath, photoUpdatedAt: u.ProfilePhotoPath ? (u.ProfilePhotoUpdatedAt ?? null) : null,
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

/* POST /auth/leave-request { mobile, empCode, kind, leaveType, fromDate, toDate, hours?, reason }
   Apply leave / permission from the login page WITHOUT signing in — for an employee who is not working
   today. Identity = registered mobile + Employee ID of an active employee. The request is filed as
   PENDING (the manager still approves it), flagged LOGIN_PAGE, and the employee is alerted on their
   registered mobile so a request filed by someone else is noticed. */
const leaveLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: env.isTest ? 1000 : 5, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: req => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.mobile ?? '').slice(0, 15)}`,
  message: { error: 'Too many requests. Please try again later or contact your manager.' } });

router.post('/leave-request', leaveLimiter, async (req, res) => {
  const { mobile, empCode, ...leave } = leaveSchema.extend({
    mobile: mobileSchema,
    empCode: z.string().trim().min(2, 'Enter your Employee ID').max(20).transform(s => s.toUpperCase()),
  }).parse(req.body);
  const u = await db.one(
    `SELECT u.UserId, u.FullName, m.FullName AS ManagerName FROM dbo.Users u LEFT JOIN dbo.Users m ON m.UserId = u.ManagerId
      WHERE u.Mobile = @mobile AND UPPER(u.EmpCode) = @empCode AND u.IsActive = 1`, { mobile, empCode });
  if (!u) throw badRequest('Mobile number and Employee ID do not match an active employee');
  const r = await createLeaveRequest({ id: u.UserId, name: u.FullName }, leave, 'LOGIN_PAGE');
  const kind = leave.kind === 'LEAVE' ? 'Leave' : 'Permission';
  const dates = `${leave.fromDate}${leave.toDate !== leave.fromDate ? ' to ' + leave.toDate : ''}`;
  await notify(u.UserId, { icon: '📝', title: `${kind} request submitted`, tone: 'amber', link: '/attendance',
    body: `${leave.leaveType} · ${dates} · applied from the login page` });
  await sendSms(mobile, `${kind} request (${leave.leaveType}, ${dates}) was submitted for employee ${empCode}. If you did not make this request, contact your manager.`,
    'Leave request alert').catch(e => logger.warn({ err: e.message }, 'leave request SMS failed'));
  res.status(201).json({ id: r.id, status: 'PENDING', employeeName: u.FullName, approver: u.ManagerName ?? null });
});

/* POST /auth/phone-order-session { mobile, empCode }
   Take a phone order from the login page WITHOUT OTP sign-in — for an executive who gets a call from an
   outlet while not signed in. Identity = registered mobile + Employee ID of an active executive. Returns a
   short-lived access token scoped to order taking only (see restrictScope) and no refresh token. The
   executive is alerted on their registered mobile so a session opened by someone else is noticed. */
const PHONE_ORDER_MINUTES = 30;
const phoneOrderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: env.isTest ? 1000 : 10, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: req => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.mobile ?? '').slice(0, 15)}`,
  message: { error: 'Too many attempts. Please try again later or sign in with OTP.' } });

router.post('/phone-order-session', phoneOrderLimiter, async (req, res) => {
  const { mobile, empCode } = z.object({
    mobile: mobileSchema,
    empCode: z.string().trim().min(2, 'Enter your Employee ID').max(20).transform(s => s.toUpperCase()),
  }).parse(req.body);
  const user = await db.one(`${USER_SQL} WHERE u.Mobile = @mobile AND UPPER(u.EmpCode) = @empCode AND u.IsActive = 1`, { mobile, empCode });
  if (!user) throw badRequest('Mobile number and Employee ID do not match an active employee');
  if (user.RoleCode !== 'EXEC') throw badRequest('Phone orders without sign-in are for sales executives — please sign in with OTP');
  const dto = toUserDto(user);
  await sendSms(mobile, `A phone order session was opened for employee ${empCode} from the login page. If this was not you, contact your manager.`,
    'Phone order alert').catch(e => logger.warn({ err: e.message }, 'phone order session SMS failed'));
  res.status(201).json({
    accessToken: signAccessToken(dto, { scope: PHONE_ORDER_SCOPE, expiresIn: `${PHONE_ORDER_MINUTES}m` }),
    scope: PHONE_ORDER_SCOPE, expiresInSeconds: PHONE_ORDER_MINUTES * 60, user: dto,
  });
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

router.get('/me', authenticate, restrictScope, async (req, res) => {
  const user = await db.one(`${USER_SQL} WHERE u.UserId = @id`, { id: req.user.id });
  if (!user) throw new HttpError(401, 'Account not found');
  res.json(toUserDto(user));
});

/* GET /auth/me/photo — the signed-in user's own profile photo (added by an admin), for their avatar */
router.get('/me/photo', authenticate, restrictScope, async (req, res) => {
  const u = await db.one('SELECT ProfilePhotoPath FROM dbo.Users WHERE UserId = @id', { id: req.user.id });
  const file = securePath(u?.ProfilePhotoPath);
  if (!file) throw notFound('Profile photo');
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(file);
});
