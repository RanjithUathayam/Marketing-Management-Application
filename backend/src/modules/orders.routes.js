import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { authorize, MANAGERS, scopeFilter, scopeUserIds } from '../middleware/auth.js';
import { saveDataUrl } from '../middleware/upload.js';
import { priceOrder, exceedsCredit } from '../domain/rules.js';
import { assertOutletVisible, geofenceDistance, lockOutlet } from './outlets.routes.js';
import { notify, managerOf } from '../services/notify.js';
import { badRequest, notFound, forbidden, paging, paged } from '../utils/http.js';
import { localDate, toIso } from '../utils/dates.js';

export const router = Router();

const lineSchema = z.object({
  productId: z.number().int().positive(), colorId: z.number().int().positive(),
  size: z.string().max(5), sleeve: z.enum(['FULL', 'HALF']).default('FULL'), qty: z.number().int().min(0).max(9999),
});
const quoteSchema = z.object({
  outletId: z.number().int().positive(),
  lines: z.array(lineSchema).min(1, 'Enter a quantity for at least one product').max(1000),
  paymentTerms: z.enum(['CREDIT', 'CASH', 'ONLINE']).default('CREDIT'),
});
const orderSchema = quoteSchema.extend({
  clientRef: z.string().trim().min(8).max(40),
  instructions: z.string().trim().max(500).optional(),
  signature: z.string().max(800_000).optional(),
  transport: z.object({
    mode: z.enum(['Lorry', 'Van', 'Bus']), transporter: z.string().trim().min(2, 'Enter the transporter name').max(80),
    destination: z.string().trim().min(2, 'Enter the destination').max(120), deliveryDate: z.iso.date(),
  }),
  lat: z.number().optional(), lng: z.number().optional(),
});

/** Catalog map for priceOrder(): products + colours + stock grid. */
async function loadCatalog(productIds, tx) {
  const [products, colors, stock] = await db.queryMulti(
    `SELECT * FROM dbo.Products WHERE IsActive = 1 AND ProductId IN (SELECT value FROM OPENJSON(@ids));
     SELECT ColorId, ProductId, ColorName FROM dbo.ProductColors WHERE ProductId IN (SELECT value FROM OPENJSON(@ids));
     SELECT s.ColorId, s.SizeCode, s.StockStatus FROM dbo.StockLevels s JOIN dbo.ProductColors c ON c.ColorId = s.ColorId
      WHERE c.ProductId IN (SELECT value FROM OPENJSON(@ids));`, { ids: JSON.stringify([...new Set(productIds)]) }, tx);
  return new Map(products.map(p => [p.ProductId, {
    productName: p.ProductName, factoryRate: Number(p.FactoryRate), mrp: Number(p.Mrp), moq: p.Moq,
    hasSleeves: !!p.HasSleeves, halfSleeveFactor: Number(p.HalfSleeveFactor),
    schemeBuyQty: p.SchemeBuyQty, schemeFreeQty: p.SchemeFreeQty,
    colors: new Map(colors.filter(c => c.ProductId === p.ProductId).map(c => [c.ColorId, {
      colorName: c.ColorName, stock: Object.fromEntries(stock.filter(s => s.ColorId === c.ColorId).map(s => [s.SizeCode, s.StockStatus])),
    }])),
  }]));
}

async function quote(body, tx) {
  const catalog = await loadCatalog(body.lines.map(l => l.productId), tx);
  const priced = priceOrder(body.lines, catalog, { taxRate: env.taxRate });
  const bal = await db.one(
    `SELECT b.Outstanding, o.CreditLimit, o.OutletName FROM dbo.vw_OutletBalance b JOIN dbo.Outlets o ON o.OutletId = b.OutletId
      WHERE b.OutletId = @id AND o.ApprovalStatus = 'APPROVED'`, { id: body.outletId }, tx);
  if (!bal) throw badRequest('Outlet is not approved for order taking');
  const credit = { outstanding: Number(bal.Outstanding), creditLimit: Number(bal.CreditLimit) };
  return { ...priced, credit: { ...credit, exceeds: exceedsCredit(credit, priced.totalAmount, body.paymentTerms) } };
}

