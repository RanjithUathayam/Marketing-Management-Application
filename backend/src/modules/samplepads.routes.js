import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize, MANAGERS, scopeFilter, assertUserInScope, targetUserId } from '../middleware/auth.js';
import { samplePadQr } from '../domain/rules.js';
import { notify } from '../services/notify.js';
import { badRequest, notFound, forbidden, conflict, paging, paged } from '../utils/http.js';
import { toIso } from '../utils/dates.js';

export const router = Router();

const PAD_SQL = `
  SELECT sp.*, dc.DcNo, dc.DcDate, dc.UserId, u.EmpCode, u.FullName, u.Territory
    FROM dbo.SamplePads sp JOIN dbo.DeliveryChallans dc ON dc.DcId = sp.DcId JOIN dbo.Users u ON u.UserId = dc.UserId`;
const padDto = r => ({
  id: r.SamplePadId, recordNo: r.RecordNo, itemCode: r.ItemCode, name: r.PadName, subgroup: r.Subgroup, qty: r.Qty,
  dcNo: r.DcNo, dcDate: toIso(r.DcDate), userId: r.UserId, empCode: r.EmpCode, employee: r.FullName,
  status: r.AckAt ? 'ACKNOWLEDGED' : 'PENDING', ackAt: r.AckAt, ackVia: r.AckVia, remarks: r.Remarks, remindedAt: r.RemindedAt,
  qr: samplePadQr({ empCode: r.EmpCode, dcNo: r.DcNo, itemCode: r.ItemCode }),
});

/* GET /sample-pads?userId — the executive's own pads grouped by delivery challan */
router.get('/sample-pads', async (req, res) => {
  const userId = await targetUserId(req);
  const rows = await db.query(`${PAD_SQL} WHERE dc.UserId = @u ORDER BY dc.DcDate, dc.DcNo, sp.ItemCode`, { u: userId });
  const emp = await db.one('SELECT EmpCode, FullName FROM dbo.Users WHERE UserId = @u', { u: userId });
  const dcs = [];
  for (const r of rows.map(padDto)) {
    let g = dcs.find(d => d.dcNo === r.dcNo);
    if (!g) dcs.push(g = { dcNo: r.dcNo, dcDate: r.dcDate, items: [] });
    g.items.push(r);
  }
  const ack = rows.filter(r => r.AckAt).length;
  res.json({ employee: { id: userId, empCode: emp.EmpCode, name: emp.FullName }, dcs, issued: rows.length, acknowledged: ack, pending: rows.length - ack });
});

/* POST /sample-pads/:id/acknowledge { code, via } — only the scanned QR of THIS pad is accepted */
router.post('/sample-pads/:id/acknowledge', async (req, res) => {
  const b = z.object({ code: z.string().trim().min(5).max(120), via: z.enum(['QR_SCAN', 'PHOTO_SCAN']).default('QR_SCAN') }).parse(req.body);
  const row = await db.one(`${PAD_SQL} WHERE sp.SamplePadId = @id`, { id: Number(req.params.id) });
  if (!row) throw notFound('Sample pad');
  if (row.UserId !== req.user.id) throw forbidden('Only the executive the pad was issued to can acknowledge it');
  if (row.AckAt) throw conflict('This sample pad is already acknowledged');
  const expected = padDto(row).qr;
  if (b.code !== expected) throw badRequest(b.code.startsWith('SP|') ? 'This QR belongs to a different sample pad' : 'Not a sample pad QR');
  await db.query('UPDATE dbo.SamplePads SET AckAt = SYSUTCDATETIME(), AckVia = @via, RemindedAt = NULL WHERE SamplePadId = @id AND AckAt IS NULL',
    { id: row.SamplePadId, via: b.via });
  res.json(padDto(await db.one(`${PAD_SQL} WHERE sp.SamplePadId = @id`, { id: row.SamplePadId })));
});

