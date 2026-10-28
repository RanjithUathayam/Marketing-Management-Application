/* Work logs (distributor / office / meeting / joined work), market surveys, expenses. */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize, MANAGERS, targetUserId, scopeFilter, isManager } from '../middleware/auth.js';
import { uploader, publicPath, removeUploaded } from '../middleware/upload.js';
import { actionRequest } from '../services/approvals.js';
import { notify, managerOf } from '../services/notify.js';
import { assertOutletVisible } from './outlets.routes.js';
import { badRequest, notFound, conflict } from '../utils/http.js';
import { localDate, localYearMonth, utcRange, monthRange, toIso } from '../utils/dates.js';

export const router = Router();

/* ── Work logs ─────────────────────────────────────────────────────── */
const wlDto = w => ({ id: w.WorkLogId, type: w.WorkType, place: w.PlaceName, joinedUserId: w.JoinedUserId, joinedUser: w.JoinedName,
  notes: w.Notes, checkInAt: w.CheckInAt, checkOutAt: w.CheckOutAt,
  minutes: w.CheckOutAt ? Math.round((new Date(w.CheckOutAt) - new Date(w.CheckInAt)) / 60000) : null });
const WL_SQL = `SELECT w.*, j.FullName AS JoinedName FROM dbo.WorkLogs w LEFT JOIN dbo.Users j ON j.UserId = w.JoinedUserId`;

router.get('/work-logs/today', async (req, res) => {
  const { start, end } = utcRange(localDate());
  res.json((await db.query(`${WL_SQL} WHERE w.UserId = @u AND w.CheckInAt >= @start AND w.CheckInAt < @end ORDER BY w.CheckInAt DESC`,
    { u: req.user.id, start, end })).map(wlDto));
});

/* Colleagues the caller can accompany for joined work (same manager, or reports for a manager). */
router.get('/work-logs/colleagues', async (req, res) => {
  const rows = await db.query(
    `SELECT u.UserId, u.FullName, u.EmpCode, u.Territory,
            (SELECT COUNT(*) FROM dbo.BeatAssignments ba JOIN dbo.Outlets o ON o.BeatId = ba.BeatId AND o.ApprovalStatus = 'APPROVED'
              WHERE ba.UserId = u.UserId) AS Outlets
       FROM dbo.Users u
      WHERE u.IsActive = 1 AND u.RoleCode = 'EXEC' AND u.UserId <> @me
        AND (u.ManagerId = (SELECT ManagerId FROM dbo.Users WHERE UserId = @me) OR u.ManagerId = @me)
      ORDER BY u.FullName`, { me: req.user.id });
  res.json(rows.map(r => ({ id: r.UserId, name: r.FullName, empCode: r.EmpCode, territory: r.Territory, outlets: r.Outlets })));
});

/* POST /work-logs { type, place?, joinedUserId?, notes?, lat?, lng? } — meetings are logged closed */
router.post('/work-logs', async (req, res) => {
  const b = z.object({
    type: z.enum(['DISTRIBUTOR', 'OFFICE', 'MEETING', 'JOINED']), place: z.string().trim().max(150).optional(),
    joinedUserId: z.number().int().positive().optional(), notes: z.string().trim().max(1000).optional(),
    lat: z.number().optional(), lng: z.number().optional(),
  }).parse(req.body);
  if (b.type === 'MEETING' && !b.place) throw badRequest('Enter who the meeting was with');
  if (b.type === 'JOINED' && !b.joinedUserId) throw badRequest('Select the executive to accompany');
  if (['DISTRIBUTOR', 'OFFICE'].includes(b.type)) {
    const open = await db.one(`SELECT 1 AS x FROM dbo.WorkLogs WHERE UserId = @u AND CheckOutAt IS NULL AND WorkType IN ('DISTRIBUTOR','OFFICE')`, { u: req.user.id });
    if (open) throw conflict('Check out of your current visit first');
  }
  const closeNow = b.type === 'MEETING';
  const r = await db.one(
    `INSERT dbo.WorkLogs (UserId, WorkType, PlaceName, JoinedUserId, Notes, Latitude, Longitude, CheckOutAt)
     OUTPUT inserted.WorkLogId VALUES (@u, @t, @p, @j, @n, @lat, @lng, CASE WHEN @close = 1 THEN SYSUTCDATETIME() END)`,
    { u: req.user.id, t: b.type, p: b.place || null, j: b.joinedUserId ?? null, n: b.notes || null, lat: b.lat ?? null, lng: b.lng ?? null, close: closeNow });
  res.status(201).json(wlDto(await db.one(`${WL_SQL} WHERE w.WorkLogId = @id`, { id: r.WorkLogId })));
});