/* POST /orders/quote — authoritative totals, scheme benefit and credit-limit check for the summary screen */
router.post('/orders/quote', async (req, res) => {
  const body = quoteSchema.parse(req.body);
  await assertOutletVisible(req.user, body.outletId);
  res.json(await quote(body));
});

/* POST /orders — idempotent on clientRef */
router.post('/orders', async (req, res) => {
  const body = orderSchema.parse(req.body);
  if (body.transport.deliveryDate < localDate()) throw badRequest('Delivery date cannot be in the past');
  await assertOutletVisible(req.user, body.outletId);
  const existing = await db.one('SELECT OrderId FROM dbo.Orders WHERE UserId = @u AND ClientRef = @ref', { u: req.user.id, ref: body.clientRef });
  if (existing) return res.status(200).json(await loadOrder(existing.OrderId));

  const signaturePath = body.signature ? saveDataUrl('signatures', body.signature) : null;
  const orderId = await db.transaction(async tx => {
    await lockOutlet(body.outletId, tx);
    const q = await quote(body, tx);
    const o = await db.one(
      `DECLARE @no VARCHAR(20) = CONCAT('ORD-', YEAR(SYSUTCDATETIME()), '-', NEXT VALUE FOR dbo.OrderNoSeq);
       INSERT dbo.Orders (OrderNo, OutletId, UserId, SubTotal, MrpValue, SchemeValue, TaxAmount, TotalAmount, TotalPieces, PaymentTerms,
                          Instructions, SignaturePath, TransportMode, Transporter, Destination, DeliveryDate, CurrentStatus, CreditHold,
                          Latitude, Longitude, ClientRef)
       OUTPUT inserted.OrderId, inserted.OrderNo
       VALUES (@no, @outlet, @u, @sub, @mrp, @scheme, @tax, @total, @pcs, @terms, @instr, @sig, @mode, @trn, @dest, @dd, 'RECEIVED', @hold, @lat, @lng, @ref)`,
      { outlet: body.outletId, u: req.user.id, sub: q.subTotal, mrp: q.mrpValue, scheme: q.schemeValue, tax: q.taxAmount,
        total: q.totalAmount, pcs: q.totalPieces, terms: body.paymentTerms, instr: body.instructions || null, sig: signaturePath,
        mode: body.transport.mode, trn: body.transport.transporter, dest: body.transport.destination, dd: body.transport.deliveryDate,
        hold: q.credit.exceeds, lat: body.lat ?? null, lng: body.lng ?? null, ref: body.clientRef }, tx);
    await db.query(
      `INSERT dbo.OrderLines (OrderId, ProductId, ColorId, SizeCode, Sleeve, Qty, UnitPrice, UnitMrp)
       SELECT @id, productId, colorId, size, sleeve, qty, unitPrice, unitMrp
         FROM OPENJSON(@lines) WITH (productId INT, colorId INT, size VARCHAR(5), sleeve VARCHAR(4), qty INT,
                                     unitPrice DECIMAL(10,2), unitMrp DECIMAL(10,2));
       INSERT dbo.OrderStatusLog (OrderId, StatusCode, ChangedBy) VALUES (@id, 'RECEIVED', @u);`,
      { id: o.OrderId, lines: JSON.stringify(q.lines), u: req.user.id }, tx);
    const distanceM = await geofenceDistance(body.outletId, body, req.user.id, tx);
    await db.exec('dbo.usp_RecordOutletVisit', { UserId: req.user.id, OutletId: body.outletId, VisitDate: localDate(), Ordered: true,
      NoOrderReason: null, Notes: null, Latitude: body.lat ?? null, Longitude: body.lng ?? null, DistanceM: distanceM }, tx);
    const mgr = await managerOf(req.user.id, tx);
    if (q.credit.exceeds)
      await notify(mgr, { icon: '⚠️', title: 'Credit limit exceeded', tone: 'red', link: `/orders/${o.OrderId}`,
        body: `${o.OrderNo} · ₹${q.totalAmount.toLocaleString('en-IN')} needs approval (limit ₹${q.credit.creditLimit.toLocaleString('en-IN')})` }, tx);
    return o.OrderId;
  });
  res.status(201).json(await loadOrder(orderId));
});

