import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, mockDb, calls, EXEC, MANAGER } from './helpers.js';

const CATALOG = () => [
  [{ ProductId: 7, ProductName: 'SILK SATIN', FactoryRate: 430, Mrp: 645, Moq: 10, HasSleeves: false, HalfSleeveFactor: 0.92 }],
  [{ ColorId: 71, ProductId: 7, ColorName: 'Dull Pink' }],
  [{ ColorId: 71, SizeCode: '36', StockStatus: 'IN_STOCK', QtyOnHand: 0 }, { ColorId: 71, SizeCode: '42', StockStatus: 'STOPPED', QtyOnHand: 0 },
   { ColorId: 71, SizeCode: '44', StockStatus: 'IN_STOCK', QtyOnHand: 38 }],
];
const HEAD = (status = 'PENDING') => ({
  DemandOrderId: 5, DemandNo: 'DMD-2026-1001', OutletId: 3, OutletName: 'City Garments', BeatCode: 'B1', BeatName: 'JP Nagar',
  UserId: 3, ExecName: 'Ravi Kumar', EmpCode: 'FA-2231', OrderedAt: new Date(), TotalPieces: 8, FulfilledPieces: 0, SubTotal: 3440,
  MrpValue: 5160, ProductCount: 1, Remarks: null, ExpectedBy: null, CurrentStatus: status,
});
const LOADED = (status = 'PENDING') => [[HEAD(status)], [], [], []];
const outletVisible = [
  [/ManagerId = @id/, () => [{ UserId: 3 }]],
  [/SELECT BeatId, CreatedBy, ApprovalStatus FROM dbo.Outlets/, () => [{ BeatId: 1, CreatedBy: 3, ApprovalStatus: 'APPROVED' }]],
  [/FROM dbo.BeatAssignments ba JOIN dbo.Beats/, () => [{ BeatId: 1 }]],
];
const body = (lines, extra = {}) => ({ clientRef: 'dmd-ref-0001', outletId: 3, lines, ...extra });

