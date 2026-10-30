import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize, MANAGERS, scopeUserIds, isManager } from '../middleware/auth.js';
import { uploader, publicPath, removeUploaded } from '../middleware/upload.js';
import { workingBeatIds } from '../services/beats.js';
import { notify, managerOf } from '../services/notify.js';
import { badRequest, notFound, forbidden, conflict, paging, paged } from '../utils/http.js';
import { localDate } from '../utils/dates.js';
import { outletPerformance, haversineMeters, validateKyc, IN_STATES, GSTIN_RE } from '../domain/rules.js';
import { env } from '../config/env.js';

export const router = Router();
const kycUpload = uploader('outlets').fields([{ name: 'shopPhoto', maxCount: 1 }, { name: 'gstinPhotos', maxCount: 5 }, { name: 'panPhotos', maxCount: 5 }]);

const OUTLET_SQL = `
  SELECT o.*, b.BeatCode, b.BeatName, b.Area, bal.Outstanding, bal.LastMonthSales, bal.LastOrderAt,
         CASE WHEN EXISTS (SELECT 1 FROM dbo.OutletVisits v WHERE v.OutletId = o.OutletId AND v.UserId = @me AND v.VisitDate = @today) THEN 1 ELSE 0 END AS VisitedToday,
         c.FullName AS CreatedByName
  FROM dbo.Outlets o
  JOIN dbo.Beats b ON b.BeatId = o.BeatId
  JOIN dbo.vw_OutletBalance bal ON bal.OutletId = o.OutletId
  LEFT JOIN dbo.Users c ON c.UserId = o.CreatedBy`;

export function outletDto(o, here) {
  const outstanding = Number(o.Outstanding ?? 0), creditLimit = Number(o.CreditLimit);
  const lat = o.Latitude != null ? Number(o.Latitude) : null, lng = o.Longitude != null ? Number(o.Longitude) : null;
  return {
    id: o.OutletId, name: o.OutletName, owner: o.OwnerName, mobile: o.Mobile, type: o.OutletType,
    beatId: o.BeatId, beatCode: o.BeatCode, beatName: o.BeatName, area: o.Area,
    outletClass: o.OutletClass, grade: o.Grade, creditLimit, outstanding,
    lastMonthSales: Number(o.LastMonthSales ?? 0), lastOrderAt: o.LastOrderAt,
    performance: outletPerformance({ outstanding, creditLimit, lastOrderAt: o.LastOrderAt }),
    gstin: o.Gstin, pan: o.Pan,
    address: { building: o.Building, line: o.AddressLine, city: o.City, district: o.District, state: o.StateName, postalCode: o.PostalCode },
    lat, lng,
    distanceKm: here && lat != null ? Math.round(haversineMeters(here, { lat, lng }) / 100) / 10 : null,
    visitedToday: !!o.VisitedToday, status: o.ApprovalStatus, approvalRemark: o.ApprovalRemark,
    createdBy: o.CreatedByName, createdAt: o.CreatedAt,
  };
}

/** Beats whose outlets the caller may see (assigned, plus today's planned beat from an approved beat change). */
async function visibleBeatIds(user) {
  return workingBeatIds(await scopeUserIds(user));
}
export async function assertOutletVisible(user, outletId) {
  const o = await db.one('SELECT BeatId, CreatedBy, ApprovalStatus FROM dbo.Outlets WHERE OutletId = @id', { id: outletId });
  if (!o) throw notFound('Outlet');
  const beats = await visibleBeatIds(user);
  if (!beats.includes(o.BeatId) && o.CreatedBy !== user.id) throw forbidden('This outlet is not in your beats');
  return o;
}

/* GET /outlets?beatId&search&sort=distance|name|outstanding&lat&lng&page&pageSize */
router.get('/outlets', async (req, res) => {
  const pg = paging(req.query, { defaultSize: 50, maxSize: 200 });
  const beatIds = await visibleBeatIds(req.user);
  const beatId = Number(req.query.beatId) || null;
  if (beatId && !beatIds.includes(beatId)) throw forbidden('This beat is not assigned to you');
  const rows = await db.query(
    `${OUTLET_SQL}
     WHERE o.ApprovalStatus = 'APPROVED' AND o.BeatId IN (SELECT value FROM OPENJSON(@beats))
       AND (@beatId IS NULL OR o.BeatId = @beatId)
       AND (@search IS NULL OR o.OutletName LIKE @search OR o.OwnerName LIKE @search OR o.Mobile LIKE @search)`,
    { me: req.user.id, today: localDate(), beats: JSON.stringify(beatIds), beatId,
      search: req.query.search ? `%${String(req.query.search).trim()}%` : null });
  const here = req.query.lat && req.query.lng ? { lat: Number(req.query.lat), lng: Number(req.query.lng) } : null;
  let list = rows.map(r => outletDto(r, here));
  const sort = req.query.sort || 'distance';
  if (sort === 'distance' && here) list.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  else if (sort === 'outstanding') list.sort((a, b) => b.outstanding - a.outstanding);
  else list.sort((a, b) => a.name.localeCompare(b.name));
  res.json(paged(list.slice(pg.offset, pg.offset + pg.pageSize), list.length, pg));
});