const ORDER_SQL = `
  SELECT o.*, ot.OutletName, b.BeatCode, b.BeatName, u.FullName AS ExecName, u.EmpCode,
         (SELECT COUNT(DISTINCT ProductId) FROM dbo.OrderLines l WHERE l.OrderId = o.OrderId) AS ProductCount
  FROM dbo.Orders o JOIN dbo.Outlets ot ON ot.OutletId = o.OutletId JOIN dbo.Beats b ON b.BeatId = ot.BeatId
  JOIN dbo.Users u ON u.UserId = o.UserId`;
const orderDto = (o, log = []) => ({
  id: o.OrderId, orderNo: o.OrderNo, outletId: o.OutletId, outletName: o.OutletName, beatCode: o.BeatCode, beatName: o.BeatName,
  userId: o.UserId, execName: o.ExecName, empCode: o.EmpCode, orderedAt: o.OrderedAt,
  subTotal: Number(o.SubTotal), mrpValue: Number(o.MrpValue), schemeValue: Number(o.SchemeValue), taxAmount: Number(o.TaxAmount),
  totalAmount: Number(o.TotalAmount), totalPieces: o.TotalPieces, productCount: o.ProductCount,
  paymentTerms: o.PaymentTerms, instructions: o.Instructions, signatureUrl: o.SignaturePath,
  transport: { mode: o.TransportMode, transporter: o.Transporter, destination: o.Destination, deliveryDate: toIso(o.DeliveryDate) },
  status: o.CurrentStatus, creditHold: !!o.CreditHold, invoiceNo: o.InvoiceNo, lrNo: o.LrNo, receivedBy: o.ReceivedBy,
  log: log.filter(l => l.OrderId === o.OrderId).map(l => ({ status: l.StatusCode, at: l.ChangedAt, by: l.ByName, note: l.Note })),
});

async function loadOrder(id) {
  const [[o], log, lines] = await db.queryMulti(
    `${ORDER_SQL} WHERE o.OrderId = @id;
     SELECT l.*, u.FullName AS ByName FROM dbo.OrderStatusLog l LEFT JOIN dbo.Users u ON u.UserId = l.ChangedBy WHERE l.OrderId = @id ORDER BY l.ChangedAt;
     SELECT l.*, p.ProductName, p.Icon, c.ColorName, c.HexValue, p.SchemeBuyQty, p.SchemeFreeQty
       FROM dbo.OrderLines l JOIN dbo.Products p ON p.ProductId = l.ProductId JOIN dbo.ProductColors c ON c.ColorId = l.ColorId
      WHERE l.OrderId = @id ORDER BY p.ProductName, c.ColorName, l.Sleeve, l.SizeCode;`, { id });
  if (!o) throw notFound('Order');
  const byProduct = new Map();
  for (const l of lines) {
    const g = byProduct.get(l.ProductId) ?? { productId: l.ProductId, name: l.ProductName, icon: l.Icon, qty: 0, amount: 0, freeQty: 0, colors: new Set(), lines: [] };
    g.qty += l.Qty; g.amount += Number(l.LineAmount); g.colors.add(l.ColorName);
    g.lines.push({ color: l.ColorName, hex: l.HexValue, size: l.SizeCode, sleeve: l.Sleeve, qty: l.Qty, unitPrice: Number(l.UnitPrice), amount: Number(l.LineAmount) });
    g.schemeBuy = l.SchemeBuyQty; g.schemeFree = l.SchemeFreeQty;
    byProduct.set(l.ProductId, g);
  }
  const products = [...byProduct.values()].map(g => ({
    productId: g.productId, name: g.name, icon: g.icon, qty: g.qty, amount: g.amount, colors: [...g.colors],
    freeQty: g.schemeBuy ? Math.floor(g.qty / g.schemeBuy) * g.schemeFree : 0, lines: g.lines,
  }));
  return { ...orderDto(o, log), products };
}

