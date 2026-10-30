import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { targetUserId } from '../middleware/auth.js';
import { memoryImageUploader } from '../middleware/upload.js';
import { HttpError, badRequest, conflict } from '../utils/http.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { faceEngine, evaluateVerification, storeSecureJpeg } from '../services/face.js';
import { localDate, localYearMonth, isLate, utcRange, monthRange, daysInMonth, weekday, isoDate, toIso } from '../utils/dates.js';
import { pathMeters } from '../domain/rules.js';
import { notify, managerOf } from '../services/notify.js';

export const router = Router();
const selfieFrames = memoryImageUploader(2);

const TRAVEL = ['OWN_VEHICLE', 'BUS', 'CAB', 'WALK'];
const optNum = z.preprocess(v => (v === '' || v == null ? undefined : Number(v)), z.number().finite().optional());

async function todayState(userId) {
  const today = localDate();
  const { start, end } = utcRange(today);
  const [dayRows, sessions] = await db.queryMulti(
    `SELECT * FROM dbo.AttendanceDays WHERE UserId = @userId AND WorkDate = @today;
     SELECT SessionId, CheckInAt, CheckOutAt FROM dbo.AttendanceSessions
      WHERE UserId = @userId AND (CheckOutAt IS NULL OR (CheckInAt >= @start AND CheckInAt < @end)) ORDER BY CheckInAt`,
    { userId, today, start, end });
  const d = dayRows[0];
  return {
    date: today,
    dayStarted: !!d,
    dayEnded: !!d?.DayEndedAt,
    day: d ? { travelMode: d.TravelMode, odoStart: d.OdoStart, odoEnd: d.OdoEnd, isLate: !!d.IsLate,
               startedAt: d.DayStartedAt, endedAt: d.DayEndedAt, faceVerified: !!d.FaceVerificationId } : null,
    openSession: sessions.find(s => !s.CheckOutAt) ?? null,
    sessions,
  };
}

router.get('/today', async (req, res) => res.json(await todayState(req.user.id)));

/* ── Selfie attendance punch with face verification ─────────────────────────────────────
   1. POST /attendance/face/challenge → one-time challenge (head-turn direction) for the signed-in employee
   2. POST /attendance/face/verify    → multipart challengeId + front + turned camera frames, compared on this
                                         server with the employee's registered profile photo
   3. POST /attendance/start-day      → consumes a PASSED verification; there is no other way to start the day */

const profileMissing = () => new HttpError(409,
  'Your profile photo is not registered. Ask your administrator to add it in the Employee Master before marking attendance.',
  { code: 'PROFILE_PHOTO_MISSING' });

router.post('/face/challenge', async (req, res) => {
  const [[started], [user], [recent]] = await db.queryMulti(
    `SELECT COUNT(*) AS n FROM dbo.AttendanceDays WHERE UserId = @u AND WorkDate = @d;
     SELECT CASE WHEN FaceDescriptor IS NULL THEN 0 ELSE 1 END AS hasFace FROM dbo.Users WHERE UserId = @u AND IsActive = 1;
     SELECT COUNT(*) AS n FROM dbo.FaceVerifications WHERE UserId = @u AND IssuedAt >= DATEADD(MINUTE, -15, SYSUTCDATETIME());`,
    { u: req.user.id, d: localDate() });
  if (started?.n) throw conflict('Your day has already been started');
  if (!user?.hasFace) throw profileMissing();
  if (recent?.n >= env.faceMaxAttemptsPer15Min) throw new HttpError(429, 'Too many verification attempts. Please wait 15 minutes and try again.');
  const direction = Math.random() < 0.5 ? 'LEFT' : 'RIGHT';
  const r = await db.one(
    `UPDATE dbo.FaceVerifications SET Status = 'EXPIRED' WHERE UserId = @u AND Status = 'ISSUED';
     INSERT dbo.FaceVerifications (UserId, TurnDirection, ExpiresAt) OUTPUT inserted.FaceVerificationId AS id
     VALUES (@u, @dir, DATEADD(SECOND, @ttl, SYSUTCDATETIME()));`,
    { u: req.user.id, dir: direction, ttl: env.faceChallengeSeconds });
  res.status(201).json({ challengeId: r.id, direction, expiresInSeconds: env.faceChallengeSeconds });
});

