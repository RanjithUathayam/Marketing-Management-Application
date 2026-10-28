/* Administration: users, roles, reporting lines and beat assignments (ADMIN only). */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize, ROLES } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/http.js';

export const router = Router();
router.use(authorize(ROLES.ADMIN));

const userSchema = z.object({
  empCode: z.string().trim().min(2).max(20), name: z.string().trim().min(2).max(100),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile'),
  email: z.email().optional().or(z.literal('')).transform(v => v || null),
  role: z.enum(['EXEC', 'MANAGER', 'ADMIN']), designation: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(), territory: z.string().trim().max(80).optional(),
  managerId: z.number().int().positive().nullable().optional(), isActive: z.boolean().default(true),
});

const dto = u => ({ id: u.UserId, empCode: u.EmpCode, name: u.FullName, mobile: u.Mobile, email: u.Email, role: u.RoleCode,
  designation: u.Designation, region: u.Region, territory: u.Territory, managerId: u.ManagerId, managerName: u.ManagerName,
  isActive: !!u.IsActive, beatIds: u.BeatIds ? JSON.parse(u.BeatIds).map(b => b.BeatId) : [] });
const SQL = `SELECT u.*, m.FullName AS ManagerName,
               (SELECT ba.BeatId FROM dbo.BeatAssignments ba WHERE ba.UserId = u.UserId FOR JSON PATH) AS BeatIds
             FROM dbo.Users u LEFT JOIN dbo.Users m ON m.UserId = u.ManagerId`;

router.get('/users', async (req, res) => {
  const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
  res.json((await db.query(`${SQL} WHERE (@s IS NULL OR u.FullName LIKE @s OR u.EmpCode LIKE @s OR u.Mobile LIKE @s) ORDER BY u.RoleCode, u.FullName`, { s: search })).map(dto));
});

async function validateManager(managerId, selfId) {
  if (!managerId) return;
  if (managerId === selfId) throw badRequest('A user cannot report to themselves');
  const m = await db.one("SELECT RoleCode FROM dbo.Users WHERE UserId = @id AND IsActive = 1", { id: managerId });
  if (!m || m.RoleCode === 'EXEC') throw badRequest('Reporting manager must be an active manager or admin');
}

router.post('/users', async (req, res) => {
  const b = userSchema.parse(req.body);
  await validateManager(b.managerId);
  const r = await db.one(
    `INSERT dbo.Users (EmpCode, FullName, Mobile, Email, RoleCode, Designation, Region, Territory, ManagerId, IsActive)
     OUTPUT inserted.UserId VALUES (@emp, @name, @mobile, @email, @role, @des, @reg, @ter, @mgr, @active)`,
    { emp: b.empCode, name: b.name, mobile: b.mobile, email: b.email, role: b.role, des: b.designation || null, reg: b.region || null,
      ter: b.territory || null, mgr: b.managerId ?? null, active: b.isActive });
  res.status(201).json(dto(await db.one(`${SQL} WHERE u.UserId = @id`, { id: r.UserId })));
});

router.put('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = userSchema.parse(req.body);
  await validateManager(b.managerId, id);
  const r = await db.query(
    `UPDATE dbo.Users SET EmpCode = @emp, FullName = @name, Mobile = @mobile, Email = @email, RoleCode = @role, Designation = @des,
            Region = @reg, Territory = @ter, ManagerId = @mgr, IsActive = @active OUTPUT inserted.UserId WHERE UserId = @id`,
    { id, emp: b.empCode, name: b.name, mobile: b.mobile, email: b.email, role: b.role, des: b.designation || null, reg: b.region || null,
      ter: b.territory || null, mgr: b.managerId ?? null, active: b.isActive });
  if (!r.length) throw notFound('User');
  if (!b.isActive) await db.query('UPDATE dbo.RefreshTokens SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @id AND RevokedAt IS NULL', { id });
  res.json(dto(await db.one(`${SQL} WHERE u.UserId = @id`, { id })));
});

/* PUT /admin/users/:id/beats { beatIds: [] } — replaces the user's beat assignments */
router.put('/users/:id/beats', async (req, res) => {
  const id = Number(req.params.id);
  const { beatIds } = z.object({ beatIds: z.array(z.number().int().positive()).max(100) }).parse(req.body);
  await db.transaction(async tx => {
    await db.query('DELETE dbo.BeatAssignments WHERE UserId = @id', { id }, tx);
    await db.query('INSERT dbo.BeatAssignments (BeatId, UserId) SELECT value, @id FROM OPENJSON(@b)', { id, b: JSON.stringify([...new Set(beatIds)]) }, tx);
  });
  res.json(dto(await db.one(`${SQL} WHERE u.UserId = @id`, { id })));
});

router.get('/beats', async (_req, res) => {
  res.json((await db.query('SELECT * FROM dbo.vw_BeatSummary ORDER BY BeatCode')).map(b => ({
    id: b.BeatId, code: b.BeatCode, name: b.BeatName, area: b.Area, colorTag: b.ColorTag, outlets: b.OutletCount })));
});

router.post('/beats', async (req, res) => {
  const b = z.object({ code: z.string().trim().regex(/^BT-\d{3,5}$/, 'Code must look like BT-001'), name: z.string().trim().min(2).max(100),
    area: z.string().trim().min(2).max(80), colorTag: z.enum(['green', 'teal', 'amber']).default('green') }).parse(req.body);
  const r = await db.one('INSERT dbo.Beats (BeatCode, BeatName, Area, ColorTag) OUTPUT inserted.BeatId VALUES (@c, @n, @a, @t)',
    { c: b.code, n: b.name, a: b.area, t: b.colorTag });
  res.status(201).json({ id: r.BeatId });
});
