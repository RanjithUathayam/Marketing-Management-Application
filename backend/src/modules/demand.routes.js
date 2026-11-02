import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { authorize, MANAGERS, scopeFilter, scopeUserIds } from '../middleware/auth.js';
import { priceOrder, canMoveDemand, planFulfilment, demandStatusAfterFulfil, DEMAND_FULFILLABLE, DEMAND_STATUSES } from '../domain/rules.js';
import { assertOutletVisible, lockOutlet } from './outlets.routes.js';
import { loadCatalog, creditCheck, insertOrder } from './orders.routes.js';
import { notify, managerOf } from '../services/notify.js';
import { badRequest, notFound, forbidden, paging, paged } from '../utils/http.js';
import { localDate, toIso } from '../utils/dates.js';

/* Demand orders capture what a customer wants when it is out of stock, stopped or not stocked.
   They never reserve or reduce stock and are not sales: fulfilment raises a regular order (Orders.DemandOrderId)
   that then follows the usual approval → invoice → dispatch lifecycle. */
export const router = Router();

const demandSchema = z.object({
  clientRef: z.string().trim().min(8).max(40),
  outletId: z.number().int().positive(),
  lines: z.array(z.object({
    productId: z.number().int().positive(), colorId: z.number().int().positive(),
    size: z.string().max(5), sleeve: z.enum(['FULL', 'HALF']).default('FULL'),
    qty: z.number().int().min(1, 'Requested quantity must be greater than zero').max(9999),
  })).min(1, 'Add at least one item to the demand order').max(1000),
  remarks: z.string().trim().max(500).optional(),
  expectedBy: z.iso.date().optional(),
  lat: z.number().optional(), lng: z.number().optional(),
});
const statusSchema = z.object({
  status: z.enum(['APPROVED', 'PROCESSING', 'REJECTED']),
  note: z.string().trim().max(200).optional(),
});
const fulfilSchema = z.object({
  clientRef: z.string().trim().min(8).max(40),
  paymentTerms: z.enum(['CREDIT', 'CASH', 'ONLINE']).default('CREDIT'),
  lines: z.array(z.object({ lineId: z.number().int().positive(), qty: z.number().int().min(0).max(9999) })).min(1).max(1000),
  note: z.string().trim().max(200).optional(),
});

/* POST /demand-orders — idempotent on clientRef. Any colour × size may be requested whatever its stock. */
router.post('/demand-orders', async (req, res) => {
  const body = demandSchema.parse(req.body);
  if (body.expectedBy && body.expectedBy < localDate()) throw badRequest('Required-by date cannot be in the past');
  const outlet = await assertOutletVisible(req.user, body.outletId);
  if (outlet.ApprovalStatus !== 'APPROVED') throw badRequest('Outlet is not approved for order taking');
  const existing = await findByRef(req.user.id, body.clientRef);
  if (existing) return res.status(200).json(await loadDemand(existing));

  let id;
  try {
    id = await db.transaction(async tx => {
      const sizes = (await db.query('SELECT SizeCode FROM dbo.Sizes', {}, tx)).map(s => s.SizeCode);
      const catalog = await loadCatalog(body.lines.map(l => l.productId), tx);
      const q = priceOrder(body.lines, catalog, { taxRate: 0, demand: true, sizes, enforceMoq: false });
      const d = await db.one(
        `DECLARE @no VARCHAR(20) = CONCAT('DMD-', YEAR(SYSUTCDATETIME()), '-', NEXT VALUE FOR dbo.DemandOrderNoSeq);
         INSERT dbo.DemandOrders (DemandNo, OutletId, UserId, TotalPieces, SubTotal, MrpValue, Remarks, ExpectedBy, CurrentStatus,
                                  Latitude, Longitude, ClientRef)
         OUTPUT inserted.DemandOrderId, inserted.DemandNo
         VALUES (@no, @outlet, @u, @pcs, @sub, @mrp, @remarks, @expected, 'PENDING', @lat, @lng, @ref)`,
        { outlet: body.outletId, u: req.user.id, pcs: q.totalPieces, sub: q.subTotal, mrp: q.mrpValue, remarks: body.remarks || null,
          expected: body.expectedBy ?? null, lat: body.lat ?? null, lng: body.lng ?? null, ref: body.clientRef }, tx);
      await db.query(
        `INSERT dbo.DemandOrderLines (DemandOrderId, ProductId, ColorId, SizeCode, Sleeve, Qty, UnitPrice, UnitMrp, StockStatusAtOrder, StockQtyAtOrder)
         SELECT @id, productId, colorId, size, sleeve, qty, unitPrice, unitMrp, stockStatus, ISNULL(stockQty, 0)
           FROM OPENJSON(@lines) WITH (productId INT, colorId INT, size VARCHAR(5), sleeve VARCHAR(4), qty INT,
                                       unitPrice DECIMAL(10,2), unitMrp DECIMAL(10,2), stockStatus VARCHAR(10), stockQty INT);
         INSERT dbo.DemandOrderStatusLog (DemandOrderId, StatusCode, ChangedBy) VALUES (@id, 'PENDING', @u);`,
        { id: d.DemandOrderId, lines: JSON.stringify(q.lines), u: req.user.id }, tx);
      const mgr = await managerOf(req.user.id, tx);
      await notify(mgr, { icon: '📝', title: 'New demand order', tone: 'blue', link: `/demand-orders/${d.DemandOrderId}`,
        body: `${d.DemandNo} · ${req.user.name} · ${q.totalPieces} pcs awaiting review` }, tx);
      return d.DemandOrderId;
    });
  } catch (err) {
    // Two taps raced past the clientRef check: the unique index kept one — return it.
    if (err?.number === 2627 || err?.number === 2601) {
      const dup = await findByRef(req.user.id, body.clientRef);
      if (dup) return res.status(200).json(await loadDemand(dup));
    }
    throw err;
  }
  res.status(201).json(await loadDemand(id));
});
async function findByRef(userId, ref) {
  const r = await db.one('SELECT DemandOrderId FROM dbo.DemandOrders WHERE UserId = @u AND ClientRef = @ref', { u: userId, ref });
  return r?.DemandOrderId ?? null;
}