test('demand order accepts zero-stock and stopped cells, skips MOQ and starts Pending', async () => {
  mockDb([
    ...outletVisible,
    [/SELECT DemandOrderId FROM dbo.DemandOrders WHERE UserId = @u AND ClientRef/, () => []],
    [/SELECT SizeCode FROM dbo.Sizes/, () => ['36', '38', '40', '42', '44', '46'].map(SizeCode => ({ SizeCode }))],
    [/FROM dbo.Products WHERE IsActive = 1 AND ProductId IN/, CATALOG],
    [/INSERT dbo.DemandOrders \(/, () => [{ DemandOrderId: 5, DemandNo: 'DMD-2026-1001' }]],
    [/WHERE d.DemandOrderId = @id;/, () => LOADED()],
  ]);
  const r = await request(app).post('/api/demand-orders').set('Authorization', EXEC)
    .send(body([{ productId: 7, colorId: 71, size: '36', qty: 5 }, { productId: 7, colorId: 71, size: '42', qty: 3 }], { remarks: 'Wedding season' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.demandNo, 'DMD-2026-1001');
  assert.equal(r.body.status, 'PENDING');

  const head = calls.find(c => /INSERT dbo.DemandOrders \(/.test(c.text));
  assert.equal(head.params.pcs, 8);                 // below the product MOQ of 10 — allowed for demand
  assert.equal(head.params.sub, 8 * 430);
  const lines = JSON.parse(calls.find(c => /INSERT dbo.DemandOrderLines/.test(c.text)).params.lines);
  assert.deepEqual(lines.map(l => [l.size, l.stockStatus, l.stockQty]), [['36', 'IN_STOCK', 0], ['42', 'STOPPED', 0]]);
  // stock is never touched by a demand
  assert.ok(!calls.some(c => /UPDATE dbo.StockLevels|INSERT dbo.Orders\b|usp_RecordOutletVisit/.test(c.text)));
  assert.ok(calls.some(c => /INSERT dbo.DemandOrderStatusLog \(DemandOrderId, StatusCode, ChangedBy\) VALUES \(@id, 'PENDING'/.test(c.text)));
});

test('demand order refuses cells that have stock on hand', async () => {
  mockDb([
    ...outletVisible,
    [/SELECT DemandOrderId FROM dbo.DemandOrders WHERE UserId = @u AND ClientRef/, () => []],
    [/SELECT SizeCode FROM dbo.Sizes/, () => ['36', '42', '44'].map(SizeCode => ({ SizeCode }))],
    [/FROM dbo.Products WHERE IsActive = 1 AND ProductId IN/, CATALOG],
  ]);
  const r = await request(app).post('/api/demand-orders').set('Authorization', EXEC)
    .send(body([{ productId: 7, colorId: 71, size: '44', qty: 5 }]));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /has 38 pcs in stock — take it as a stock order/);
  assert.ok(!calls.some(c => /INSERT dbo.DemandOrders/.test(c.text)));
});

test('demand order is idempotent on clientRef and validates quantities', async () => {
  mockDb([
    ...outletVisible,
    [/SELECT DemandOrderId FROM dbo.DemandOrders WHERE UserId = @u AND ClientRef/, () => [{ DemandOrderId: 5 }]],
    [/WHERE d.DemandOrderId = @id;/, () => LOADED()],
  ]);
  const again = await request(app).post('/api/demand-orders').set('Authorization', EXEC).send(body([{ productId: 7, colorId: 71, size: '36', qty: 5 }]));
  assert.equal(again.status, 200);
  assert.equal(again.body.id, 5);
  assert.ok(!calls.some(c => /INSERT dbo.DemandOrders/.test(c.text)), 'a resubmission must not create a second demand');

  const zero = await request(app).post('/api/demand-orders').set('Authorization', EXEC).send(body([{ productId: 7, colorId: 71, size: '36', qty: 0 }]));
  assert.equal(zero.status, 400);
  assert.match(zero.body.error, /greater than zero/);
  const none = await request(app).post('/api/demand-orders').set('Authorization', EXEC).send(body([]));
  assert.equal(none.status, 400);
  const past = await request(app).post('/api/demand-orders').set('Authorization', EXEC)
    .send(body([{ productId: 7, colorId: 71, size: '36', qty: 1 }], { expectedBy: '2020-01-01' }));
  assert.equal(past.status, 400);
});

test('only managers review and fulfil demands; transitions follow the workflow', async () => {
  mockDb([
    [/ManagerId = @id/, () => [{ UserId: 3 }]],
    [/SELECT UserId, DemandNo, OutletId, CurrentStatus FROM dbo.DemandOrders/, () => [{ UserId: 3, DemandNo: 'DMD-2026-1001', OutletId: 3, CurrentStatus: 'PENDING' }]],
    [/SELECT UserId, DemandNo, CurrentStatus FROM dbo.DemandOrders WITH \(UPDLOCK/, () => [{ UserId: 3, DemandNo: 'DMD-2026-1001', CurrentStatus: 'PENDING' }]],
    [/WHERE d.DemandOrderId = @id;/, () => LOADED('APPROVED')],
  ]);
  assert.equal((await request(app).post('/api/demand-orders/5/status').set('Authorization', EXEC).send({ status: 'APPROVED' })).status, 403);
  assert.equal((await request(app).post('/api/demand-orders/5/fulfil').set('Authorization', EXEC).send({})).status, 403);

  const noReason = await request(app).post('/api/demand-orders/5/status').set('Authorization', MANAGER).send({ status: 'REJECTED' });
  assert.equal(noReason.status, 400);
  const skip = await request(app).post('/api/demand-orders/5/status').set('Authorization', MANAGER).send({ status: 'PROCESSING' });
  assert.equal(skip.status, 400);
  assert.match(skip.body.error, /cannot be moved/);

  const ok = await request(app).post('/api/demand-orders/5/status').set('Authorization', MANAGER).send({ status: 'APPROVED', note: 'Raise with factory' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const upd = calls.find(c => /UPDATE dbo.DemandOrders/.test(c.text));
  assert.equal(upd.params.next, 'APPROVED');
  assert.equal(upd.params.u, 2);
});

test('fulfilment raises a linked regular order for in-stock quantities and marks the demand partly fulfilled', async () => {
  const fulfilDb = status => [
    [/ManagerId = @id/, () => [{ UserId: 3 }]],
    [/SELECT UserId, DemandNo, OutletId, CurrentStatus FROM dbo.DemandOrders/, () => [{ UserId: 3, DemandNo: 'DMD-2026-1001', OutletId: 3, CurrentStatus: status }]],
    [/SELECT OrderId FROM dbo.Orders WHERE UserId = @u AND ClientRef/, () => []],
    [/SELECT DemandNo, UserId, OutletId, CurrentStatus FROM dbo.DemandOrders WITH/, () => [{ DemandNo: 'DMD-2026-1001', UserId: 3, OutletId: 3, CurrentStatus: status }]],
    [/FROM dbo.DemandOrderLines l WITH \(UPDLOCK\)/, () => [
      { DemandLineId: 50, ProductId: 7, ColorId: 71, SizeCode: '44', Sleeve: 'FULL', Qty: 10, FulfilledQty: 0, ProductName: 'SILK SATIN', ColorName: 'Dull Pink', StockStatus: 'IN_STOCK', QtyOnHand: 38 },
      { DemandLineId: 51, ProductId: 7, ColorId: 71, SizeCode: '42', Sleeve: 'FULL', Qty: 4, FulfilledQty: 0, ProductName: 'SILK SATIN', ColorName: 'Dull Pink', StockStatus: 'STOPPED', QtyOnHand: 0 },
    ]],
    [/FROM dbo.Products WHERE IsActive = 1 AND ProductId IN/, CATALOG],
    [/vw_OutletBalance b JOIN dbo.Outlets/, () => [{ Outstanding: 0, CreditLimit: 100000, OutletName: 'City Garments' }]],
    [/SELECT TOP \(1\) TransportMode/, () => [{ TransportMode: 'Lorry', Transporter: 'VRL', Destination: 'JP Nagar' }]],
    [/INSERT dbo.Orders \(/, () => [{ OrderId: 900, OrderNo: 'ORD-2026-9000' }]],
    [/WHERE d.DemandOrderId = @id;/, () => LOADED('PARTIALLY_FULFILLED')],
  ];
  mockDb(fulfilDb('APPROVED'));
  const r = await request(app).post('/api/demand-orders/5/fulfil').set('Authorization', MANAGER)
    .send({ clientRef: 'ful-ref-0001', lines: [{ lineId: 50, qty: 10 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const order = calls.find(c => /INSERT dbo.Orders \(/.test(c.text));
  assert.equal(order.params.demand, 5);
  assert.equal(order.params.u, 3);                  // the order belongs to the executive who captured the demand
  assert.equal(order.params.pcs, 10);               // MOQ not enforced, regular price + tax
  assert.equal(order.params.sub, 4300);
  assert.equal(order.params.trn, 'VRL');
  const done = calls.find(c => /INSERT dbo.DemandFulfilments/.test(c.text));
  assert.deepEqual(JSON.parse(done.params.done), [{ lineId: 50, qty: 10 }]);
  assert.equal(calls.find(c => /UPDATE dbo.DemandOrders SET CurrentStatus = @next/.test(c.text)).params.next, 'PARTIALLY_FULFILLED');

  const tooMuch = await request(app).post('/api/demand-orders/5/fulfil').set('Authorization', MANAGER)
    .send({ clientRef: 'ful-ref-0002', lines: [{ lineId: 51, qty: 1 }] });
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.body.error, /stopped/);

  mockDb(fulfilDb('PENDING'));
  const pending = await request(app).post('/api/demand-orders/5/fulfil').set('Authorization', MANAGER)
    .send({ clientRef: 'ful-ref-0003', lines: [{ lineId: 50, qty: 1 }] });
  assert.equal(pending.status, 400);
  assert.match(pending.body.error, /Approve the demand/);
});

test('demand list is scoped to the caller and reports pending vs fulfilled pieces', async () => {
  mockDb([
    [/ORDER BY d.OrderedAt DESC/, () => [[HEAD('PARTIALLY_FULFILLED')], [{ n: 1, pcs: 8, done: 3, pending: 5, amt: 3440 }], [{ status: 'PARTIALLY_FULFILLED', n: 1 }]]],
  ]);
  const r = await request(app).get('/api/demand-orders').query({ status: 'PARTIALLY_FULFILLED', productId: 7 }).set('Authorization', EXEC);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.totals, { pieces: 8, fulfilled: 3, pending: 5, amount: 3440 });
  const q = calls[0];
  assert.equal(q.params.scopeIds, JSON.stringify([3]));
  assert.equal(q.params.productId, 7);
});
