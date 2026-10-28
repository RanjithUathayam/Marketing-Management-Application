import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { HttpError, forbidden } from '../utils/http.js';

export const ROLES = { EXEC: 'EXEC', MANAGER: 'MANAGER', ADMIN: 'ADMIN' };
export const MANAGERS = [ROLES.MANAGER, ROLES.ADMIN];

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, emp: user.empCode, name: user.name }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

/** Verifies the bearer token and attaches req.user = { id, role, empCode, name }. */
export function authenticate(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    const p = jwt.verify(token, env.jwtSecret);
    req.user = { id: Number(p.sub), role: p.role, empCode: p.emp, name: p.name };
    next();
  } catch {
    next(new HttpError(401, 'Session expired — please sign in again'));
  }
}

export const authorize = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());

export const isManager = user => MANAGERS.includes(user.role);

/** User ids the caller may see: self (EXEC), self + direct reports (MANAGER), everyone (ADMIN → null). */
export async function scopeUserIds(user) {
  if (user.role === ROLES.ADMIN) return null;
  if (user.role === ROLES.EXEC) return [user.id];
  const rows = await db.query('SELECT UserId FROM dbo.Users WHERE ManagerId = @id AND IsActive = 1', { id: user.id });
  return [user.id, ...rows.map(r => r.UserId)];
}

export async function assertUserInScope(user, targetUserId) {
  const ids = await scopeUserIds(user);
  if (ids && !ids.includes(Number(targetUserId))) throw forbidden('That user is outside your team');
}

/** Resolves ?userId for read endpoints: execs always get themselves. */
export async function targetUserId(req) {
  const q = Number(req.query.userId);
  if (!q || req.user.role === ROLES.EXEC) return req.user.id;
  await assertUserInScope(req.user, q);
  return q;
}

/** SQL fragment restricting a user-id column to the caller's scope. Adds params into `params`. */
export async function scopeFilter(user, column, params) {
  const ids = await scopeUserIds(user);
  if (!ids) return '1=1';
  params.scopeIds = JSON.stringify(ids);
  return `${column} IN (SELECT value FROM OPENJSON(@scopeIds))`;
}
