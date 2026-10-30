/* Selfie attendance: face verification rules, challenge/verify/start-day API and Employee Master photo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { app, mockDb, calls, EXEC, ADMIN } from './helpers.js';
import { faceEngine, evaluateVerification } from '../src/services/face.js';
import { env } from '../src/config/env.js';

const vec = (x, n = 128) => Array.from({ length: n }, (_, i) => (i === 0 ? x : 0));
const PROFILE = vec(0);
const face = (x, yaw = 0.5) => ({ faces: 1, descriptor: vec(x), yaw });
const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).jpeg().toBuffer();

/* faceEngine.analyze stand-in: returns queued results in order. */
let queue = [];
faceEngine.analyze = async () => queue.shift() ?? { faces: 0, descriptor: null, yaw: null };

test('rules: match, mismatch, no face, multiple faces', () => {
  const ok = evaluateVerification({ profile: PROFILE, front: face(0.2), turned: face(0.25, 0.62), direction: 'LEFT' });
  assert.equal(ok.status, 'PASSED');
  assert.equal(evaluateVerification({ profile: PROFILE, front: face(0.8), turned: face(0.8, 0.62), direction: 'LEFT' }).status, 'MISMATCH');
  assert.equal(evaluateVerification({ profile: PROFILE, front: { faces: 0 }, turned: face(0), direction: 'LEFT' }).status, 'NO_FACE');
  assert.equal(evaluateVerification({ profile: PROFILE, front: { faces: 2 }, turned: face(0), direction: 'LEFT' }).status, 'MULTIPLE_FACES');
});

test('rules: liveness needs a head turn in the requested direction by the same person', () => {
  const base = { profile: PROFILE, front: face(0.1, 0.5) };
  assert.equal(evaluateVerification({ ...base, turned: face(0.1, 0.5), direction: 'LEFT' }).status, 'LIVENESS_FAILED', 'no movement (photo held still)');
  assert.equal(evaluateVerification({ ...base, turned: face(0.1, 0.62), direction: 'RIGHT' }).status, 'LIVENESS_FAILED', 'wrong way');
  assert.equal(evaluateVerification({ ...base, turned: face(0.1, 0.38), direction: 'RIGHT' }).status, 'PASSED');
  assert.equal(evaluateVerification({ ...base, turned: face(0.9, 0.62), direction: 'LEFT' }).status, 'LIVENESS_FAILED', 'different person in 2nd frame');
  assert.equal(evaluateVerification({ ...base, turned: { faces: 0 }, direction: 'LEFT' }).status, 'LIVENESS_FAILED');
});

test('challenge: refused when the employee has no registered profile photo', async () => {
  mockDb([[/FROM dbo.AttendanceDays WHERE UserId = @u AND WorkDate = @d;/, () => [[{ n: 0 }], [{ hasFace: 0 }], [{ n: 0 }]]]]);
  const r = await request(app).post('/api/attendance/face/challenge').set('Authorization', EXEC);
  assert.equal(r.status, 409);
  assert.equal(r.body.details.code, 'PROFILE_PHOTO_MISSING');
  assert.ok(!calls.some(c => /INSERT dbo.FaceVerifications/.test(c.text)));
});

test('challenge: issued to the signed-in employee, refused after the day started or when rate-limited', async () => {
  mockDb([[/WorkDate = @d;/, () => [[{ n: 0 }], [{ hasFace: 1 }], [{ n: 0 }]]], [/INSERT dbo.FaceVerifications/, () => [{ id: 41 }]]]);
  const r = await request(app).post('/api/attendance/face/challenge').set('Authorization', EXEC);
  assert.equal(r.status, 201);
  assert.equal(r.body.challengeId, 41);
  assert.match(r.body.direction, /^(LEFT|RIGHT)$/);
  assert.equal(calls.find(c => /INSERT dbo.FaceVerifications/.test(c.text)).params.u, 3);

  mockDb([[/WorkDate = @d;/, () => [[{ n: 1 }], [{ hasFace: 1 }], [{ n: 0 }]]]]);
  assert.equal((await request(app).post('/api/attendance/face/challenge').set('Authorization', EXEC)).status, 409);
  mockDb([[/WorkDate = @d;/, () => [[{ n: 0 }], [{ hasFace: 1 }], [{ n: env.faceMaxAttemptsPer15Min }]]]]);
  assert.equal((await request(app).post('/api/attendance/face/challenge').set('Authorization', EXEC)).status, 429);
});