const DEMAND_SQL = `
  SELECT d.*, ot.OutletName, b.BeatCode, b.BeatName, u.FullName AS ExecName, u.EmpCode, r.FullName AS ReviewedByName,
         x.ProductCount, x.FulfilledPieces
  FROM dbo.DemandOrders d JOIN dbo.Outlets ot ON ot.OutletId = d.OutletId JOIN dbo.Beats b ON b.BeatId = ot.BeatId
  JOIN dbo.Users u ON u.UserId = d.UserId LEFT JOIN dbo.Users r ON r.UserId = d.ReviewedBy
  OUTER APPLY (SELECT COUNT(DISTINCT l.ProductId) AS ProductCount, ISNULL(SUM(l.FulfilledQty), 0) AS FulfilledPieces
               FROM dbo.DemandOrderLines l WHERE l.DemandOrderId = d.DemandOrderId) x`;
const demandDto = (d, log = []) => ({
  id: d.DemandOrderId, demandNo: d.DemandNo, outletId: d.OutletId, outletName: d.OutletName, beatCode: d.BeatCode, beatName: d.BeatName,
  userId: d.UserId, execName: d.ExecName, empCode: d.EmpCode, orderedAt: d.OrderedAt,
  totalPieces: d.TotalPieces, fulfilledPieces: d.FulfilledPieces ?? 0,
  pendingPieces: d.CurrentStatus === 'REJECTED' ? 0 : d.TotalPieces - (d.FulfilledPieces ?? 0),
  subTotal: Number(d.SubTotal), mrpValue: Number(d.MrpValue), productCount: d.ProductCount ?? 0,
  remarks: d.Remarks, expectedBy: toIso(d.ExpectedBy), status: d.CurrentStatus,
  reviewedBy: d.ReviewedByName ?? null, reviewedAt: d.ReviewedAt, reviewNote: d.ReviewNote,
  log: log.filter(l => l.DemandOrderId === d.DemandOrderId).map(l => ({ status: l.StatusCode, at: l.ChangedAt, by: l.ByName, note: l.Note })),
});