/* GET /sample-pads/records?userId&status=ack|pen&search&page — Sample Pad object (manager / admin) */
router.get('/sample-pads/records', authorize(...MANAGERS), async (req, res) => {
  const pg = paging(req.query, { defaultSize: 50, maxSize: 500 });
  const params = { userId: Number(req.query.userId) || null, status: req.query.status || null, offset: pg.offset, size: pg.pageSize,
    search: req.query.search ? `%${String(req.query.search).trim()}%` : null };
  const scope = await scopeFilter(req.user, 'dc.UserId', params);
  const base = `WHERE ${scope} AND (@userId IS NULL OR dc.UserId = @userId)
    AND (@search IS NULL OR sp.PadName LIKE @search OR dc.DcNo LIKE @search OR u.FullName LIKE @search)`;
  const statusF = `AND (@status IS NULL OR (@status = 'ack' AND sp.AckAt IS NOT NULL) OR (@status = 'pen' AND sp.AckAt IS NULL))`;
  const [rows, [k]] = await db.queryMulti(
    `${PAD_SQL} ${base} ${statusF} ORDER BY dc.DcDate DESC, sp.SamplePadId OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
     SELECT COUNT(*) AS total, SUM(CASE WHEN sp.AckAt IS NOT NULL THEN 1 ELSE 0 END) AS ack, COUNT(DISTINCT dc.DcId) AS dcs,
            SUM(CASE WHEN (@status IS NULL OR (@status = 'ack' AND sp.AckAt IS NOT NULL) OR (@status = 'pen' AND sp.AckAt IS NULL)) THEN 1 ELSE 0 END) AS filtered
       FROM dbo.SamplePads sp JOIN dbo.DeliveryChallans dc ON dc.DcId = sp.DcId JOIN dbo.Users u ON u.UserId = dc.UserId ${base};`, params);
  res.json({ ...paged(rows.map(padDto), k.filtered ?? 0, pg),
    kpis: { issued: k.total, acknowledged: k.ack ?? 0, pending: k.total - (k.ack ?? 0), deliveryChallans: k.dcs } });
});

async function assertPadInScope(user, id) {
  const r = await db.one('SELECT dc.UserId FROM dbo.SamplePads sp JOIN dbo.DeliveryChallans dc ON dc.DcId = sp.DcId WHERE sp.SamplePadId = @id', { id });
  if (!r) throw notFound('Sample pad');
  await assertUserInScope(user, r.UserId);
}

router.put('/sample-pads/:id/remarks', authorize(...MANAGERS), async (req, res) => {
  const id = Number(req.params.id);
  const { remarks } = z.object({ remarks: z.string().trim().max(300) }).parse(req.body);
  await assertPadInScope(req.user, id);
  await db.query('UPDATE dbo.SamplePads SET Remarks = @r WHERE SamplePadId = @id', { id, r: remarks || null });
  res.json(padDto(await db.one(`${PAD_SQL} WHERE sp.SamplePadId = @id`, { id })));
});

/* POST /sample-pads/remind { ids: [] } — stamps RemindedAt and notifies each executive once */
router.post('/sample-pads/remind', authorize(...MANAGERS), async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }).parse(req.body);
  const params = { ids: JSON.stringify(ids) };
  const scope = await scopeFilter(req.user, 'dc.UserId', params);
  const rows = await db.query(
    `UPDATE sp SET RemindedAt = SYSUTCDATETIME() OUTPUT inserted.SamplePadId, dc.UserId
       FROM dbo.SamplePads sp JOIN dbo.DeliveryChallans dc ON dc.DcId = sp.DcId
      WHERE sp.SamplePadId IN (SELECT value FROM OPENJSON(@ids)) AND sp.AckAt IS NULL AND ${scope}`, params);
  const perUser = new Map();
  rows.forEach(r => perUser.set(r.UserId, (perUser.get(r.UserId) ?? 0) + 1));
  for (const [userId, n] of perUser)
    await notify(userId, { icon: '🗂️', title: 'Sample pad reminder', body: `${n} sample pad${n > 1 ? 's' : ''} pending your acknowledgement — tap to scan`, tone: 'amber', link: '/sample-pads' });
  const names = perUser.size ? await db.query('SELECT FullName FROM dbo.Users WHERE UserId IN (SELECT value FROM OPENJSON(@u))', { u: JSON.stringify([...perUser.keys()]) }) : [];
  res.json({ reminded: rows.length, employees: names.map(n => n.FullName) });
});