/* GET /orders?status&search&userId&from&to&page&pageSize */
router.get('/orders', async (req, res) => {
  const pg = paging(req.query);
  const params = {
    status: req.query.status || null, search: req.query.search ? `%${String(req.query.search).trim()}%` : null,
    userId: Number(req.query.userId) || null, outletId: Number(req.query.outletId) || null,
    creditHold: req.query.creditHold === 'true' ? true : null,
    from: req.query.from || null, to: req.query.to || null, offset: pg.offset, size: pg.pageSize,
  };
  const scope = await scopeFilter(req.user, 'o.UserId', params);
  const where = `${scope} AND (@status IS NULL OR o.CurrentStatus = @status) AND (@userId IS NULL OR o.UserId = @userId)
    AND (@outletId IS NULL OR o.OutletId = @outletId) AND (@creditHold IS NULL OR o.CreditHold = @creditHold)
    AND (@search IS NULL OR o.OrderNo LIKE @search OR ot.OutletName LIKE @search)
    AND (@from IS NULL OR o.OrderedAt >= @from) AND (@to IS NULL OR o.OrderedAt < DATEADD(DAY, 1, CAST(@to AS DATE)))`;
  const [rows, [tot], counts] = await db.queryMulti(
    `${ORDER_SQL} WHERE ${where} ORDER BY o.OrderedAt DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
     SELECT COUNT(*) AS n, ISNULL(SUM(o.TotalAmount),0) AS amt FROM dbo.Orders o JOIN dbo.Outlets ot ON ot.OutletId = o.OutletId WHERE ${where};
     SELECT o.CurrentStatus AS status, COUNT(*) AS n FROM dbo.Orders o JOIN dbo.Outlets ot ON ot.OutletId = o.OutletId
      WHERE ${scope} AND (@userId IS NULL OR o.UserId = @userId) AND (@search IS NULL OR o.OrderNo LIKE @search OR ot.OutletName LIKE @search)
      GROUP BY o.CurrentStatus;`, params);
  const log = rows.length ? await db.query(
    `SELECT l.*, NULL AS ByName FROM dbo.OrderStatusLog l WHERE l.OrderId IN (SELECT value FROM OPENJSON(@ids)) ORDER BY l.ChangedAt`,
    { ids: JSON.stringify(rows.map(r => r.OrderId)) }) : [];
  res.json({
    ...paged(rows.map(r => orderDto(r, log)), tot.n, pg),
    totalAmount: Number(tot.amt),
    statusCounts: Object.fromEntries(counts.map(c => [c.status, c.n])),
  });
});

router.get('/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const o = await db.one('SELECT UserId FROM dbo.Orders WHERE OrderId = @id', { id });
  if (!o) throw notFound('Order');
  const ids = await scopeUserIds(req.user);
  if (ids && !ids.includes(o.UserId)) throw forbidden();
  res.json(await loadOrder(id));
});

/* POST /orders/:id/advance { receivedBy?, note? } — managers move an order to its next status
   (in production ERP/DMS integrations call this endpoint with an admin service account). */
router.post('/orders/:id/advance', authorize(...MANAGERS), async (req, res) => {
  const id = Number(req.params.id);
  const b = z.object({ receivedBy: z.string().trim().max(80).optional(), note: z.string().trim().max(200).optional() }).parse(req.body ?? {});
  const o = await db.one('SELECT UserId, OrderNo FROM dbo.Orders WHERE OrderId = @id', { id });
  if (!o) throw notFound('Order');
  const ids = await scopeUserIds(req.user);
  if (ids && !ids.includes(o.UserId)) throw forbidden();
  const [r] = await db.exec('dbo.usp_AdvanceOrderStatus', { OrderId: id, ChangedBy: req.user.id, ReceivedBy: b.receivedBy ?? null, Note: b.note ?? null });
  await notify(o.UserId, { icon: '📦', title: `Order ${r.NewStatus.toLowerCase()}`, body: `${o.OrderNo} is now ${r.NewStatus.toLowerCase()}`, tone: 'green', link: `/orders/${id}` });
  res.json(await loadOrder(id));
});
