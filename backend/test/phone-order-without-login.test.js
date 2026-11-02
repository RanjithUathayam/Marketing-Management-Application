import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, mockDb, calls } from './helpers.js';

const execRow = { UserId: 3, EmpCode: 'FA-2231', FullName: 'Ravi Kumar', Mobile: '9880122114', RoleCode: 'EXEC', IsActive: true };

async function openSession() {
  mockDb([[/UPPER\(u.EmpCode\) = @empCode/, () => [execRow]]]);
  const r = await request(app).post('/api/auth/phone-order-session').send({ mobile: '9880122114', empCode: 'fa-2231' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return 'Bearer ' + r.body.accessToken;
}

test('phone order session opens with mobile + Employee ID and no refresh token', async () => {
  mockDb([[/UPPER\(u.EmpCode\) = @empCode/, () => [execRow]]]);
  const r = await request(app).post('/api/auth/phone-order-session').send({ mobile: '9880122114', empCode: 'fa-2231' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.scope, 'PHONE_ORDER');
  assert.equal(r.body.user.id, 3);
  assert.ok(r.body.accessToken);
  assert.equal(r.body.refreshToken, undefined);
  assert.equal(calls.find(c => /UPPER\(u.EmpCode\)/.test(c.text)).params.empCode, 'FA-2231');
  assert.ok(!calls.some(c => /RefreshTokens/.test(c.text)), 'no refresh token is stored');
});

test('phone order session is refused for a wrong Employee ID or a manager', async () => {
  mockDb([]);
  const bad = await request(app).post('/api/auth/phone-order-session').send({ mobile: '9880122114', empCode: 'FA-9999' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /do not match/);
  mockDb([[/UPPER\(u.EmpCode\) = @empCode/, () => [{ ...execRow, RoleCode: 'MANAGER' }]]]);
  const mgr = await request(app).post('/api/auth/phone-order-session').send({ mobile: '9880122114', empCode: 'FA-2231' });
  assert.equal(mgr.status, 400);
  assert.match(mgr.body.error, /sales executives/);
});

test('phone order token reaches order taking endpoints only', async () => {
  const auth = await openSession();
  mockDb([]);
  const products = await request(app).get('/api/products').set('Authorization', auth);
  assert.notEqual(products.status, 403);
  for (const [method, url] of [['get', '/api/attendance/today'], ['get', '/api/reports/summary'], ['get', '/api/notifications'],
    ['post', '/api/payments'], ['post', '/api/outlets/3/visits'], ['get', '/api/auth/me']]) {
    const r = await request(app)[method](url).set('Authorization', auth).send({});
    assert.equal(r.status, 403, `${method} ${url}`);
  }
});

test('phone order token cannot place a visit order', async () => {
  const auth = await openSession();
  mockDb([]);
  const r = await request(app).post('/api/orders').set('Authorization', auth).send({
    outletId: 3, clientRef: 'phone-order-0002', paymentTerms: 'CASH', signature: 'data:image/png;base64,AAAA',
    lines: [{ productId: 1, colorId: 11, size: '36', sleeve: 'FULL', qty: 10 }],
    transport: { mode: 'Lorry', transporter: 'Uathayam', destination: 'Koramangala', deliveryDate: '2099-01-01' },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Only phone orders/);
});
