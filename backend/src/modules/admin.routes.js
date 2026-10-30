/* Administration: users, roles, reporting lines and beat assignments (ADMIN only). */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize, ROLES } from '../middleware/auth.js';
import { memoryImageUploader } from '../middleware/upload.js';
import { badRequest, notFound } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { faceEngine, storeSecureJpeg, securePath, removeSecure } from '../services/face.js';

export const router = Router();
router.use(authorize(ROLES.ADMIN));
const photoUpload = memoryImageUploader(1);

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
  isActive: !!u.IsActive, hasPhoto: !!u.ProfilePhotoPath, photoUpdatedAt: u.ProfilePhotoUpdatedAt ?? null, beatIds: u.BeatIds ? JSON.parse(u.BeatIds).map(b => b.BeatId) : [] });
const SQL = `SELECT u.UserId, u.EmpCode, u.FullName, u.Mobile, u.Email, u.RoleCode, u.Designation, u.Region, u.Territory, u.ManagerId,
                    u.IsActive, u.ProfilePhotoPath, u.ProfilePhotoUpdatedAt, m.FullName AS ManagerName,
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

/* POST /admin/users/:id/photo  multipart photo — employee profile photo used for attendance face verification */
router.post('/users/:id/photo', photoUpload.single('photo'), async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) throw badRequest('Choose a photo to upload');
  if (!(await db.one('SELECT 1 AS x FROM dbo.Users WHERE UserId = @id', { id }))) throw notFound('User');
  const face = await faceEngine.analyze(req.file.buffer);
  if (face.faces === 0) throw badRequest('No clear face found — upload a well-lit, front-facing photo of the employee');
  if (face.faces > 1) throw badRequest('More than one face found — the photo must show only the employee');
  const key = await storeSecureJpeg('profile-photos', req.file.buffer);
  const r = await db.one(
    `UPDATE dbo.Users SET ProfilePhotoPath = @key, FaceDescriptor = @desc, ProfilePhotoUpdatedAt = SYSUTCDATETIME(), ProfilePhotoUpdatedBy = @by
       OUTPUT deleted.ProfilePhotoPath AS oldPath WHERE UserId = @id`,
    { id, key, desc: JSON.stringify(face.descriptor.map(v => Math.round(v * 1e6) / 1e6)), by: req.user.id });
  removeSecure(r?.oldPath);
  logger.info({ userId: id, by: req.user.id }, 'profile photo updated');
  res.json(dto(await db.one(`${SQL} WHERE u.UserId = @id`, { id })));
});

/* GET /admin/users/:id/photo — streamed to admins only; never exposed as a public URL */
router.get('/users/:id/photo', async (req, res) => {
  const u = await db.one('SELECT ProfilePhotoPath FROM dbo.Users WHERE UserId = @id', { id: Number(req.params.id) });
  const file = securePath(u?.ProfilePhotoPath);
  if (!file) throw notFound('Profile photo');
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(file);
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