router.post('/work-logs/:id/checkout', async (req, res) => {
  const r = await db.query(
    `UPDATE dbo.WorkLogs SET CheckOutAt = SYSUTCDATETIME() OUTPUT inserted.WorkLogId WHERE WorkLogId = @id AND UserId = @u AND CheckOutAt IS NULL`,
    { id: Number(req.params.id), u: req.user.id });
  if (!r.length) throw notFound('Open visit');
  res.json(wlDto(await db.one(`${WL_SQL} WHERE w.WorkLogId = @id`, { id: Number(req.params.id) })));
});

/* ── Market survey ─────────────────────────────────────────────────── */
router.get('/surveys/sections', async (_req, res) => {
  res.json((await db.query('SELECT SectionCode AS code, Title AS title, Hint AS hint FROM dbo.SurveySections ORDER BY SortOrder')));
});

router.post('/surveys', async (req, res) => {
  const b = z.object({ outletId: z.number().int().positive(), answers: z.record(z.string(), z.string().max(2000)) }).parse(req.body);
  const answers = Object.entries(b.answers).map(([code, text]) => ({ code, text: text.trim() })).filter(a => a.text);
  if (!answers.length) throw badRequest('Record at least one observation');
  await assertOutletVisible(req.user, b.outletId);
  const id = await db.transaction(async tx => {
    const s = await db.one('INSERT dbo.Surveys (OutletId, UserId) OUTPUT inserted.SurveyId VALUES (@o, @u)', { o: b.outletId, u: req.user.id }, tx);
    await db.query(
      `INSERT dbo.SurveyAnswers (SurveyId, SectionCode, Answer) SELECT @id, code, text FROM OPENJSON(@a) WITH (code VARCHAR(20), text NVARCHAR(2000))`,
      { id: s.SurveyId, a: JSON.stringify(answers) }, tx);
    return s.SurveyId;
  });
  res.status(201).json({ id });
});

router.get('/surveys', async (req, res) => {
  const params = { outletId: Number(req.query.outletId) || null };
  const scope = await scopeFilter(req.user, 's.UserId', params);
  const rows = await db.query(
    `SELECT TOP 100 s.SurveyId, s.CreatedAt, o.OutletName, u.FullName,
            (SELECT a.SectionCode AS code, a.Answer AS text FROM dbo.SurveyAnswers a WHERE a.SurveyId = s.SurveyId FOR JSON PATH) AS Answers
       FROM dbo.Surveys s JOIN dbo.Outlets o ON o.OutletId = s.OutletId JOIN dbo.Users u ON u.UserId = s.UserId
      WHERE ${scope} AND (@outletId IS NULL OR s.OutletId = @outletId) ORDER BY s.CreatedAt DESC`, params);
  res.json(rows.map(r => ({ id: r.SurveyId, createdAt: r.CreatedAt, outlet: r.OutletName, by: r.FullName, answers: JSON.parse(r.Answers || '[]') })));
});

/* ── Expenses ──────────────────────────────────────────────────────── */
const bill = uploader('bills');
const expDto = e => ({ id: e.ExpenseId, userId: e.UserId, userName: e.FullName, date: toIso(e.ExpenseDate), type: e.ExpenseType,
  amount: Number(e.Amount), limit: Number(e.LimitAmount), overLimit: Number(e.Amount) > Number(e.LimitAmount),
  billUrl: e.BillPath, notes: e.Notes, status: e.Status, managerRemark: e.ManagerRemark, createdAt: e.CreatedAt });
const EXP_SQL = 'SELECT e.*, u.FullName FROM dbo.Expenses e JOIN dbo.Users u ON u.UserId = e.UserId';

router.get('/expenses/types', async (_req, res) =>
  res.json((await db.query('SELECT ExpenseType AS type, DailyLimit AS limit FROM dbo.ExpenseTypes')).map(t => ({ type: t.type, limit: Number(t.limit) }))));