export async function loadDemand(id, tx) {
  const [[d], log, lines, orders] = await db.queryMulti(
    `${DEMAND_SQL} WHERE d.DemandOrderId = @id;
     SELECT l.*, u.FullName AS ByName FROM dbo.DemandOrderStatusLog l LEFT JOIN dbo.Users u ON u.UserId = l.ChangedBy
      WHERE l.DemandOrderId = @id ORDER BY l.ChangedAt, l.LogId;
     SELECT l.*, p.ProductName, p.Icon, c.ColorName, c.ColorCode, c.HexValue, s.StockStatus AS StockNow, s.QtyOnHand AS StockQtyNow
       FROM dbo.DemandOrderLines l JOIN dbo.Products p ON p.ProductId = l.ProductId JOIN dbo.ProductColors c ON c.ColorId = l.ColorId
       JOIN dbo.Sizes z ON z.SizeCode = l.SizeCode
       LEFT JOIN dbo.StockLevels s ON s.ColorId = l.ColorId AND s.SizeCode = l.SizeCode
      WHERE l.DemandOrderId = @id ORDER BY p.ProductName, c.ColorName, l.Sleeve, z.SortOrder;
     SELECT o.OrderId, o.OrderNo, o.CurrentStatus, o.TotalPieces, o.TotalAmount, o.OrderedAt
       FROM dbo.Orders o WHERE o.DemandOrderId = @id ORDER BY o.OrderedAt;`, { id }, tx);
  if (!d) throw notFound('Demand order');
  return {
    ...demandDto(d, log),
    lines: lines.map(l => ({
      id: l.DemandLineId, productId: l.ProductId, productName: l.ProductName, icon: l.Icon,
      colorId: l.ColorId, color: l.ColorName, colorCode: l.ColorCode, hex: l.HexValue, size: l.SizeCode, sleeve: l.Sleeve,
      qty: l.Qty, fulfilledQty: l.FulfilledQty, pendingQty: d.CurrentStatus === 'REJECTED' ? 0 : l.Qty - l.FulfilledQty,
      unitPrice: Number(l.UnitPrice), amount: Number(l.LineAmount),
      stockAtOrder: { status: l.StockStatusAtOrder, qty: l.StockQtyAtOrder },
      stockNow: { status: l.StockNow ?? 'NONE', qty: l.StockQtyNow ?? 0 },
    })),
    orders: orders.map(o => ({ id: o.OrderId, orderNo: o.OrderNo, status: o.CurrentStatus, totalPieces: o.TotalPieces,
      totalAmount: Number(o.TotalAmount), orderedAt: o.OrderedAt })),
  };
}

/** Shared filters for the list and the pending-demand report. */
async function listFilter(req, params) {
  Object.assign(params, {
    status: DEMAND_STATUSES.includes(req.query.status) ? req.query.status : null,
    open: req.query.open === 'true' ? true : null,
    search: req.query.search ? `%${String(req.query.search).trim()}%` : null,
    userId: Number(req.query.userId) || null, outletId: Number(req.query.outletId) || null,
    productId: Number(req.query.productId) || null,
    from: req.query.from || null, to: req.query.to || null,
  });
  const scope = await scopeFilter(req.user, 'd.UserId', params);
  return `${scope} AND (@userId IS NULL OR d.UserId = @userId) AND (@outletId IS NULL OR d.OutletId = @outletId)
    AND (@search IS NULL OR d.DemandNo LIKE @search OR ot.OutletName LIKE @search)
    AND (@productId IS NULL OR EXISTS (SELECT 1 FROM dbo.DemandOrderLines pl WHERE pl.DemandOrderId = d.DemandOrderId AND pl.ProductId = @productId))
    AND (@from IS NULL OR d.OrderedAt >= @from) AND (@to IS NULL OR d.OrderedAt < DATEADD(DAY, 1, CAST(@to AS DATE)))`;
}
const OPEN_SQL = `d.CurrentStatus NOT IN ('FULFILLED','REJECTED')`;

