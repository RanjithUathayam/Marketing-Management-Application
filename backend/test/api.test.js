import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app, mockDb, calls, EXEC, MANAGER, ADMIN } from './helpers.js';

test('health endpoint is public', async () => {
  mockDb([]);
  const r = await request(app).get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.database, 'up');
});

test('protected routes require a valid bearer token', async () => {
  mockDb([]);
  assert.equal((await request(app).get('/api/dashboard/exec')).status, 401);
  assert.equal((await request(app).get('/api/orders').set('Authorization', 'Bearer nope')).status, 401);
});

test('role guards: executives cannot use manager or admin endpoints', async () => {
  mockDb([[/ManagerId = @id/, () => [{ UserId: 3 }]]]);
  for (const [m, url] of [['get', '/api/dashboard/manager'], ['get', '/api/team'], ['get', '/api/admin/users'],
                          ['post', '/api/orders/5/advance'], ['post', '/api/expenses/1/approve'], ['get', '/api/sample-pads/records']]) {
    const r = await request(app)[m](url).set('Authorization', EXEC).send({});
    assert.equal(r.status, 403, `${m} ${url}`);
  }
  // managers are not admins either
  assert.equal((await request(app).get('/api/admin/users').set('Authorization', MANAGER)).status, 403);
});

test('OTP login: request echoes OTP in dev, verify issues tokens, wrong OTP increments attempts', async () => {
  let stored;
  mockDb([
    [/FROM dbo.Users WHERE Mobile = @mobile/, () => [{ UserId: 3, IsActive: true }]],
    [/INSERT dbo.OtpCodes/, p => { stored = p.hash; return []; }],
  ]);
  const r1 = await request(app).post('/api/auth/otp/request').send({ mobile: '9880100210' });
  assert.equal(r1.status, 200);
  assert.match(r1.body.devOtp, /^\d{6}$/);
  assert.ok(await bcrypt.compare(r1.body.devOtp, stored));

  const otpRow = { OtpId: 7, CodeHash: stored, Attempts: 0, Expired: 0, UserId: 3 };
  const user = { UserId: 3, EmpCode: 'FA-2231', FullName: 'Ravi Kumar', Mobile: '9880100210', RoleCode: 'EXEC', ManagerId: 2, ManagerName: 'Priya K.' };
  mockDb([[/FROM dbo.OtpCodes o JOIN/, () => [otpRow]], [/WHERE u.UserId = @id/, () => [user]]]);
  const bad = await request(app).post('/api/auth/otp/verify').send({ mobile: '9880100210', otp: r1.body.devOtp === '000000' ? '111111' : '000000' });
  assert.equal(bad.status, 401);
  assert.ok(calls.some(c => /Attempts = Attempts \+ 1/.test(c.text)));

  const ok = await request(app).post('/api/auth/otp/verify').send({ mobile: '9880100210', otp: r1.body.devOtp });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.empCode, 'FA-2231');
  assert.equal(ok.body.user.manager.name, 'Priya K.');
  assert.ok(ok.body.accessToken && ok.body.refreshToken);
  assert.ok(calls.some(c => /INSERT dbo.RefreshTokens/.test(c.text)));
});