/* POST /sample-pads/challans { dcNo, dcDate, userId, items:[{itemCode,name,subgroup,qty}] } — issue pads on a DC */
router.post('/sample-pads/challans', authorize(...MANAGERS), async (req, res) => {
  const b = z.object({
    dcNo: z.string().trim().min(3).max(30), dcDate: z.iso.date(), userId: z.number().int().positive(),
    items: z.array(z.object({ itemCode: z.string().trim().min(1).max(20), name: z.string().trim().min(2).max(120),
      subgroup: z.string().trim().min(1).max(40), qty: z.number().int().min(1).max(999) })).min(1).max(50),
  }).parse(req.body);
  await assertUserInScope(req.user, b.userId);
  const u = await db.one("SELECT RoleCode FROM dbo.Users WHERE UserId = @u AND IsActive = 1", { u: b.userId });
  if (u?.RoleCode !== 'EXEC') throw badRequest('Sample pads are issued to sales executives');
  if (new Set(b.items.map(i => i.itemCode.toUpperCase())).size !== b.items.length) throw badRequest('Item codes must be unique on a DC');
  const dcId = await db.transaction(async tx => {
    const dc = await db.one('INSERT dbo.DeliveryChallans (DcNo, DcDate, UserId) OUTPUT inserted.DcId VALUES (@no, @d, @u)',
      { no: b.dcNo, d: b.dcDate, u: b.userId }, tx);
    await db.query(
      `INSERT dbo.SamplePads (DcId, ItemCode, PadName, Subgroup, Qty)
       SELECT @dc, UPPER(itemCode), name, subgroup, qty FROM OPENJSON(@items)
         WITH (itemCode VARCHAR(20), name NVARCHAR(120), subgroup NVARCHAR(40), qty INT)`,
      { dc: dc.DcId, items: JSON.stringify(b.items) }, tx);
    await notify(b.userId, { icon: '🗂️', title: 'Sample pads issued', body: `${b.items.length} pad(s) on ${b.dcNo} — scan the QR on receipt`, tone: 'blue', link: '/sample-pads' }, tx);
    return dc.DcId;
  });
  res.status(201).json({ dcId });
});

/* ── Notifications ─────────────────────────────────────────────────── */
router.get('/notifications', async (req, res) => {
  const [rows, [u]] = await db.queryMulti(
    `SELECT TOP 50 NotificationId AS id, Icon AS icon, Title AS title, Body AS body, Tone AS tone, Link AS link, IsRead AS isRead, CreatedAt AS createdAt
       FROM dbo.Notifications WHERE UserId = @u ORDER BY CreatedAt DESC;
     SELECT COUNT(*) AS n FROM dbo.Notifications WHERE UserId = @u AND IsRead = 0;`, { u: req.user.id });
  res.json({ items: rows.map(r => ({ ...r, isRead: !!r.isRead })), unread: u.n });
});
router.post('/notifications/read-all', async (req, res) => {
  await db.query('UPDATE dbo.Notifications SET IsRead = 1 WHERE UserId = @u AND IsRead = 0', { u: req.user.id });
  res.status(204).end();
});
router.post('/notifications/:id/read', async (req, res) => {
  await db.query('UPDATE dbo.Notifications SET IsRead = 1 WHERE NotificationId = @id AND UserId = @u', { id: Number(req.params.id), u: req.user.id });
  res.status(204).end();
});