router.post('/face/verify', selfieFrames.fields([{ name: 'front', maxCount: 1 }, { name: 'turned', maxCount: 1 }]), async (req, res) => {
  const { challengeId } = z.object({ challengeId: z.coerce.number().int().positive() }).parse(req.body ?? {});
  const front = req.files?.front?.[0], turned = req.files?.turned?.[0];
  if (!front || !turned) throw badRequest('Capture your selfie with the camera');
  // Claim atomically: a challenge is submitted once, by its owner, before it expires (anti-replay).
  const claimed = await db.one(
    `UPDATE dbo.FaceVerifications SET Status = 'PROCESSING', ClientIp = @ip, UserAgent = @ua OUTPUT inserted.TurnDirection AS direction
      WHERE FaceVerificationId = @id AND UserId = @u AND Status = 'ISSUED' AND ExpiresAt > SYSUTCDATETIME()`,
    { id: challengeId, u: req.user.id, ip: (req.ip ?? '').slice(0, 45), ua: String(req.headers['user-agent'] ?? '').slice(0, 300) });
  if (!claimed) throw new HttpError(400, 'This capture has expired — please retake your selfie', { code: 'CHALLENGE_INVALID' });

  let result, selfiePath = null, photoAt = null;
  try {
    const user = await db.one('SELECT FaceDescriptor, ProfilePhotoUpdatedAt FROM dbo.Users WHERE UserId = @u AND IsActive = 1', { u: req.user.id });
    if (!user?.FaceDescriptor) throw profileMissing();
    photoAt = user.ProfilePhotoUpdatedAt;
    const f = await faceEngine.analyze(front.buffer), t = await faceEngine.analyze(turned.buffer);
    result = evaluateVerification({ profile: JSON.parse(user.FaceDescriptor), front: f, turned: t, direction: claimed.direction });
    // Kept for audit: the accepted selfie, and selfies that showed a different person.
    if (result.status === 'PASSED' || result.status === 'MISMATCH') selfiePath = await storeSecureJpeg('attendance-selfies', front.buffer);
  } catch (e) {
    await db.query(`UPDATE dbo.FaceVerifications SET Status = 'EXPIRED' WHERE FaceVerificationId = @id`, { id: challengeId });
    throw e;
  }
  await db.query(
    `UPDATE dbo.FaceVerifications SET Status = @status, MatchDistance = @dist, SelfiePath = @selfie, ProfilePhotoAt = @photoAt,
            VerifiedAt = SYSUTCDATETIME() WHERE FaceVerificationId = @id`,
    { id: challengeId, status: result.status, dist: result.distance == null ? null : Math.round(result.distance * 1e4) / 1e4,
      selfie: selfiePath, photoAt });
  logger.info({ userId: req.user.id, verificationId: challengeId, status: result.status }, 'face verification');
  res.json({ verificationId: challengeId, status: result.status, verified: result.status === 'PASSED', message: result.message });
});

