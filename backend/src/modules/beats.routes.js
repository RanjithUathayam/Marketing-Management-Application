import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize, MANAGERS, scopeUserIds, targetUserId, assertUserInScope, scopeFilter, isManager } from '../middleware/auth.js';
import { beatInsights, assignedBeatIds, insightStrip } from '../services/beats.js';
import { actionRequest } from '../services/approvals.js';
import { notify, managerOf } from '../services/notify.js';
import { badRequest, notFound, forbidden, conflict } from '../utils/http.js';
import { localDate, localYearMonth, daysInMonth, weekday, toIso } from '../utils/dates.js';

export const router = Router();

/* ── Beats ─────────────────────────────────────────────────────────────
   GET /beats            → caller's assigned beats with insights (exec) or ?userId=<member>
   GET /beats?scope=team → every beat assigned to the manager's team, team-wide visits
   GET /beats?scope=all  → every active beat (beat-change search), caller's visits          */
router.get('/beats', async (req, res) => {
  const scope = req.query.scope;
  if (scope === 'team') {
    if (!isManager(req.user)) throw forbidden();
    const team = await scopeUserIds(req.user);
    return res.json(await beatInsights({ beatIds: await assignedBeatIds(team), visitUserIds: team }));
  }
  const userId = await targetUserId(req);
  const beatIds = scope === 'all' ? await assignedBeatIds(null) : await assignedBeatIds([userId]);
  res.json(await beatInsights({ beatIds, visitUserIds: [userId], planUserId: userId }));
});

/* POST /beats/:id/visits { visited, ordered } — manual "Log beat visit" */
router.post('/beats/:id/visits', async (req, res) => {
  const beatId = Number(req.params.id);
  const b = z.object({ visited: z.coerce.number().int().min(1), ordered: z.coerce.number().int().min(0) })
    .refine(x => x.ordered <= x.visited, 'Ordered dealers cannot exceed dealers visited').parse(req.body);
  const assigned = await db.one('SELECT 1 AS x FROM dbo.BeatAssignments WHERE BeatId = @b AND UserId = @u', { b: beatId, u: req.user.id });
  if (!assigned) throw forbidden('This beat is not assigned to you');
  await db.exec('dbo.usp_LogBeatVisit', { UserId: req.user.id, BeatId: beatId, VisitDate: localDate(), Visited: b.visited, Ordered: b.ordered });
  const [beat] = await beatInsights({ beatIds: [beatId], visitUserIds: [req.user.id], planUserId: req.user.id });
  res.status(201).json(beat);
});

/* ── Journey plans ─────────────────────────────────────────────────── */
async function loadPlan(planId) {
  const [[plan], days] = await db.queryMulti(
    `SELECT p.*, u.FullName, u.EmpCode, a.FullName AS ActionedByName FROM dbo.JourneyPlans p
       JOIN dbo.Users u ON u.UserId = p.UserId LEFT JOIN dbo.Users a ON a.UserId = p.ActionedBy WHERE p.PlanId = @id;
     SELECT d.PlanDay AS day, d.BeatId AS beatId, s.OutletCount AS outlets FROM dbo.JourneyPlanDays d
       JOIN dbo.vw_BeatSummary s ON s.BeatId = d.BeatId WHERE d.PlanId = @id ORDER BY d.PlanDay;`, { id: planId });
  if (!plan) throw notFound('Plan');
  return {
    id: plan.PlanId, userId: plan.UserId, userName: plan.FullName, empCode: plan.EmpCode,
    year: plan.PlanYear, month: plan.PlanMonth, status: plan.Status, managerNote: plan.ManagerNote,
    submittedAt: plan.SubmittedAt, actionedAt: plan.ActionedAt, actionedBy: plan.ActionedByName, createdAt: plan.CreatedAt,
    days: days.map(d => ({ day: d.day, beatId: d.beatId })),
    stats: { days: days.length, beats: new Set(days.map(d => d.beatId)).size, outlets: days.reduce((s, d) => s + d.outlets, 0) },
  };
}
async function planInScope(user, planId, { write = false } = {}) {
  const p = await db.one('SELECT UserId, Status FROM dbo.JourneyPlans WHERE PlanId = @id', { id: planId });
  if (!p) throw notFound('Plan');
  if (write && p.UserId !== user.id) throw forbidden('You can only edit your own plan');
  await assertUserInScope(user, p.UserId);
  return p;
}

/* GET /plans?year&month&userId — the caller's plan is created on first access */
router.get('/plans', async (req, res) => {
  const userId = await targetUserId(req);
  const now = localYearMonth();
  const year = Number(req.query.year) || now.year, month = Number(req.query.month) || now.month;
  let p = await db.one('SELECT PlanId FROM dbo.JourneyPlans WHERE UserId = @u AND PlanYear = @y AND PlanMonth = @m', { u: userId, y: year, m: month });
  if (!p) {
    if (userId !== req.user.id) return res.json(null);
    p = await db.one(
      `INSERT dbo.JourneyPlans (UserId, PlanYear, PlanMonth) OUTPUT inserted.PlanId VALUES (@u, @y, @m)`, { u: userId, y: year, m: month });
  }
  res.json(await loadPlan(p.PlanId));
});