/* GET /demand-orders?status&open&search&userId&outletId&productId&from&to&page&pageSize */
router.get('/demand-orders', async (req, res) => {
  const pg = paging(req.query);
  const params = { offset: pg.offset, size: pg.pageSize };
  const base = await listFilter(req, params);
  const where = `${base} AND (@status IS NULL OR d.CurrentStatus = @status) AND (@open IS NULL OR ${OPEN_SQL})`;
  const [rows, [tot], counts] = await db.queryMulti(
    `${DEMAND_SQL} WHERE ${where} ORDER BY d.OrderedAt DESC, d.DemandOrderId DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
     SELECT COUNT(*) AS n, ISNULL(SUM(d.TotalPieces), 0) AS pcs, ISNULL(SUM(x.FulfilledPieces), 0) AS done,
            ISNULL(SUM(CASE WHEN d.CurrentStatus = 'REJECTED' THEN 0 ELSE d.TotalPieces - x.FulfilledPieces END), 0) AS pending,
            ISNULL(SUM(d.SubTotal), 0) AS amt
       FROM dbo.DemandOrders d JOIN dbo.Outlets ot ON ot.OutletId = d.OutletId
       OUTER APPLY (SELECT ISNULL(SUM(l.FulfilledQty), 0) AS FulfilledPieces FROM dbo.DemandOrderLines l WHERE l.DemandOrderId = d.DemandOrderId) x
      WHERE ${where};
     SELECT d.CurrentStatus AS status, COUNT(*) AS n FROM dbo.DemandOrders d JOIN dbo.Outlets ot ON ot.OutletId = d.OutletId
      WHERE ${base} GROUP BY d.CurrentStatus;`, params);
  res.json({
    ...paged(rows.map(r => demandDto(r)), tot.n, pg),
    totals: { pieces: tot.pcs, fulfilled: tot.done, pending: tot.pending, amount: Number(tot.amt) },
    statusCounts: Object.fromEntries(counts.map(c => [c.status, c.n])),
  });
});

/* GET /demand-orders/report — requested / fulfilled / pending pieces per product × colour × size (rejected demands excluded) */
router.get('/demand-orders/report', async (req, res) => {
  const params = {};
  const base = await listFilter(req, params);
  const rows = await db.query(
    `SELECT l.ProductId, p.ProductName, p.Icon, l.ColorId, c.ColorName, c.ColorCode, c.HexValue, l.SizeCode, l.Sleeve,
            SUM(l.Qty) AS Requested, SUM(l.FulfilledQty) AS Fulfilled, COUNT(DISTINCT d.DemandOrderId) AS Demands,
            COUNT(DISTINCT d.OutletId) AS Outlets, MAX(s.StockStatus) AS StockNow, MAX(s.QtyOnHand) AS StockQtyNow
       FROM dbo.DemandOrders d JOIN dbo.Outlets ot ON ot.OutletId = d.OutletId
       JOIN dbo.DemandOrderLines l ON l.DemandOrderId = d.DemandOrderId
       JOIN dbo.Products p ON p.ProductId = l.ProductId JOIN dbo.ProductColors c ON c.ColorId = l.ColorId
       JOIN dbo.Sizes z ON z.SizeCode = l.SizeCode
       LEFT JOIN dbo.StockLevels s ON s.ColorId = l.ColorId AND s.SizeCode = l.SizeCode
      WHERE ${base} AND d.CurrentStatus <> 'REJECTED' AND (@status IS NULL OR d.CurrentStatus = @status)
        AND (@open IS NULL OR ${OPEN_SQL}) AND (@productId IS NULL OR l.ProductId = @productId)
      GROUP BY l.ProductId, p.ProductName, p.Icon, l.ColorId, c.ColorName, c.ColorCode, c.HexValue, l.SizeCode, z.SortOrder, l.Sleeve
      ORDER BY SUM(l.Qty) - SUM(l.FulfilledQty) DESC, p.ProductName, c.ColorName, z.SortOrder`, params);
  res.json(rows.map(r => ({
    productId: r.ProductId, productName: r.ProductName, icon: r.Icon, colorId: r.ColorId, color: r.ColorName, colorCode: r.ColorCode,
    hex: r.HexValue, size: r.SizeCode, sleeve: r.Sleeve, requested: r.Requested, fulfilled: r.Fulfilled, pending: r.Requested - r.Fulfilled,
    demands: r.Demands, outlets: r.Outlets, stockNow: { status: r.StockNow ?? 'NONE', qty: r.StockQtyNow ?? 0 },
  })));
});

/** Loads the demand's owner and checks the caller may see it. */
async function assertDemandVisible(user, id, tx) {
  const d = await db.one('SELECT UserId, DemandNo, OutletId, CurrentStatus FROM dbo.DemandOrders WHERE DemandOrderId = @id', { id }, tx);
  if (!d) throw notFound('Demand order');
  const ids = await scopeUserIds(user);
  if (ids && !ids.includes(d.UserId)) throw forbidden();
  return d;
}