/* POST /attendance/start-day { verificationId, travelMode, odoStart?, lat?, lng? } */
router.post('/start-day', async (req, res) => {
  const b = z.object({
    verificationId: z.coerce.number({ error: 'Verify your face before starting the day' }).int().positive('Verify your face before starting the day'),
    travelMode: z.enum(TRAVEL), odoStart: optNum, lat: optNum, lng: optNum,
  }).parse(req.body ?? {});
  if (b.travelMode === 'OWN_VEHICLE' && !(b.odoStart >= 0)) throw badRequest('Enter the starting odometer reading');
  const now = new Date(), today = localDate(now);
  await db.transaction(async tx => {
    const exists = await db.one('SELECT 1 AS x FROM dbo.AttendanceDays WHERE UserId = @u AND WorkDate = @d', { u: req.user.id, d: today }, tx);
    if (exists) throw conflict('Your day has already been started');
    // Single use, owned by the caller, recent, and made against the employee's current profile photo.
    const fv = await db.one(
      `UPDATE fv SET Status = 'CONSUMED', ConsumedAt = @now OUTPUT inserted.SelfiePath
         FROM dbo.FaceVerifications fv JOIN dbo.Users u ON u.UserId = fv.UserId AND u.ProfilePhotoUpdatedAt = fv.ProfilePhotoAt
        WHERE fv.FaceVerificationId = @v AND fv.UserId = @u AND fv.Status = 'PASSED' AND fv.VerifiedAt >= DATEADD(SECOND, -@valid, @now)`,
      { v: b.verificationId, u: req.user.id, now, valid: env.faceVerificationValidSeconds }, tx);
    if (!fv) throw new HttpError(400, 'Face verification is missing or has expired — capture your selfie again', { code: 'FACE_NOT_VERIFIED' });
    await db.query(
      `INSERT dbo.AttendanceDays (UserId, WorkDate, SelfiePath, FaceVerificationId, TravelMode, OdoStart, StartLat, StartLng, IsLate, DayStartedAt)
       VALUES (@u, @d, @selfie, @fv, @mode, @odo, @lat, @lng, @late, @now);
       IF NOT EXISTS (SELECT 1 FROM dbo.AttendanceSessions WHERE UserId = @u AND CheckOutAt IS NULL)
         INSERT dbo.AttendanceSessions (UserId, CheckInAt) VALUES (@u, @now);`,
      { u: req.user.id, d: today, selfie: fv.SelfiePath, fv: b.verificationId, mode: b.travelMode,
        odo: b.travelMode === 'OWN_VEHICLE' ? Math.round(b.odoStart) : null, lat: b.lat ?? null, lng: b.lng ?? null,
        late: isLate(now), now }, tx);
    if (b.lat != null && b.lng != null)
      await db.query(`INSERT dbo.GpsPoints (UserId, CapturedAt, Latitude, Longitude, Label) VALUES (@u, @now, @lat, @lng, N'Day started')`,
        { u: req.user.id, now, lat: b.lat, lng: b.lng }, tx);
  });
  res.status(201).json(await todayState(req.user.id));
});

router.post('/check-in', async (req, res) => {
  const open = await db.one('SELECT SessionId FROM dbo.AttendanceSessions WHERE UserId = @u AND CheckOutAt IS NULL', { u: req.user.id });
  if (open) throw conflict('You are already checked in');
  await db.query('INSERT dbo.AttendanceSessions (UserId, CheckInAt) VALUES (@u, SYSUTCDATETIME())', { u: req.user.id });
  res.status(201).json(await todayState(req.user.id));
});

router.post('/check-out', async (req, res) => {
  const r = await db.query(
    `UPDATE dbo.AttendanceSessions SET CheckOutAt = SYSUTCDATETIME() OUTPUT inserted.SessionId
      WHERE UserId = @u AND CheckOutAt IS NULL`, { u: req.user.id });
  if (!r.length) throw conflict('You are not checked in');
  res.json(await todayState(req.user.id));
});

async function daySummary(userId, date) {
  const { start, end } = utcRange(date);
  const [[visits], [sales], points] = await db.queryMulti(
    `SELECT COUNT(*) AS n FROM dbo.OutletVisits WHERE UserId = @u AND VisitDate = @d;
     SELECT ISNULL(SUM(TotalAmount),0) AS amt, COUNT(*) AS n FROM dbo.Orders WHERE UserId = @u AND OrderedAt >= @start AND OrderedAt < @end;
     SELECT Latitude AS lat, Longitude AS lng FROM dbo.GpsPoints WHERE UserId = @u AND CapturedAt >= @start AND CapturedAt < @end ORDER BY CapturedAt;`,
    { u: userId, d: date, start, end });
  return { visits: visits.n, sales: Number(sales.amt), orders: sales.n,
           gpsKm: Math.round((pathMeters(points.map(p => ({ lat: +p.lat, lng: +p.lng }))) / 1000) * 10) / 10 };
}