/* GET /outlets/pending — new outlets waiting for approval (manager) */
router.get('/outlets/pending', authorize(...MANAGERS), async (req, res) => {
  const team = await scopeUserIds(req.user);
  const rows = await db.query(
    `${OUTLET_SQL} WHERE o.ApprovalStatus = 'PENDING' AND (@team IS NULL OR o.CreatedBy IN (SELECT value FROM OPENJSON(@team))) ORDER BY o.CreatedAt`,
    { me: req.user.id, today: localDate(), team: team ? JSON.stringify(team) : null });
  const docs = rows.length ? await db.query(
    `SELECT OutletId, DocType, FilePath FROM dbo.OutletDocuments WHERE OutletId IN (SELECT value FROM OPENJSON(@ids))`,
    { ids: JSON.stringify(rows.map(r => r.OutletId)) }) : [];
  res.json(rows.map(r => ({ ...outletDto(r), documents: docs.filter(d => d.OutletId === r.OutletId).map(d => ({ type: d.DocType, url: d.FilePath })) })));
});

router.get('/outlets/:id', async (req, res) => {
  const id = Number(req.params.id);
  await assertOutletVisible(req.user, id);
  const [[o], docs, pays] = await db.queryMulti(
    `${OUTLET_SQL} WHERE o.OutletId = @id;
     SELECT DocType, FilePath FROM dbo.OutletDocuments WHERE OutletId = @id;
     SELECT TOP 10 ReceiptNo, Amount, Method, CollectedAt FROM dbo.Payments WHERE OutletId = @id ORDER BY CollectedAt DESC;`,
    { id, me: req.user.id, today: localDate() });
  res.json({ ...outletDto(o), documents: docs.map(d => ({ type: d.DocType, url: d.FilePath })),
    payments: pays.map(p => ({ receiptNo: p.ReceiptNo, amount: Number(p.Amount), method: p.Method, collectedAt: p.CollectedAt })) });
});