router.get('/plans/pending', authorize(...MANAGERS), async (req, res) => {
  const params = { me: req.user.id };
  const where = await scopeFilter(req.user, 'p.UserId', params);
  const rows = await db.query(`SELECT p.PlanId FROM dbo.JourneyPlans p WHERE p.Status = 'PENDING' AND p.UserId <> @me AND ${where} ORDER BY p.SubmittedAt`, params);
  const plans = await Promise.all(rows.map(async r => {
    const plan = await loadPlan(r.PlanId);
    const beats = await beatInsights({ beatIds: [...new Set(plan.days.map(d => d.beatId))], visitUserIds: [plan.userId], planUserId: plan.userId });
    return { ...plan, beats, insights: insightStrip(beats) };
  }));
  res.json(plans);
});

router.get('/plans/:id', async (req, res) => {
  await planInScope(req.user, Number(req.params.id));
  const plan = await loadPlan(Number(req.params.id));
  const beats = await beatInsights({ beatIds: [...new Set(plan.days.map(d => d.beatId))], visitUserIds: [plan.userId], planUserId: plan.userId });
  res.json({ ...plan, beats, insights: insightStrip(beats) });
});

/* PUT /plans/:id/days { days: [{day, beatId}] } — one beat per working day, Sundays are week-off */
router.put('/plans/:id/days', async (req, res) => {
  const id = Number(req.params.id);
  const p = await planInScope(req.user, id, { write: true });
  if (p.Status === 'PENDING') throw conflict('The plan is locked until your manager reviews it');
  const { days } = z.object({ days: z.array(z.object({ day: z.number().int().min(1).max(31), beatId: z.number().int().positive() })).max(31) }).parse(req.body);
  const plan = await db.one('SELECT PlanYear, PlanMonth FROM dbo.JourneyPlans WHERE PlanId = @id', { id });
  const dim = daysInMonth(plan.PlanYear, plan.PlanMonth);
  // Assigned beats, plus beats already on the plan (an approved beat change may point a day at an unassigned beat).
  const existing = await db.query('SELECT DISTINCT BeatId FROM dbo.JourneyPlanDays WHERE PlanId = @id', { id });
  const allowed = new Set([...(await assignedBeatIds([req.user.id])), ...existing.map(r => r.BeatId)]);
  const seen = new Set();
  for (const d of days) {
    if (d.day > dim) throw badRequest(`Day ${d.day} is not in this month`);
    if (weekday(plan.PlanYear, plan.PlanMonth, d.day) === 0) throw badRequest(`Day ${d.day} is a Sunday (week-off)`);
    if (!allowed.has(d.beatId)) throw badRequest('You can only plan beats assigned to you');
    if (seen.has(d.day)) throw badRequest(`Day ${d.day} has more than one beat`);
    seen.add(d.day);
  }
  await db.exec('dbo.usp_SaveJourneyPlanDays', { PlanId: id, DaysJson: JSON.stringify(days) });
  res.json(await loadPlan(id));
});

router.post('/plans/:id/submit', async (req, res) => {
  const id = Number(req.params.id);
  const p = await planInScope(req.user, id, { write: true });
  if (!['DRAFT', 'SENTBACK'].includes(p.Status)) throw conflict(`Plan is already ${p.Status.toLowerCase()}`);
  const plan = await loadPlan(id);
  if (!plan.stats.days) throw badRequest('Add at least one beat day');
  await db.query(`UPDATE dbo.JourneyPlans SET Status = 'PENDING', SubmittedAt = SYSUTCDATETIME() WHERE PlanId = @id`, { id });
  await notify(await managerOf(req.user.id), { icon: '🧭', title: 'Journey plan submitted',
    body: `${req.user.name} · ${plan.stats.days} days · ${plan.stats.beats} beats`, tone: 'amber', link: `/manager/plans/${id}` });
  res.json(await loadPlan(id));
});

async function actionPlan(req, approve) {
  const id = Number(req.params.id);
  const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  if (!approve && !note) throw badRequest('Remarks are required to send a plan back');
  const p = await planInScope(req.user, id);
  if (p.UserId === req.user.id) throw forbidden('You cannot approve your own plan');
  if (p.Status !== 'PENDING') throw conflict('Only pending plans can be reviewed');
  await db.query(
    `UPDATE dbo.JourneyPlans SET Status = @s, ManagerNote = @n, ActionedBy = @by, ActionedAt = SYSUTCDATETIME() WHERE PlanId = @id`,
    { s: approve ? 'APPROVED' : 'SENTBACK', n: note || null, by: req.user.id, id });
  await notify(p.UserId, { icon: approve ? '✅' : '↩', title: approve ? 'Journey plan approved' : 'Journey plan sent back',
    body: approve ? `Approved by ${req.user.name}` : `${req.user.name}: "${note}"`, tone: approve ? 'green' : 'red', link: '/route' });
  return loadPlan(id);
}
router.post('/plans/:id/approve', authorize(...MANAGERS), async (req, res) => res.json(await actionPlan(req, true)));
router.post('/plans/:id/send-back', authorize(...MANAGERS), async (req, res) => res.json(await actionPlan(req, false)));