const verifyDb = (claim = { direction: 'LEFT' }) => mockDb([
  [/SET Status = 'PROCESSING'/, () => (claim ? [claim] : [])],
  [/SELECT FaceDescriptor, ProfilePhotoUpdatedAt/, () => [{ FaceDescriptor: JSON.stringify(PROFILE), ProfilePhotoUpdatedAt: new Date('2026-10-01') }]],
]);
const verify = () => request(app).post('/api/attendance/face/verify').set('Authorization', EXEC)
  .field('challengeId', '41').attach('front', jpeg, { filename: 'f.jpg', contentType: 'image/jpeg' })
  .attach('turned', jpeg, { filename: 't.jpg', contentType: 'image/jpeg' });
const finalUpdate = () => calls.find(c => /SET Status = @status/.test(c.text))?.params;

test('verify: matching face passes and the selfie is stored outside the public uploads folder', async () => {
  verifyDb();
  queue = [face(0.2, 0.5), face(0.2, 0.62)];
  const r = await verify();
  assert.equal(r.status, 200);
  assert.deepEqual({ ...r.body }, { verificationId: 41, status: 'PASSED', verified: true, message: 'Face verified successfully' });
  const u = finalUpdate();
  assert.equal(u.status, 'PASSED');
  assert.match(u.selfie, /^attendance-selfies\/\d+-[0-9a-f]{24}\.jpg$/);
  assert.ok(fs.existsSync(path.join(env.secureUploadDir, u.selfie)));
  assert.ok(!JSON.stringify(r.body).includes('attendance-selfies'), 'storage key is not exposed');
  const claim = calls.find(c => /SET Status = 'PROCESSING'/.test(c.text)).params;
  assert.equal(claim.u, 3, 'challenge must belong to the caller');
});

test('verify: different person is rejected; no face asks for a retake', async () => {
  verifyDb();
  queue = [face(0.9, 0.5), face(0.9, 0.62)];
  let r = await verify();
  assert.equal(r.body.status, 'MISMATCH');
  assert.equal(r.body.verified, false);
  assert.match(r.body.message, /does not match/);

  verifyDb();
  queue = [{ faces: 0 }, { faces: 0 }];
  r = await verify();
  assert.equal(r.body.status, 'NO_FACE');
  assert.equal(finalUpdate().selfie, null);
});

test('verify: a used, expired or foreign challenge cannot be replayed', async () => {
  verifyDb(null);
  const r = await verify();
  assert.equal(r.status, 400);
  assert.equal(r.body.details.code, 'CHALLENGE_INVALID');
});

test('verify: requires both camera frames and rejects non-images', async () => {
  verifyDb();
  let r = await request(app).post('/api/attendance/face/verify').set('Authorization', EXEC).field('challengeId', '41')
    .attach('front', jpeg, { filename: 'f.jpg', contentType: 'image/jpeg' });
  assert.equal(r.status, 400);
  r = await request(app).post('/api/attendance/face/verify').set('Authorization', EXEC).field('challengeId', '41')
    .attach('front', Buffer.from('%PDF-1.4'), { filename: 'f.pdf', contentType: 'application/pdf' });
  assert.equal(r.status, 400);
});

test('start-day: cannot be called without a passed face verification (direct API bypass)', async () => {
  mockDb([]);
  let r = await request(app).post('/api/attendance/start-day').set('Authorization', EXEC).send({ travelMode: 'BUS' });
  assert.equal(r.status, 400);
  // the old multipart selfie upload no longer starts the day
  r = await request(app).post('/api/attendance/start-day').set('Authorization', EXEC).field('travelMode', 'BUS')
    .attach('selfie', jpeg, { filename: 's.jpg', contentType: 'image/jpeg' });
  assert.equal(r.status, 400);
  // a verification id that is not PASSED / not the caller's / expired / already used / made against an older photo
  r = await request(app).post('/api/attendance/start-day').set('Authorization', EXEC).send({ verificationId: 41, travelMode: 'BUS' });
  assert.equal(r.status, 400);
  assert.equal(r.body.details.code, 'FACE_NOT_VERIFIED');
  assert.ok(!calls.some(c => /INSERT dbo.AttendanceDays/.test(c.text)));
});