router.get('/day-summary', async (req, res) => res.json(await daySummary(req.user.id, localDate())));

/* POST /attendance/end-day { odoEnd? } — closes the open session and the day */
router.post('/end-day', async (req, res) => {
  const { odoEnd } = z.object({ odoEnd: optNum }).parse(req.body ?? {});
  const today = localDate();
  const day = await db.one('SELECT * FROM dbo.AttendanceDays WHERE UserId = @u AND WorkDate = @d', { u: req.user.id, d: today });
  if (!day) throw badRequest('Start your day before checking out');
  if (day.TravelMode === 'OWN_VEHICLE') {
    if (!(odoEnd >= 0)) throw badRequest('Enter the ending odometer reading');
    if (odoEnd < day.OdoStart) throw badRequest(`Ending odometer must be at least ${day.OdoStart}`);
  }
  await db.transaction(async tx => {
    await db.query(
      `UPDATE dbo.AttendanceSessions SET CheckOutAt = SYSUTCDATETIME() WHERE UserId = @u AND CheckOutAt IS NULL;
       UPDATE dbo.AttendanceDays SET DayEndedAt = SYSUTCDATETIME(), OdoEnd = @odo WHERE UserId = @u AND WorkDate = @d;`,
      { u: req.user.id, d: today, odo: day.TravelMode === 'OWN_VEHICLE' ? Math.round(odoEnd) : null }, tx);
  });
  const summary = await daySummary(req.user.id, today);
  res.json({ ...summary, odoKm: day.TravelMode === 'OWN_VEHICLE' ? Math.round(odoEnd) - day.OdoStart : null });
});

/* GET /attendance/calendar?year&month&userId */
router.get('/calendar', async (req, res) => {
  const userId = await targetUserId(req);
  const now = localYearMonth();
  const year = Number(req.query.year) || now.year, month = Number(req.query.month) || now.month;
  const { from, to } = monthRange(year, month);
  const [days, leaves, regs] = await db.queryMulti(
    `SELECT WorkDate, IsLate, DayStartedAt, DayEndedAt FROM dbo.AttendanceDays WHERE UserId = @u AND WorkDate BETWEEN @from AND @to;
     SELECT LeaveRequestId, RequestKind, LeaveType, FromDate, ToDate, Reason, Status, ManagerRemark, CreatedAt
       FROM dbo.LeaveRequests WHERE UserId = @u ORDER BY CreatedAt DESC;
     SELECT RegularizationId, WorkDate, Reason, Status, ManagerRemark, CreatedAt FROM dbo.Regularizations WHERE UserId = @u ORDER BY CreatedAt DESC;`,
    { u: userId, from, to });

  const byDate = new Map(days.map(d => [toIso(d.WorkDate), d]));
  const today = localDate();
  const cal = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const iso = isoDate(year, month, d), att = byDate.get(iso);
    const onLeave = leaves.some(l => l.Status === 'APPROVED' && l.RequestKind === 'LEAVE' && toIso(l.FromDate) <= iso && toIso(l.ToDate) >= iso);
    const sunday = weekday(year, month, d) === 0;
    const status = att ? (att.IsLate ? 'late' : 'present') : onLeave ? 'leave' : sunday ? 'off' : iso < today ? 'absent' : null;
    cal.push({ day: d, date: iso, status, checkIn: att?.DayStartedAt ?? null, checkOut: att?.DayEndedAt ?? null });
  }
  const count = s => cal.filter(c => c.status === s).length;
  const lc = s => leaves.filter(l => l.Status === s).length;
  res.json({
    year, month, days: cal,
    summary: { present: count('present') + count('late'), late: count('late'), leave: count('leave'), absent: count('absent') },
    leaveStatus: { approved: lc('APPROVED'), pending: lc('PENDING'), rejected: lc('REJECTED') },
    leaves: leaves.map(l => ({ id: l.LeaveRequestId, kind: l.RequestKind, leaveType: l.LeaveType, fromDate: toIso(l.FromDate),
      toDate: toIso(l.ToDate), reason: l.Reason, status: l.Status, managerRemark: l.ManagerRemark, createdAt: l.CreatedAt })),
    regularizations: regs.map(r => ({ id: r.RegularizationId, date: toIso(r.WorkDate), reason: r.Reason, status: r.Status,
      managerRemark: r.ManagerRemark, createdAt: r.CreatedAt })),
  });
});

