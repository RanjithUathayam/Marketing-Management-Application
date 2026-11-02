import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, mockDb, calls } from './helpers.js';

const leave = { kind: 'LEAVE', leaveType: 'Casual Leave', fromDate: '2099-01-10', toDate: '2099-01-11', reason: 'Family function' };

test('leave can be applied from the login page without a token, using mobile + Employee ID', async () => {
  mockDb([
    [/UPPER\(u.EmpCode\) = @empCode/, () => [{ UserId: 3, FullName: 'Ravi Kumar', ManagerName: 'Priya K.' }]],
    [/ManagerId FROM dbo.Users/, () => [{ ManagerId: 2 }]],
    [/INSERT dbo.LeaveRequests/, () => [{ id: 41 }]],
  ]);
  const r = await request(app).post('/api/auth/leave-request').send({ ...leave, mobile: '9880122114', empCode: 'fa-2231' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body, { id: 41, status: 'PENDING', employeeName: 'Ravi Kumar', approver: 'Priya K.' });
  assert.equal(calls.find(c => /UPPER\(u.EmpCode\)/.test(c.text)).params.empCode, 'FA-2231');
  const insert = calls.find(c => /INSERT dbo.LeaveRequests/.test(c.text));
  assert.equal(insert.params.u, 3);
  assert.equal(insert.params.via, 'LOGIN_PAGE');
  const notes = calls.filter(c => /INSERT dbo.Notifications/.test(c.text)).map(c => c.params);
  assert.ok(notes.some(n => n.userId === 2 && /without sign-in/.test(n.body)), 'manager is told it was applied without sign-in');
  assert.ok(notes.some(n => n.userId === 3), 'employee is notified');
});

test('leave without login is refused when mobile and Employee ID do not match', async () => {
  mockDb([]);
  const r = await request(app).post('/api/auth/leave-request').send({ ...leave, mobile: '9880122114', empCode: 'FA-9999' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /do not match/);
  assert.ok(!calls.some(c => /INSERT dbo.LeaveRequests/.test(c.text)));
});

test('leave without login validates fields and past dates', async () => {
  mockDb([[/UPPER\(u.EmpCode\) = @empCode/, () => [{ UserId: 3, FullName: 'Ravi Kumar', ManagerName: null }]]]);
  const noEmp = await request(app).post('/api/auth/leave-request').send({ ...leave, mobile: '9880122114' });
  assert.equal(noEmp.status, 400);
  const past = await request(app).post('/api/auth/leave-request').send({ ...leave, fromDate: '2000-01-01', toDate: '2000-01-01', mobile: '9880122114', empCode: 'FA-2231' });
  assert.equal(past.status, 400);
  assert.match(past.body.error, /today or future/);
});

test('signed-in leave still goes through /attendance/leaves and is marked APP', async () => {
  const { EXEC } = await import('./helpers.js');
  mockDb([[/INSERT dbo.LeaveRequests/, () => [{ id: 42 }]]]);
  const r = await request(app).post('/api/attendance/leaves').set('Authorization', EXEC).send(leave);
  assert.equal(r.status, 201);
  assert.equal(calls.find(c => /INSERT dbo.LeaveRequests/.test(c.text)).params.via, 'APP');
});