test('start-day: consumes the verification once and records it on the attendance day', async () => {
  mockDb([
    [/SET Status = 'CONSUMED'/, () => [{ SelfiePath: 'attendance-selfies/x.jpg' }]],
    [/SELECT \* FROM dbo.AttendanceDays WHERE UserId = @userId/, () => [[{ TravelMode: 'WALK', FaceVerificationId: 41, DayStartedAt: new Date() }], []]],
  ]);
  const r = await request(app).post('/api/attendance/start-day').set('Authorization', EXEC)
    .send({ verificationId: 41, travelMode: 'WALK', lat: 12.9, lng: 77.6 });
  assert.equal(r.status, 201);
  assert.equal(r.body.day.faceVerified, true);
  assert.equal(r.body.day.selfie, undefined);
  const consume = calls.find(c => /SET Status = 'CONSUMED'/.test(c.text));
  assert.match(consume.text, /fv.Status = 'PASSED'/);
  assert.match(consume.text, /ProfilePhotoUpdatedAt = fv.ProfilePhotoAt/);
  assert.equal(consume.params.u, 3);
  const ins = calls.find(c => /INSERT dbo.AttendanceDays/.test(c.text)).params;
  assert.equal(ins.fv, 41);
  assert.equal(ins.selfie, 'attendance-selfies/x.jpg');
  assert.ok(calls.some(c => /INSERT dbo.GpsPoints/.test(c.text)));
});

test('start-day: second submission for the same day is a conflict and does not consume another verification', async () => {
  mockDb([[/SELECT 1 AS x FROM dbo.AttendanceDays/, () => [{ x: 1 }]]]);
  const r = await request(app).post('/api/attendance/start-day').set('Authorization', EXEC).send({ verificationId: 41, travelMode: 'CAB' });
  assert.equal(r.status, 409);
  assert.ok(!calls.some(c => /SET Status = 'CONSUMED'/.test(c.text)));
});

test('employee master photo: admin only, must contain exactly one face, replaces the template', async () => {
  mockDb([]);
  const up = auth => request(app).post('/api/admin/users/3/photo').set('Authorization', auth)
    .attach('photo', jpeg, { filename: 'p.jpg', contentType: 'image/jpeg' });
  assert.equal((await up(EXEC)).status, 403);

  mockDb([[/SELECT 1 AS x FROM dbo.Users/, () => [{ x: 1 }]]]);
  queue = [{ faces: 0 }];
  assert.equal((await up(ADMIN)).status, 400);
  queue = [{ faces: 2 }];
  assert.match((await up(ADMIN)).body.error, /More than one face/);

  let saved;
  mockDb([
    [/SELECT 1 AS x FROM dbo.Users/, () => [{ x: 1 }]],
    [/SET ProfilePhotoPath = @key/, p => { saved = p; return [{ oldPath: null }]; }],
    [/WHERE u.UserId = @id/, () => [{ UserId: 3, EmpCode: 'FA-2231', FullName: 'Ravi Kumar', RoleCode: 'EXEC', IsActive: 1,
      ProfilePhotoPath: saved.key, ProfilePhotoUpdatedAt: new Date() }]],
  ]);
  queue = [face(0.1)];
  const r = await up(ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.hasPhoto, true);
  assert.equal(r.body.FaceDescriptor, undefined);
  assert.equal(JSON.parse(saved.desc).length, 128);
  assert.equal(saved.by, 1);

  mockDb([[/SELECT ProfilePhotoPath FROM dbo.Users/, () => [{ ProfilePhotoPath: saved.key }]]]);
  const img = await request(app).get('/api/admin/users/3/photo').set('Authorization', ADMIN);
  assert.equal(img.status, 200);
  assert.match(img.headers['content-type'], /image\/jpeg/);
  assert.match(img.headers['cache-control'], /no-store/);
  mockDb([[/SELECT ProfilePhotoPath FROM dbo.Users/, () => [{ ProfilePhotoPath: '../../.env' }]]]);
  assert.equal((await request(app).get('/api/admin/users/3/photo').set('Authorization', ADMIN)).status, 404, 'no path traversal');
});

test('biometric images are not reachable through the public /uploads route', async () => {
  const r = await request(app).get('/uploads/../test-secure-uploads/profile-photos/x.jpg');
  assert.notEqual(r.status, 200);
});