/* POST /attendance/regularizations { date, reason } */
router.post('/regularizations', async (req, res) => {
  const b = z.object({ date: z.iso.date(), reason: z.string().trim().min(3, 'Enter a reason').max(400) }).parse(req.body);
  if (b.date > localDate()) throw badRequest('Regularization is only for past dates');
  const r = await db.one(
    `INSERT dbo.Regularizations (UserId, WorkDate, Reason) OUTPUT inserted.RegularizationId AS id VALUES (@u, @d, @r)`,
    { u: req.user.id, d: b.date, r: b.reason });
  await notify(await managerOf(req.user.id), { icon: '🕘', title: 'Regularization request', body: `${req.user.name} · ${b.date}`, tone: 'amber', link: '/manager/approvals' });
  res.status(201).json(r);
});

/* POST /attendance/leaves { kind, leaveType, fromDate, toDate, hours?, reason } — present & future dates only */
router.post('/leaves', async (req, res) => {
  const b = z.object({
    kind: z.enum(['LEAVE', 'PERMISSION']),
    leaveType: z.string().trim().min(2).max(40),
    fromDate: z.iso.date(), toDate: z.iso.date(),
    hours: optNum, reason: z.string().trim().min(3, 'Enter a reason').max(400),
  }).parse(req.body);
  if (b.fromDate < localDate()) throw badRequest('Requests can only be for today or future dates');
  if (b.toDate < b.fromDate) throw badRequest('"To" date must be on or after "From" date');
  if (b.kind === 'PERMISSION' && (b.fromDate !== b.toDate || !(b.hours > 0 && b.hours <= 4)))
    throw badRequest('Permission is for a single day, up to 4 hours');
  const overlap = await db.one(
    `SELECT TOP 1 1 AS x FROM dbo.LeaveRequests WHERE UserId = @u AND Status <> 'REJECTED' AND RequestKind = 'LEAVE' AND @kind = 'LEAVE'
       AND FromDate <= @to AND ToDate >= @from`, { u: req.user.id, from: b.fromDate, to: b.toDate, kind: b.kind });
  if (overlap) throw conflict('You already have a leave request for these dates');
  const r = await db.one(
    `INSERT dbo.LeaveRequests (UserId, RequestKind, LeaveType, FromDate, ToDate, Hours, Reason)
     OUTPUT inserted.LeaveRequestId AS id VALUES (@u, @kind, @type, @from, @to, @hours, @reason)`,
    { u: req.user.id, kind: b.kind, type: b.leaveType, from: b.fromDate, to: b.toDate, hours: b.hours ?? null, reason: b.reason });
  await notify(await managerOf(req.user.id), { icon: '📝', title: `${b.kind === 'LEAVE' ? 'Leave' : 'Permission'} request`,
    body: `${req.user.name} · ${b.leaveType} · ${b.fromDate}${b.toDate !== b.fromDate ? ' – ' + b.toDate : ''}`, tone: 'amber', link: '/manager/approvals' });
  res.status(201).json(r);
});