/* ── Beat change requests ──────────────────────────────────────────── */
const bcDto = r => ({
  id: r.RequestId, userId: r.UserId, userName: r.FullName, fromBeatId: r.FromBeatId, fromBeat: r.FromName,
  toBeatId: r.ToBeatId, toBeat: r.ToName, forDate: toIso(r.ForDate), remarks: r.Remarks, status: r.Status,
  managerRemark: r.ManagerRemark, createdAt: r.CreatedAt,
});
const BC_SQL = `SELECT r.*, u.FullName, f.BeatName AS FromName, t.BeatName AS ToName FROM dbo.BeatChangeRequests r
                JOIN dbo.Users u ON u.UserId = r.UserId JOIN dbo.Beats f ON f.BeatId = r.FromBeatId JOIN dbo.Beats t ON t.BeatId = r.ToBeatId`;

router.post('/beat-changes', async (req, res) => {
  const b = z.object({
    fromBeatId: z.number().int().positive(), toBeatId: z.number().int().positive(),
    forDate: z.iso.date().optional(), remarks: z.string().trim().min(3, 'Remarks are required').max(400),
  }).refine(x => x.fromBeatId !== x.toBeatId, 'Choose a different beat').parse(req.body);
  const forDate = b.forDate ?? localDate();
  if (forDate < localDate()) throw badRequest('Beat change must be for today or a future date');
  const exists = await db.query('SELECT BeatId FROM dbo.Beats WHERE IsActive = 1 AND BeatId IN (@a, @b)', { a: b.fromBeatId, b: b.toBeatId });
  if (exists.length !== 2) throw badRequest('Unknown beat');
  const r = await db.one(
    `INSERT dbo.BeatChangeRequests (UserId, FromBeatId, ToBeatId, ForDate, Remarks) OUTPUT inserted.RequestId AS id
     VALUES (@u, @f, @t, @d, @r)`, { u: req.user.id, f: b.fromBeatId, t: b.toBeatId, d: forDate, r: b.remarks });
  await notify(await managerOf(req.user.id), { icon: '⇄', title: 'Beat change request', body: `${req.user.name}: "${b.remarks}"`, tone: 'blue', link: '/manager/approvals' });
  res.status(201).json(r);
});

/* GET /beat-changes?status=PENDING — own requests (exec) or team requests (manager) with beat insights */
router.get('/beat-changes', async (req, res) => {
  const params = { status: req.query.status || null };
  const where = isManager(req.user) ? await scopeFilter(req.user, 'r.UserId', params) : 'r.UserId = @me';
  params.me = req.user.id;
  const rows = await db.query(`${BC_SQL} WHERE ${where} AND (@status IS NULL OR r.Status = @status) ORDER BY r.CreatedAt DESC`, params);
  const list = rows.map(bcDto);
  if (req.query.withInsights === 'true') {
    for (const r of list) {
      const beats = await beatInsights({ beatIds: [r.fromBeatId, r.toBeatId], visitUserIds: [r.userId], planUserId: r.userId });
      r.from = beats.find(b => b.id === r.fromBeatId);
      r.to = beats.find(b => b.id === r.toBeatId);
      r.insights = insightStrip(beats);
    }
  }
  res.json(list);
});

/* Approving moves the plan day (if any) for that date to the new beat. */
async function actionBeatChange(req, approve) {
  const id = Number(req.params.id);
  const { remark } = z.object({ remark: z.string().trim().max(300).optional() }).parse(req.body ?? {});
  await db.transaction(async tx => {
    const row = await actionRequest('beatChange', id, req.user, { approve, remark }, tx);
    if (approve) {
      const d = toIso(row.ForDate);
      await db.query(
        `UPDATE d SET BeatId = @to FROM dbo.JourneyPlanDays d JOIN dbo.JourneyPlans p ON p.PlanId = d.PlanId
          WHERE p.UserId = @u AND p.PlanYear = @y AND p.PlanMonth = @m AND d.PlanDay = @day`,
        { to: row.ToBeatId, u: row.UserId, y: +d.slice(0, 4), m: +d.slice(5, 7), day: +d.slice(8, 10) }, tx);
    }
  });
  return (await db.query(`${BC_SQL} WHERE r.RequestId = @id`, { id })).map(bcDto)[0];
}
router.post('/beat-changes/:id/approve', authorize(...MANAGERS), async (req, res) => res.json(await actionBeatChange(req, true)));
router.post('/beat-changes/:id/reject', authorize(...MANAGERS), async (req, res) => res.json(await actionBeatChange(req, false)));