/* POST /outlets — multipart (shopPhoto, gstinPhotos[≤5], panPhotos[≤5]) — new outlet goes to manager approval */
const outletSchema = z.object({
  name: z.string().trim().min(2, 'Outlet name is required').max(120),
  owner: z.string().trim().min(2, 'Owner name is required').max(100),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile'),
  type: z.enum(['Retailer', 'Wholesaler', 'Modern Trade']).default('Retailer'),
  beatId: z.coerce.number().int().positive(),
  gstin: z.string().trim().toUpperCase().optional().transform(v => v || null),
  pan: z.string().trim().toUpperCase().optional().transform(v => v || null),
  building: z.string().trim().max(150).optional(),
  address: z.string().trim().min(5, 'Address is required').max(300),
  city: z.string().trim().min(2, 'City is required').max(80),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().refine(s => Object.values(IN_STATES).includes(s), 'Choose a valid state'),
  postalCode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit postal code'),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
router.post('/outlets', kycUpload, async (req, res) => {
  const files = Object.values(req.files ?? {}).flat();
  try {
    const b = outletSchema.parse(req.body);
    const shop = req.files?.shopPhoto?.[0], gst = req.files?.gstinPhotos ?? [], pan = req.files?.panPhotos ?? [];
    if (!shop) throw badRequest('Capture the shop front photo');
    if (b.lat == null || b.lng == null) throw badRequest('GPS location is required');
    const kyc = validateKyc({ gstin: b.gstin, pan: b.pan, gstinPhotos: gst.length, panPhotos: pan.length });
    if (kyc.length) throw badRequest(kyc[0], kyc);
    if (b.gstin && GSTIN_RE.test(b.gstin) && IN_STATES[b.gstin.slice(0, 2)] !== b.state) throw badRequest('State does not match the GSTIN state code');
    if (!(await visibleBeatIds(req.user)).includes(b.beatId)) throw forbidden('This beat is not assigned to you');
    const dup = await db.one('SELECT TOP 1 OutletName FROM dbo.Outlets WHERE Mobile = @m OR (@g IS NOT NULL AND Gstin = @g)', { m: b.mobile, g: b.gstin });
    if (dup) throw conflict(`An outlet with this mobile/GSTIN already exists (${dup.OutletName})`);

    const autoApprove = isManager(req.user);
    const created = await db.transaction(async tx => {
      const o = await db.one(
        `INSERT dbo.Outlets (OutletName, OwnerName, Mobile, OutletType, BeatId, Gstin, Pan, Building, AddressLine, City, District, StateName,
                             PostalCode, Latitude, Longitude, ApprovalStatus, CreatedBy, ApprovedBy)
         OUTPUT inserted.OutletId
         VALUES (@name, @owner, @mobile, @type, @beatId, @gstin, @pan, @building, @address, @city, @district, @state, @pin, @lat, @lng, @status, @me, @approvedBy)`,
        { name: b.name, owner: b.owner, mobile: b.mobile, type: b.type, beatId: b.beatId, gstin: b.gstin, pan: b.pan,
          building: b.building || null, address: b.address, city: b.city, district: b.district || null, state: b.state, pin: b.postalCode,
          lat: b.lat, lng: b.lng, status: autoApprove ? 'APPROVED' : 'PENDING', me: req.user.id, approvedBy: autoApprove ? req.user.id : null }, tx);
      const docs = [['SHOP', shop], ...gst.map(f => ['GSTIN', f]), ...pan.map(f => ['PAN', f])];
      for (const [type, f] of docs)
        await db.query('INSERT dbo.OutletDocuments (OutletId, DocType, FilePath) VALUES (@id, @t, @p)',
          { id: o.OutletId, t: type, p: publicPath('outlets', f) }, tx);
      if (!autoApprove)
        await notify(await managerOf(req.user.id, tx), { icon: '🏪', title: 'New outlet for approval',
          body: `${b.name} · by ${req.user.name}`, tone: 'blue', link: '/manager/approvals' }, tx);
      return o;
    });
    res.status(201).json({ id: created.OutletId, status: autoApprove ? 'APPROVED' : 'PENDING' });
  } catch (e) {
    removeUploaded(files);
    throw e;
  }
});

async function actionOutlet(req, approve) {
  const id = Number(req.params.id);
  const b = z.object({
    remark: z.string().trim().max(300).optional(),
    outletClass: z.enum(['A', 'B', 'C']).optional(), creditLimit: z.number().min(0).optional(),
  }).parse(req.body ?? {});
  if (!approve && !b.remark) throw badRequest('Remarks are required when rejecting');
  const o = await db.one('SELECT CreatedBy, ApprovalStatus, OutletName FROM dbo.Outlets WHERE OutletId = @id', { id });
  if (!o) throw notFound('Outlet');
  if (o.ApprovalStatus !== 'PENDING') throw conflict('Outlet has already been reviewed');
  const team = await scopeUserIds(req.user);
  if (team && !team.includes(o.CreatedBy)) throw forbidden('That outlet was created outside your team');
  await db.query(
    `UPDATE dbo.Outlets SET ApprovalStatus = @s, ApprovalRemark = @r, ApprovedBy = @me,
            OutletClass = COALESCE(@cls, OutletClass), CreditLimit = COALESCE(@credit, CreditLimit) WHERE OutletId = @id`,
    { s: approve ? 'APPROVED' : 'REJECTED', r: b.remark || null, me: req.user.id, cls: b.outletClass ?? null, credit: b.creditLimit ?? null, id });
  await notify(o.CreatedBy, { icon: approve ? '✅' : '↩', title: `Outlet ${approve ? 'approved' : 'rejected'}`,
    body: `${o.OutletName}${b.remark ? ' · ' + b.remark : ''}`, tone: approve ? 'green' : 'red' });
  return { id, status: approve ? 'APPROVED' : 'REJECTED' };
}
router.post('/outlets/:id/approve', authorize(...MANAGERS), async (req, res) => res.json(await actionOutlet(req, true)));
router.post('/outlets/:id/reject', authorize(...MANAGERS), async (req, res) => res.json(await actionOutlet(req, false)));

/* POST /outlets/:id/visits { reason, notes?, lat?, lng? } — no-order visit remark */
router.post('/outlets/:id/visits', async (req, res) => {
  const id = Number(req.params.id);
  const b = z.object({ reason: z.string().trim().min(2, 'Choose a reason').max(60), notes: z.string().trim().max(500).optional(),
    lat: z.number().optional(), lng: z.number().optional() }).parse(req.body);
  await assertOutletVisible(req.user, id);
  const distanceM = await geofenceDistance(id, b, req.user.id);
  await db.exec('dbo.usp_RecordOutletVisit', { UserId: req.user.id, OutletId: id, VisitDate: localDate(), Ordered: false,
    NoOrderReason: b.reason, Notes: b.notes || null, Latitude: b.lat ?? null, Longitude: b.lng ?? null, DistanceM: distanceM });
  res.status(201).json({ recorded: true, distanceM, outsideGeofence: distanceM != null && distanceM > env.geofenceMeters });
});

/** Metres between the device and the outlet (null when either location is unknown); logs a GPS point. */
export async function geofenceDistance(outletId, { lat, lng }, userId, tx) {
  if (lat == null || lng == null) return null;
  const o = await db.one('SELECT OutletName, Latitude, Longitude FROM dbo.Outlets WHERE OutletId = @id', { id: outletId }, tx);
  if (!o?.Latitude) return null;
  const d = Math.round(haversineMeters({ lat, lng }, { lat: Number(o.Latitude), lng: Number(o.Longitude) }));
  if (userId) await db.query(
    `INSERT dbo.GpsPoints (UserId, Latitude, Longitude, Label, IsDeviation) VALUES (@u, @lat, @lng, @label, @dev)`,
    { u: userId, lat, lng, label: o.OutletName, dev: d > env.geofenceMeters }, tx);
  return d;
}

export const lockOutlet = (id, tx) =>
  db.query('SELECT OutletId FROM dbo.Outlets WITH (UPDLOCK, HOLDLOCK) WHERE OutletId = @id', { id }, tx);

/* ── Payments ──────────────────────────────────────────────────────── */
router.get('/outlets/:id/payments', async (req, res) => {
  const id = Number(req.params.id);
  await assertOutletVisible(req.user, id);
  const [[bal], history] = await db.queryMulti(
    `SELECT b.Outstanding, b.LastMonthSales, o.OpeningOutstanding,
            (SELECT ISNULL(SUM(TotalAmount),0) FROM dbo.Orders WHERE OutletId = @id AND PaymentTerms = 'CREDIT') AS CreditBilled
       FROM dbo.vw_OutletBalance b JOIN dbo.Outlets o ON o.OutletId = b.OutletId WHERE b.OutletId = @id;
     SELECT TOP 20 p.ReceiptNo, p.Amount, p.Method, p.Reference, p.CollectedAt, u.FullName
       FROM dbo.Payments p JOIN dbo.Users u ON u.UserId = p.UserId WHERE p.OutletId = @id ORDER BY p.CollectedAt DESC;`, { id });
  const totalDue = Number(bal.OpeningOutstanding) + Number(bal.CreditBilled);
  res.json({
    totalDue, collected: totalDue - Number(bal.Outstanding), balance: Number(bal.Outstanding),
    history: history.map(h => ({ receiptNo: h.ReceiptNo, amount: Number(h.Amount), method: h.Method, reference: h.Reference, collectedAt: h.CollectedAt, collectedBy: h.FullName })),
  });
});

/* POST /payments { outletId, amount, method, reference? } */
router.post('/payments', async (req, res) => {
  const b = z.object({
    outletId: z.number().int().positive(), amount: z.number().positive('Enter an amount').max(1e8),
    method: z.enum(['CASH', 'UPI', 'CHEQUE']), reference: z.string().trim().max(60).optional(),
  }).parse(req.body);
  if (b.method !== 'CASH' && !b.reference) throw badRequest(b.method === 'UPI' ? 'Enter the UPI transaction ID' : 'Enter the cheque number');
  await assertOutletVisible(req.user, b.outletId);
  const receipt = await db.transaction(async tx => {
    // Lock the outlet row so concurrent collections/orders for the same outlet serialise on the balance check.
    await lockOutlet(b.outletId, tx);
    const bal = await db.one('SELECT Outstanding FROM dbo.vw_OutletBalance WHERE OutletId = @id', { id: b.outletId }, tx);
    const outstanding = Number(bal.Outstanding);
    if (b.amount > outstanding) throw badRequest(`Amount exceeds the outstanding balance (₹${outstanding.toLocaleString('en-IN')})`);
    const p = await db.one(
      `DECLARE @no VARCHAR(20) = CONCAT('RCP-', NEXT VALUE FOR dbo.ReceiptNoSeq);
       INSERT dbo.Payments (ReceiptNo, OutletId, UserId, Amount, Method, Reference)
       OUTPUT inserted.ReceiptNo, inserted.CollectedAt VALUES (@no, @o, @u, @amt, @m, @ref)`,
      { o: b.outletId, u: req.user.id, amt: b.amount, m: b.method, ref: b.reference || null }, tx);
    const balance = outstanding - b.amount;
    return { receiptNo: p.ReceiptNo, collectedAt: p.CollectedAt, amount: b.amount, method: b.method, balance,
             status: balance <= 0 ? 'PAID' : 'PARTIALLY_PAID' };
  });
  res.status(201).json(receipt);
});