router.get('/demand-orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  await assertDemandVisible(req.user, id);
  res.json(await loadDemand(id));
});

/* POST /demand-orders/:id/status { status: APPROVED|PROCESSING|REJECTED, note? } — managers review a demand */
router.post('/demand-orders/:id/status', authorize(...MANAGERS), async (req, res) => {
  const id = Number(req.params.id);
  const b = statusSchema.parse(req.body ?? {});
  if (b.status === 'REJECTED' && !b.note) throw badRequest('Enter a reason for rejecting the demand');
  await assertDemandVisible(req.user, id);
  await db.transaction(async tx => {
    const cur = await db.one('SELECT UserId, DemandNo, CurrentStatus FROM dbo.DemandOrders WITH (UPDLOCK, HOLDLOCK) WHERE DemandOrderId = @id', { id }, tx);
    if (!canMoveDemand(cur.CurrentStatus, b.status))
      throw badRequest(`A ${label(cur.CurrentStatus)} demand cannot be moved to ${label(b.status)}`);
    await db.query(
      `UPDATE dbo.DemandOrders
          SET CurrentStatus = @next,
              ReviewedBy = CASE WHEN @next IN ('APPROVED','REJECTED') THEN @u ELSE ReviewedBy END,
              ReviewedAt = CASE WHEN @next IN ('APPROVED','REJECTED') THEN SYSUTCDATETIME() ELSE ReviewedAt END,
              ReviewNote = COALESCE(@note, ReviewNote)
        WHERE DemandOrderId = @id;
       INSERT dbo.DemandOrderStatusLog (DemandOrderId, StatusCode, ChangedBy, Note) VALUES (@id, @next, @u, @note);`,
      { id, next: b.status, u: req.user.id, note: b.note || null }, tx);
    await notify(cur.UserId, { icon: b.status === 'REJECTED' ? '⛔' : '📝', title: `Demand ${label(b.status)}`,
      tone: b.status === 'REJECTED' ? 'red' : 'green', link: `/demand-orders/${id}`,
      body: `${cur.DemandNo} is now ${label(b.status)}${b.note ? ` — ${b.note}` : ''}` }, tx);
  });
  res.json(await loadDemand(id));
});
const label = s => s.toLowerCase().replace('_', ' ');

/* POST /demand-orders/:id/fulfil { clientRef, paymentTerms, lines: [{lineId, qty}], note? }
   Stock has arrived: raises a regular order (status RECEIVED) for the given quantities, linked to the demand.
   That order then goes through the existing approval → invoice → dispatch process. Idempotent on clientRef. */