test('OTP request for unknown number looks identical (no user enumeration) and validates format', async () => {
  mockDb([]);
  const r = await request(app).post('/api/auth/otp/request').send({ mobile: '9999999999' });
  assert.equal(r.status, 200);
  assert.equal(r.body.devOtp, undefined);
  const bad = await request(app).post('/api/auth/otp/request').send({ mobile: '123' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /10-digit/);
});

test('order quote prices server-side and flags credit limit', async () => {
  mockDb([
    [/ManagerId = @id/, () => []],
    [/SELECT BeatId, CreatedBy, ApprovalStatus FROM dbo.Outlets/, () => [{ BeatId: 1, CreatedBy: 3, ApprovalStatus: 'APPROVED' }]],
    [/FROM dbo.BeatAssignments ba JOIN dbo.Beats/, () => [{ BeatId: 1 }]],
    [/FROM dbo.Products WHERE IsActive = 1 AND ProductId IN/, () => [
      [{ ProductId: 1, ProductName: 'CARLOS', FactoryRate: 555, Mrp: 835, Moq: 5, HasSleeves: true, HalfSleeveFactor: 0.92, SchemeBuyQty: 10, SchemeFreeQty: 1 }],
      [{ ColorId: 11, ProductId: 1, ColorName: 'Walnut' }],
      [{ ColorId: 11, SizeCode: '36', StockStatus: 'IN_STOCK' }, { ColorId: 11, SizeCode: '38', StockStatus: 'STOPPED' }],
    ]],
    [/vw_OutletBalance b JOIN dbo.Outlets/, () => [{ Outstanding: 96500, CreditLimit: 80000, OutletName: 'Royal Textiles' }]],
  ]);
  const ok = await request(app).post('/api/orders/quote').set('Authorization', EXEC)
    .send({ outletId: 3, paymentTerms: 'CREDIT', lines: [{ productId: 1, colorId: 11, size: '36', sleeve: 'FULL', qty: 10 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.subTotal, 5550);
  assert.equal(ok.body.products[0].freeQty, 1);
  assert.equal(ok.body.credit.exceeds, true);

  const stopped = await request(app).post('/api/orders/quote').set('Authorization', EXEC)
    .send({ outletId: 3, lines: [{ productId: 1, colorId: 11, size: '38', qty: 10 }] });
  assert.equal(stopped.status, 400);
  assert.match(stopped.body.error, /stopped/);
});

test('validation errors return 400 with field details', async () => {
  mockDb([]);
  const r = await request(app).post('/api/payments').set('Authorization', EXEC).send({ outletId: 1, amount: -5, method: 'CASH' });
  assert.equal(r.status, 400);
  assert.ok(r.body.details.some(d => d.field === 'amount'));
  const r2 = await request(app).post('/api/payments').set('Authorization', EXEC).send({ outletId: 1, amount: 50, method: 'UPI' });
  assert.match(r2.body.error, /UPI transaction ID/);
});

test('sample pad acknowledgement accepts only the matching QR of the owner', async () => {
  const pad = { SamplePadId: 4, RecordNo: 'SP-1004', ItemCode: 'SP04', PadName: 'SILK SATIN SHADE CARD', Subgroup: 'Subgroup 9', Qty: 2,
    DcNo: 'DC/26-27/0902', DcDate: new Date('2026-10-02'), UserId: 3, EmpCode: 'FA-2231', FullName: 'Ravi Kumar', AckAt: null };
  mockDb([[/WHERE sp.SamplePadId = @id/, () => [pad]]]);
  const wrong = await request(app).post('/api/sample-pads/4/acknowledge').set('Authorization', EXEC).send({ code: 'SP|FA-2231|DC/26-27/0902|SP05' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /different sample pad/);
  const right = await request(app).post('/api/sample-pads/4/acknowledge').set('Authorization', EXEC).send({ code: 'SP|FA-2231|DC/26-27/0902|SP04' });
  assert.equal(right.status, 200);
  assert.ok(calls.some(c => /UPDATE dbo.SamplePads SET AckAt/.test(c.text) && c.params.via === 'QR_SCAN'));
  const other = await request(app).post('/api/sample-pads/4/acknowledge')
    .set('Authorization', MANAGER).send({ code: 'SP|FA-2231|DC/26-27/0902|SP04' });
  assert.equal(other.status, 403);
});

test('stored-procedure THROW messages surface as 400; unknown errors as generic 500', async () => {
  mockDb([[/usp_AdvanceOrderStatus/, () => { const e = new Error('Order is already completed'); e.number = 50004; throw e; }],
          [/SELECT UserId, OrderNo FROM dbo.Orders/, () => [{ UserId: 3, OrderNo: 'ORD-1' }]],
          [/ManagerId = @id/, () => [{ UserId: 3 }]]]);
  const r = await request(app).post('/api/orders/1/advance').set('Authorization', MANAGER).send({});
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Order is already completed');

  mockDb([[/vw_BeatSummary/, () => { throw new Error('boom: internal detail'); }], [/BeatAssignments/, () => [{ BeatId: 1 }]]]);
  const r2 = await request(app).get('/api/beats').set('Authorization', EXEC);
  assert.equal(r2.status, 500);
  assert.doesNotMatch(r2.body.error, /internal detail/);
});

test('team scoping: a manager cannot read a user outside their team', async () => {
  mockDb([[/ManagerId = @id/, () => [{ UserId: 3 }, { UserId: 4 }]]]);
  const r = await request(app).get('/api/targets?userId=99').set('Authorization', MANAGER);
  assert.equal(r.status, 403);
  // execs asking for someone else silently get their own data
  mockDb([[/SalesTargets/, () => [[], []]], [/SUM\(SubTotal\)/, () => [{ amt: 0 }]]]);
  const own = await request(app).get('/api/targets?userId=99').set('Authorization', EXEC);
  assert.equal(own.status, 200);
  assert.ok(calls.some(c => c.params?.u === 3));
});

test('managers cannot approve their own requests; rejecting requires remarks', async () => {
  mockDb([[/FROM dbo.Expenses WITH \(UPDLOCK\)/, () => [{ ExpenseId: 9, UserId: 2, Status: 'PENDING' }]], [/ManagerId = @id/, () => [{ UserId: 3 }]]]);
  assert.equal((await request(app).post('/api/expenses/9/approve').set('Authorization', MANAGER).send({})).status, 403);
  const r = await request(app).post('/api/expenses/9/reject').set('Authorization', MANAGER).send({});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Remarks are required/);
});

test('CSV export neutralises spreadsheet formulas', async () => {
  mockDb([[/FROM dbo.Expenses x/, () => [{ ExpenseDate: new Date('2026-10-01'), FullName: '=HYPERLINK("x")', ExpenseType: 'FUEL', Amount: 10, LimitAmount: 800, Status: 'PENDING', ManagerRemark: null }]]]);
  const r = await request(app).get('/api/reports/export?type=expenses&from=2026-10-01&to=2026-10-02').set('Authorization', ADMIN);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/csv/);
  assert.match(r.text, /"'=HYPERLINK\(""x""\)"/);
});

test('framework client errors keep their status (malformed JSON 400, missing upload 404)', async () => {
  mockDb([]);
  const bad = await request(app).post('/api/payments').set('Authorization', EXEC).set('Content-Type', 'application/json').send('{"amount":');
  assert.equal(bad.status, 400);
  assert.equal((await request(app).get('/uploads/bills/does-not-exist.png')).status, 404);
});

test('unknown routes return 404 JSON', async () => {
  mockDb([]);
  const r = await request(app).get('/api/nope').set('Authorization', EXEC);
  assert.equal(r.status, 404);
  assert.match(r.body.error, /not found/);
});
