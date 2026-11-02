import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, mockDb, calls, EXEC } from './helpers.js';

const line = { productId: 1, colorId: 11, size: '36', sleeve: 'FULL', qty: 10 };
const base = {
  outletId: 3, clientRef: 'phone-order-0001', paymentTerms: 'CASH', lines: [line],
  transport: { mode: 'Lorry', transporter: 'Uathayam', destination: 'Koramangala', deliveryDate: '2099-01-01' },
};

function mockOrderDb() {
  mockDb([
    [/ManagerId = @id/, () => []],
    [/SELECT BeatId, CreatedBy, ApprovalStatus FROM dbo.Outlets/, () => [{ BeatId: 1, CreatedBy: 3, ApprovalStatus: 'APPROVED' }]],
    [/FROM dbo.BeatAssignments ba JOIN dbo.Beats/, () => [{ BeatId: 1 }]],
    [/FROM dbo.Products WHERE IsActive = 1 AND ProductId IN/, () => [
      [{ ProductId: 1, ProductName: 'CARLOS', FactoryRate: 555, Mrp: 835, Moq: 5, HasSleeves: true, HalfSleeveFactor: 0.92, SchemeBuyQty: 10, SchemeFreeQty: 1 }],
      [{ ColorId: 11, ProductId: 1, ColorName: 'Walnut' }],
      [{ ColorId: 11, SizeCode: '36', StockStatus: 'IN_STOCK', QtyOnHand: 40 }],
    ]],
    [/vw_OutletBalance b JOIN dbo.Outlets/, () => [{ Outstanding: 0, CreditLimit: 100000, OutletName: 'Sujal Fashion' }]],
    [/DECLARE @no VARCHAR\(20\)/, () => [{ OrderId: 77, OrderNo: 'ORD-2026-8900' }]],
    [/WHERE o.OrderId = @id;/, () => [[{
      OrderId: 77, OrderNo: 'ORD-2026-8900', OutletId: 3, OutletName: 'Sujal Fashion', UserId: 3, SubTotal: 5550, MrpValue: 8350,
      SchemeValue: 555, TaxAmount: 277.5, TotalAmount: 5827.5, TotalPieces: 10, PaymentTerms: 'CASH', CurrentStatus: 'RECEIVED',
      OrderChannel: 'PHONE', CallerName: 'Sujal Shah', CallerMobile: '9880122114',
    }], [], []]],
  ]);
}

test('phone order needs the caller who confirmed it', async () => {
  mockOrderDb();
  const r = await request(app).post('/api/orders').set('Authorization', EXEC).send({ ...base, channel: 'PHONE' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /confirmed the order on the call/);
});

test('visit order still needs the customer signature', async () => {
  mockOrderDb();
  const r = await request(app).post('/api/orders').set('Authorization', EXEC).send(base);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /signature/);
});

test('phone order is saved with the caller and is not recorded as an outlet visit', async () => {
  mockOrderDb();
  const r = await request(app).post('/api/orders').set('Authorization', EXEC)
    .send({ ...base, channel: 'PHONE', signature: 'data:image/png;base64,AAAA', caller: { name: 'Sujal Shah', mobile: '9880122114' }, lat: 12.9, lng: 77.6 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.channel, 'PHONE');
  assert.deepEqual(r.body.caller, { name: 'Sujal Shah', mobile: '9880122114' });
  const insert = calls.find(c => /DECLARE @no VARCHAR\(20\)/.test(c.text));
  assert.equal(insert.params.channel, 'PHONE');
  assert.equal(insert.params.callerName, 'Sujal Shah');
  assert.equal(insert.params.sig, null, 'phone orders keep no signature');
  assert.ok(!calls.some(c => c.text === 'dbo.usp_RecordOutletVisit'), 'no outlet visit for a phone order');
  assert.ok(!calls.some(c => /INSERT dbo.GpsPoints/.test(c.text)), 'no geofence check for a phone order');
});

test('phone order rejects an invalid caller mobile', async () => {
  mockOrderDb();
  const r = await request(app).post('/api/orders').set('Authorization', EXEC)
    .send({ ...base, channel: 'PHONE', caller: { name: 'Sujal', mobile: '12345' } });
  assert.equal(r.status, 400);
});