router.post('/demand-orders/:id/fulfil', authorize(...MANAGERS), async (req, res) => {
  const id = Number(req.params.id);
  const b = fulfilSchema.parse(req.body ?? {});
  const head = await assertDemandVisible(req.user, id);
  const dup = await db.one('SELECT OrderId FROM dbo.Orders WHERE UserId = @u AND ClientRef = @ref AND DemandOrderId = @id',
    { u: head.UserId, ref: b.clientRef, id });
  if (dup) return res.status(200).json(await loadDemand(id));

  await db.transaction(async tx => {
    await lockOutlet(head.OutletId, tx);
    const d = await db.one('SELECT DemandNo, UserId, OutletId, CurrentStatus FROM dbo.DemandOrders WITH (UPDLOCK, HOLDLOCK) WHERE DemandOrderId = @id', { id }, tx);
    if (!DEMAND_FULFILLABLE.includes(d.CurrentStatus))
      throw badRequest(d.CurrentStatus === 'PENDING' ? 'Approve the demand before fulfilling it' : `A ${label(d.CurrentStatus)} demand cannot be fulfilled`);
    const rows = await db.query(
      `SELECT l.DemandLineId, l.ProductId, l.ColorId, l.SizeCode, l.Sleeve, l.Qty, l.FulfilledQty, p.ProductName, c.ColorName,
              s.StockStatus, s.QtyOnHand
         FROM dbo.DemandOrderLines l WITH (UPDLOCK) JOIN dbo.Products p ON p.ProductId = l.ProductId
         JOIN dbo.ProductColors c ON c.ColorId = l.ColorId
         LEFT JOIN dbo.StockLevels s ON s.ColorId = l.ColorId AND s.SizeCode = l.SizeCode
        WHERE l.DemandOrderId = @id`, { id }, tx);
    const lines = rows.map(r => ({ id: r.DemandLineId, productId: r.ProductId, colorId: r.ColorId, size: r.SizeCode, sleeve: r.Sleeve,
      qty: r.Qty, fulfilledQty: r.FulfilledQty, productName: r.ProductName, colorName: r.ColorName,
      stockStatus: r.StockStatus ?? 'NONE', stockQty: r.QtyOnHand ?? 0 }));
    const plan = planFulfilment(lines, b.lines);

    // Price like a regular order (stopped cells refused; MOQ does not apply to fulfilling a demand).
    const catalog = await loadCatalog(plan.map(p => p.line.productId), tx);
    const priced = priceOrder(plan.map(p => ({ productId: p.line.productId, colorId: p.line.colorId, size: p.line.size,
      sleeve: p.line.sleeve, qty: p.qty })), catalog, { taxRate: env.taxRate, enforceMoq: false });
    const credit = await creditCheck(d.OutletId, priced.totalAmount, b.paymentTerms, tx);
    const last = await db.one(
      `SELECT TOP (1) TransportMode, Transporter, Destination FROM dbo.Orders
        WHERE OutletId = @o AND Transporter IS NOT NULL ORDER BY OrderedAt DESC`, { o: d.OutletId }, tx);
    const note = `Fulfils demand ${d.DemandNo}${b.note ? ` — ${b.note}` : ''}`.slice(0, 200);
    const o = await insertOrder({ ...priced, credit }, {
      outletId: d.OutletId, userId: d.UserId, changedBy: req.user.id, paymentTerms: b.paymentTerms, instructions: note,
      transport: last ? { mode: last.TransportMode, transporter: last.Transporter, destination: last.Destination, deliveryDate: localDate() } : null,
      clientRef: b.clientRef, demandOrderId: id, note,
    }, tx);

    const done = plan.map(p => ({ lineId: p.line.id, qty: p.qty }));
    await db.query(
      `INSERT dbo.DemandFulfilments (DemandLineId, OrderId, Qty, CreatedBy)
       SELECT lineId, @order, qty, @u FROM OPENJSON(@done) WITH (lineId INT, qty INT);
       UPDATE l SET FulfilledQty = l.FulfilledQty + j.qty
         FROM dbo.DemandOrderLines l JOIN OPENJSON(@done) WITH (lineId INT, qty INT) j ON j.lineId = l.DemandLineId
        WHERE l.DemandOrderId = @id;`,
      { order: o.OrderId, u: req.user.id, done: JSON.stringify(done), id }, tx);
    const after = lines.map(l => ({ ...l, fulfilledQty: l.fulfilledQty + (done.find(x => x.lineId === l.id)?.qty ?? 0) }));
    const next = demandStatusAfterFulfil(after);
    const pcs = done.reduce((s, x) => s + x.qty, 0);
    await db.query(
      `UPDATE dbo.DemandOrders SET CurrentStatus = @next WHERE DemandOrderId = @id;
       INSERT dbo.DemandOrderStatusLog (DemandOrderId, StatusCode, ChangedBy, Note) VALUES (@id, @next, @u, @note);`,
      { id, next, u: req.user.id, note: `${o.OrderNo} · ${pcs} pcs` }, tx);
    await notify(d.UserId, { icon: '📦', title: next === 'FULFILLED' ? 'Demand fulfilled' : 'Demand partly fulfilled', tone: 'green',
      link: `/orders/${o.OrderId}`, body: `${d.DemandNo}: ${pcs} pcs moved to order ${o.OrderNo}` }, tx);
    if (credit.exceeds)
      await notify(await managerOf(d.UserId, tx), { icon: '⚠️', title: 'Credit limit exceeded', tone: 'red', link: `/orders/${o.OrderId}`,
        body: `${o.OrderNo} (from ${d.DemandNo}) · ₹${priced.totalAmount.toLocaleString('en-IN')} needs approval` }, tx);
  });
  res.status(201).json(await loadDemand(id));
});