/* GET /expenses?year&month&userId  |  GET /expenses?status=PENDING (manager queue) */
router.get('/expenses', async (req, res) => {
  if (req.query.status === 'PENDING' && isManager(req.user)) {
    const params = { me: req.user.id };
    const scope = await scopeFilter(req.user, 'e.UserId', params);
    return res.json((await db.query(`${EXP_SQL} WHERE e.Status = 'PENDING' AND e.UserId <> @me AND ${scope} ORDER BY e.CreatedAt`, params)).map(expDto));
  }
  const userId = await targetUserId(req);
  const now = localYearMonth();
  const { from, to } = monthRange(Number(req.query.year) || now.year, Number(req.query.month) || now.month);
  const list = (await db.query(`${EXP_SQL} WHERE e.UserId = @u AND e.ExpenseDate BETWEEN @from AND @to ORDER BY e.ExpenseDate DESC, e.ExpenseId DESC`,
    { u: userId, from, to })).map(expDto);
  res.json({ items: list, total: list.reduce((s, e) => s + e.amount, 0),
    approved: list.filter(e => e.status === 'APPROVED').length, pending: list.filter(e => e.status === 'PENDING').length,
    rejected: list.filter(e => e.status === 'REJECTED').length });
});

/* POST /expenses multipart: date, type, amount, notes?, bill (file) */
router.post('/expenses', bill.single('bill'), async (req, res) => {
  try {
    const b = z.object({ date: z.iso.date(), type: z.enum(['FUEL', 'FOOD', 'STAY', 'MISC']),
      amount: z.coerce.number().positive('Enter an amount').max(100000), notes: z.string().trim().max(300).optional() }).parse(req.body);
    if (b.date > localDate()) throw badRequest('Expense date cannot be in the future');
    if (!req.file) throw badRequest('Attach the bill as proof');
    const t = await db.one('SELECT DailyLimit FROM dbo.ExpenseTypes WHERE ExpenseType = @t', { t: b.type });
    const r = await db.one(
      `INSERT dbo.Expenses (UserId, ExpenseDate, ExpenseType, Amount, LimitAmount, BillPath, Notes)
       OUTPUT inserted.ExpenseId VALUES (@u, @d, @t, @a, @l, @p, @n)`,
      { u: req.user.id, d: b.date, t: b.type, a: b.amount, l: t.DailyLimit, p: publicPath('bills', req.file), n: b.notes || null });
    const over = b.amount > Number(t.DailyLimit);
    await notify(await managerOf(req.user.id), { icon: '🧾', title: over ? 'Expense over limit' : 'Expense for approval',
      body: `${req.user.name} · ${b.type} ₹${b.amount}${over ? ` (limit ₹${t.DailyLimit})` : ''}`, tone: over ? 'red' : 'amber', link: '/manager/approvals' });
    res.status(201).json(expDto(await db.one(`${EXP_SQL} WHERE e.ExpenseId = @id`, { id: r.ExpenseId })));
  } catch (e) {
    removeUploaded(req.file ? [req.file] : []);
    throw e;
  }
});

const remarkBody = req => z.object({ remark: z.string().trim().max(300).optional() }).parse(req.body ?? {});
router.post('/expenses/:id/approve', authorize(...MANAGERS), async (req, res) => {
  await actionRequest('expense', Number(req.params.id), req.user, { approve: true, ...remarkBody(req) });
  res.json(expDto(await db.one(`${EXP_SQL} WHERE e.ExpenseId = @id`, { id: Number(req.params.id) })));
});
router.post('/expenses/:id/reject', authorize(...MANAGERS), async (req, res) => {
  await actionRequest('expense', Number(req.params.id), req.user, { approve: false, ...remarkBody(req) });
  res.json(expDto(await db.one(`${EXP_SQL} WHERE e.ExpenseId = @id`, { id: Number(req.params.id) })));
});

/* ── Leave / regularization approvals ──────────────────────────────── */
for (const kind of ['leave', 'regularization']) {
  const path = kind === 'leave' ? 'leaves' : 'regularizations';
  router.post(`/${path}/:id/approve`, authorize(...MANAGERS), async (req, res) => {
    await actionRequest(kind, Number(req.params.id), req.user, { approve: true, ...remarkBody(req) });
    res.json({ id: Number(req.params.id), status: 'APPROVED' });
  });
  router.post(`/${path}/:id/reject`, authorize(...MANAGERS), async (req, res) => {
    await actionRequest(kind, Number(req.params.id), req.user, { approve: false, ...remarkBody(req) });
    res.json({ id: Number(req.params.id), status: 'REJECTED' });
  });
}
