/* Targets, live tracking, dashboards, team, approvals summary and reports. */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { authorize, MANAGERS, targetUserId, scopeUserIds, scopeFilter, assertUserInScope, isManager } from '../middleware/auth.js';
import { targetSummary, teamAchievement, salesBetween, workingDaysUpTo } from '../services/targets.js';
import { beatInsights, assignedBeatIds } from '../services/beats.js';
import { badRequest, forbidden } from '../utils/http.js';
import { localDate, localYearMonth, utcRange, isoDate, addDays, toIso, monthRange } from '../utils/dates.js';
import { pathMeters, outletPerformance } from '../domain/rules.js';

export const router = Router();

/* ── Targets & incentives ──────────────────────────────────────────── */
router.get('/targets', async (req, res) => res.json(await targetSummary(await targetUserId(req))));

/* PUT /targets { userId, year, month, monthlyTarget, workingDays? } — manager / admin */
router.put('/targets', authorize(...MANAGERS), async (req, res) => {
  const b = z.object({ userId: z.number().int().positive(), year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12),
    monthlyTarget: z.number().positive().max(2_000_000_000), workingDays: z.number().int().min(1).max(31).default(26) }).parse(req.body);
  await assertUserInScope(req.user, b.userId);
  await db.query(
    `MERGE dbo.SalesTargets AS t USING (SELECT @u AS UserId, @y AS TargetYear, @m AS TargetMonth) s
       ON t.UserId = s.UserId AND t.TargetYear = s.TargetYear AND t.TargetMonth = s.TargetMonth
     WHEN MATCHED THEN UPDATE SET MonthlyTarget = @amt, WorkingDays = @wd
     WHEN NOT MATCHED THEN INSERT (UserId, TargetYear, TargetMonth, MonthlyTarget, WorkingDays) VALUES (@u, @y, @m, @amt, @wd);`,
    { u: b.userId, y: b.year, m: b.month, amt: b.monthlyTarget, wd: b.workingDays });
  res.json({ saved: true });
});

/* ── Live tracking ─────────────────────────────────────────────────── */
router.post('/tracking/points', async (req, res) => {
  const b = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), label: z.string().trim().max(120).optional() }).parse(req.body);
  await db.query('INSERT dbo.GpsPoints (UserId, Latitude, Longitude, Label) VALUES (@u, @lat, @lng, @label)',
    { u: req.user.id, lat: b.lat, lng: b.lng, label: b.label || null });
  res.status(201).json({ saved: true });
});

router.get('/tracking/today', async (req, res) => {
  const userId = await targetUserId(req);
  const today = localDate(), { start, end } = utcRange(today);
  const { year, month, day } = localYearMonth();
  const [points, [visits], sessions, [planned]] = await db.queryMulti(
    `SELECT CapturedAt AS at, Latitude AS lat, Longitude AS lng, Label AS label, IsDeviation AS deviation
       FROM dbo.GpsPoints WHERE UserId = @u AND CapturedAt >= @start AND CapturedAt < @end ORDER BY CapturedAt;
     SELECT COUNT(*) AS n FROM dbo.OutletVisits WHERE UserId = @u AND VisitDate = @today;
     SELECT CheckInAt, CheckOutAt FROM dbo.AttendanceSessions WHERE UserId = @u AND (CheckOutAt IS NULL OR CheckInAt >= @start);
     SELECT d.BeatId,
            (SELECT COUNT(*) FROM dbo.Outlets o WHERE o.BeatId = d.BeatId AND o.ApprovalStatus = 'APPROVED'
               AND NOT EXISTS (SELECT 1 FROM dbo.OutletVisits v WHERE v.OutletId = o.OutletId AND v.UserId = @u AND v.VisitDate = @today)) AS Pending
       FROM dbo.JourneyPlanDays d JOIN dbo.JourneyPlans p ON p.PlanId = d.PlanId
      WHERE p.UserId = @u AND p.PlanYear = @y AND p.PlanMonth = @m AND d.PlanDay = @d;`,
    { u: userId, start, end, today, y: year, m: month, d: day });
  const pts = points.map(p => ({ ...p, lat: Number(p.lat), lng: Number(p.lng), deviation: !!p.deviation }));
  const now = Date.now();
  const activeMs = sessions.reduce((s, x) => s + ((x.CheckOutAt ? new Date(x.CheckOutAt) : now) - Math.max(new Date(x.CheckInAt), start)), 0);
  res.json({
    points: pts, visits: visits.n, distanceKm: Math.round(pathMeters(pts) / 100) / 10,
    activeMinutes: Math.max(0, Math.round(activeMs / 60000)), gpsActive: sessions.some(s => !s.CheckOutAt),
    deviations: pts.filter(p => p.deviation).length, outletsPending: planned?.Pending ?? 0,
  });
});

router.get('/tracking/team', authorize(...MANAGERS), async (req, res) => {
  const ids = (await scopeUserIds(req.user)) ?? (await db.query("SELECT UserId FROM dbo.Users WHERE RoleCode = 'EXEC' AND IsActive = 1")).map(r => r.UserId);
  const { start } = utcRange(localDate());
  const rows = await db.query(
    `SELECT u.UserId, u.FullName, u.EmpCode, u.Territory, g.Latitude, g.Longitude, g.CapturedAt, g.Label,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.AttendanceSessions a WHERE a.UserId = u.UserId AND a.CheckOutAt IS NULL) THEN 1 ELSE 0 END AS Active
       FROM dbo.Users u
       OUTER APPLY (SELECT TOP 1 * FROM dbo.GpsPoints p WHERE p.UserId = u.UserId AND p.CapturedAt >= @start ORDER BY p.CapturedAt DESC) g
      WHERE u.RoleCode = 'EXEC' AND u.IsActive = 1 AND u.UserId IN (SELECT value FROM OPENJSON(@ids)) ORDER BY u.FullName`,
    { ids: JSON.stringify(ids), start });
  res.json(rows.map(r => ({
    id: r.UserId, name: r.FullName, empCode: r.EmpCode, territory: r.Territory,
    lat: r.Latitude != null ? Number(r.Latitude) : null, lng: r.Longitude != null ? Number(r.Longitude) : null,
    lastSeenAt: r.CapturedAt, lastLabel: r.Label, status: r.Active ? 'active' : 'idle',
    idleMinutes: r.CapturedAt ? Math.round((Date.now() - new Date(r.CapturedAt)) / 60000) : null,
  })));
});

/* ── Executive dashboard ───────────────────────────────────────────── */
router.get('/dashboard/exec', async (req, res) => {
  const u = req.user.id, today = localDate();
  const { start, end } = utcRange(today);
  const beatIds = await assignedBeatIds([u]);
  const beats = await beatInsights({ beatIds, visitUserIds: [u], planUserId: u });
  const todayBeat = beats.find(b => b.plannedToday) ?? beats[0] ?? null;
  const [[sales], [avg], [visited], outlets, recent, [pads], [unread]] = await db.queryMulti(
    `SELECT ISNULL(SUM(TotalAmount),0) AS amt FROM dbo.Orders WHERE UserId = @u AND OrderedAt >= @start AND OrderedAt < @end;
     SELECT ISNULL(SUM(TotalAmount),0) / 30.0 AS amt FROM dbo.Orders WHERE UserId = @u AND OrderedAt >= DATEADD(DAY, -30, @start) AND OrderedAt < @start;
     SELECT COUNT(*) AS n FROM dbo.OutletVisits v JOIN dbo.Outlets o ON o.OutletId = v.OutletId
      WHERE v.UserId = @u AND v.VisitDate = @today AND (@beat IS NULL OR o.BeatId = @beat);
     SELECT o.OutletId, o.OutletName, o.CreditLimit, b.Outstanding, b.LastOrderAt FROM dbo.Outlets o JOIN dbo.vw_OutletBalance b ON b.OutletId = o.OutletId
      WHERE o.ApprovalStatus = 'APPROVED' AND o.BeatId IN (SELECT value FROM OPENJSON(@beats));
     SELECT TOP 3 o.OrderId, o.OrderNo, o.OrderedAt, o.TotalAmount, o.CurrentStatus, ot.OutletName,
            (SELECT COUNT(DISTINCT ProductId) FROM dbo.OrderLines l WHERE l.OrderId = o.OrderId) AS Items
       FROM dbo.Orders o JOIN dbo.Outlets ot ON ot.OutletId = o.OutletId WHERE o.UserId = @u ORDER BY o.OrderedAt DESC;
     SELECT COUNT(*) AS pending, COUNT(DISTINCT dc.DcId) AS dcs FROM dbo.SamplePads sp JOIN dbo.DeliveryChallans dc ON dc.DcId = sp.DcId
      WHERE dc.UserId = @u AND sp.AckAt IS NULL;
     SELECT COUNT(*) AS n FROM dbo.Notifications WHERE UserId = @u AND IsRead = 0;`,
    { u, start, end, today, beat: todayBeat?.id ?? null, beats: JSON.stringify(beatIds) });
  const target = await targetSummary(u);
  const outstanding = outlets.reduce((s, o) => s + Number(o.Outstanding), 0);
  const high = outlets.filter(o => outletPerformance({ outstanding: Number(o.Outstanding), creditLimit: Number(o.CreditLimit), lastOrderAt: o.LastOrderAt }) === 'outstanding').length;
  const avgDaily = Number(avg.amt);
  res.json({
    todayBeat: todayBeat ? { id: todayBeat.id, code: todayBeat.code, name: todayBeat.name, area: todayBeat.area, outlets: todayBeat.outlets,
      visited: visited.n, pending: Math.max(0, todayBeat.outlets - visited.n), planned: todayBeat.plannedToday } : null,
    todaySales: Number(sales.amt), salesVsAvgPct: avgDaily ? Math.round(((Number(sales.amt) - avgDaily) / avgDaily) * 100) : null,
    outstanding, highOutstandingOutlets: high,
    target: { pct: target.achievedPct, achieved: target.achieved, monthly: target.monthlyTarget, balance: target.balance, daysLeft: target.daysLeft },
    recentOrders: recent.map(o => ({ id: o.OrderId, orderNo: o.OrderNo, orderedAt: o.OrderedAt, totalAmount: Number(o.TotalAmount), status: o.CurrentStatus, outletName: o.OutletName, items: o.Items })),
    samplePads: { pending: pads.pending, dcs: pads.dcs }, unreadNotifications: unread.n,
  });
});

/* ── Manager dashboard / team ──────────────────────────────────────── */
async function teamIds(user) {
  const ids = await scopeUserIds(user);
  if (ids) return ids.filter(id => id !== user.id);
  return (await db.query("SELECT UserId FROM dbo.Users WHERE RoleCode = 'EXEC' AND IsActive = 1")).map(r => r.UserId);
}

async function pendingCounts(user) {
  const params = { me: user.id };
  const scope = await scopeFilter(user, 'x.UserId', params);
  const team = await scopeUserIds(user);
  params.team = team ? JSON.stringify(team) : null;
  const [[r]] = await db.queryMulti(
    `SELECT
       (SELECT COUNT(*) FROM dbo.JourneyPlans x WHERE x.Status = 'PENDING' AND x.UserId <> @me AND ${scope}) AS plans,
       (SELECT COUNT(*) FROM dbo.BeatChangeRequests x WHERE x.Status = 'PENDING' AND x.UserId <> @me AND ${scope}) AS beatChanges,
       (SELECT COUNT(*) FROM dbo.Expenses x WHERE x.Status = 'PENDING' AND x.UserId <> @me AND ${scope}) AS expenses,
       (SELECT COUNT(*) FROM dbo.LeaveRequests x WHERE x.Status = 'PENDING' AND x.UserId <> @me AND ${scope}) AS leaves,
       (SELECT COUNT(*) FROM dbo.Regularizations x WHERE x.Status = 'PENDING' AND x.UserId <> @me AND ${scope}) AS regularizations,
       (SELECT COUNT(*) FROM dbo.Orders x WHERE x.CreditHold = 1 AND x.CurrentStatus = 'RECEIVED' AND ${scope}) AS creditOrders,
       (SELECT COUNT(*) FROM dbo.Outlets o WHERE o.ApprovalStatus = 'PENDING' AND (@team IS NULL OR o.CreatedBy IN (SELECT value FROM OPENJSON(@team)))) AS outlets`,
    params);
  return { ...r, total: Object.values(r).reduce((s, n) => s + n, 0) };
}
router.get('/approvals/summary', authorize(...MANAGERS), async (req, res) => res.json(await pendingCounts(req.user)));

/* Recently actioned requests (last 10) for the approvals inbox */
router.get('/approvals/recent', authorize(...MANAGERS), async (req, res) => {
  const rows = await db.query(
    `SELECT TOP 10 * FROM (
       SELECT 'plan' AS kind, p.PlanId AS id, u.FullName, CONCAT(N'Journey plan ', p.PlanMonth, '/', p.PlanYear) AS title, p.Status, p.ActionedAt
         FROM dbo.JourneyPlans p JOIN dbo.Users u ON u.UserId = p.UserId WHERE p.ActionedBy = @me
       UNION ALL SELECT 'beatChange', r.RequestId, u.FullName, N'Beat change', r.Status, r.ActionedAt
         FROM dbo.BeatChangeRequests r JOIN dbo.Users u ON u.UserId = r.UserId WHERE r.ActionedBy = @me
       UNION ALL SELECT 'expense', e.ExpenseId, u.FullName, CONCAT(N'Expense ₹', CAST(e.Amount AS INT)), e.Status, e.ActionedAt
         FROM dbo.Expenses e JOIN dbo.Users u ON u.UserId = e.UserId WHERE e.ActionedBy = @me
       UNION ALL SELECT 'leave', l.LeaveRequestId, u.FullName, l.LeaveType, l.Status, l.ActionedAt
         FROM dbo.LeaveRequests l JOIN dbo.Users u ON u.UserId = l.UserId WHERE l.ActionedBy = @me) x
     ORDER BY ActionedAt DESC`, { me: req.user.id });
  res.json(rows.map(r => ({ kind: r.kind, id: r.id, userName: r.FullName, title: r.title, status: r.Status, actionedAt: r.ActionedAt })));
});

/* GET /leaves?status=PENDING and /regularizations?status=PENDING — manager queues */
router.get('/leaves', authorize(...MANAGERS), async (req, res) => {
  const params = { me: req.user.id, status: req.query.status || 'PENDING' };
  const scope = await scopeFilter(req.user, 'x.UserId', params);
  const rows = await db.query(`SELECT x.*, u.FullName FROM dbo.LeaveRequests x JOIN dbo.Users u ON u.UserId = x.UserId
     WHERE x.Status = @status AND x.UserId <> @me AND ${scope} ORDER BY x.CreatedAt`, params);
  res.json(rows.map(r => ({ id: r.LeaveRequestId, userId: r.UserId, userName: r.FullName, kind: r.RequestKind, leaveType: r.LeaveType,
    fromDate: toIso(r.FromDate), toDate: toIso(r.ToDate), hours: r.Hours, reason: r.Reason, status: r.Status, createdAt: r.CreatedAt })));
});
router.get('/regularizations', authorize(...MANAGERS), async (req, res) => {
  const params = { me: req.user.id, status: req.query.status || 'PENDING' };
  const scope = await scopeFilter(req.user, 'x.UserId', params);
  const rows = await db.query(`SELECT x.*, u.FullName FROM dbo.Regularizations x JOIN dbo.Users u ON u.UserId = x.UserId
     WHERE x.Status = @status AND x.UserId <> @me AND ${scope} ORDER BY x.CreatedAt`, params);
  res.json(rows.map(r => ({ id: r.RegularizationId, userId: r.UserId, userName: r.FullName, date: toIso(r.WorkDate), reason: r.Reason, status: r.Status, createdAt: r.CreatedAt })));
});

router.get('/dashboard/manager', authorize(...MANAGERS), async (req, res) => {
  const ids = await teamIds(req.user);
  const { year, month, day } = localYearMonth();
  const today = localDate(), monthStart = isoDate(year, month, 1);
  const lastMonthStart = isoDate(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1, 1);
  const lastMonthSameDay = addDays(lastMonthStart, day - 1);
  const [team, salesMtd, salesLast, pending, beats, bcRows, padRows] = await Promise.all([
    teamAchievement(ids),
    salesBetween(ids, monthStart, today),
    salesBetween(ids, lastMonthStart, lastMonthSameDay < monthStart ? lastMonthSameDay : addDays(monthStart, -1)),
    pendingCounts(req.user),
    beatInsights({ beatIds: await assignedBeatIds(ids), visitUserIds: ids }),
    db.query(`SELECT UserId, COUNT(*) AS n FROM dbo.BeatChangeRequests WHERE CreatedAt >= @start AND UserId IN (SELECT value FROM OPENJSON(@ids)) GROUP BY UserId`,
      { start: utcRange(monthStart).start, ids: JSON.stringify(ids) }),
    samplePadTeam(ids),
  ]);
  const target = team.reduce((s, t) => s + t.target, 0);
  const bc = team.map(t => ({ userId: t.id, name: t.name, count: bcRows.find(r => r.UserId === t.id)?.n ?? 0 }));
  const avgBc = bc.length ? bc.reduce((s, x) => s + x.count, 0) / bc.length : 0;
  res.json({
    teamSalesMtd: salesMtd, salesTrendPct: salesLast ? Math.round(((salesMtd - salesLast) / salesLast) * 100) : null,
    teamTargetPct: target ? Math.round((salesMtd / target) * 100) : 0,
    activeNow: team.filter(t => t.status === 'active').length, teamSize: team.length,
    pendingApprovals: pending.total,
    beatChangeTrend: bc.map(x => ({ ...x, unusual: x.count >= 5 || (avgBc > 0 && x.count >= avgBc * 1.8 && x.count >= 3) })),
    team, beats, samplePads: padRows,
  });
});

export async function samplePadTeam(ids) {
  const rows = await db.query(
    `SELECT u.UserId, u.FullName, u.EmpCode, COUNT(sp.SamplePadId) AS Issued, SUM(CASE WHEN sp.AckAt IS NOT NULL THEN 1 ELSE 0 END) AS Acked
       FROM dbo.Users u LEFT JOIN dbo.DeliveryChallans dc ON dc.UserId = u.UserId LEFT JOIN dbo.SamplePads sp ON sp.DcId = dc.DcId
      WHERE u.UserId IN (SELECT value FROM OPENJSON(@ids)) AND u.RoleCode = 'EXEC'
      GROUP BY u.UserId, u.FullName, u.EmpCode ORDER BY u.FullName`, { ids: JSON.stringify(ids) });
  return rows.map(r => ({ userId: r.UserId, name: r.FullName, empCode: r.EmpCode, issued: r.Issued, acknowledged: r.Acked ?? 0, pending: r.Issued - (r.Acked ?? 0) }));
}

router.get('/team', authorize(...MANAGERS), async (req, res) => {
  const ids = await teamIds(req.user);
  const today = localDate();
  const [team, att] = await Promise.all([
    teamAchievement(ids),
    db.query(`SELECT UserId, IsLate FROM dbo.AttendanceDays WHERE WorkDate = @d AND UserId IN (SELECT value FROM OPENJSON(@ids))`,
      { d: today, ids: JSON.stringify(ids) }),
  ]);
  const onLeave = await db.query(
    `SELECT DISTINCT UserId FROM dbo.LeaveRequests WHERE Status = 'APPROVED' AND RequestKind = 'LEAVE' AND @d BETWEEN FromDate AND ToDate
       AND UserId IN (SELECT value FROM OPENJSON(@ids))`, { d: today, ids: JSON.stringify(ids) });
  res.json({
    members: team.map(t => ({ ...t, attendance: att.find(a => a.UserId === t.id) ? (att.find(a => a.UserId === t.id).IsLate ? 'late' : 'present')
      : onLeave.some(l => l.UserId === t.id) ? 'leave' : 'absent' })),
    attendanceToday: { present: att.length, late: att.filter(a => a.IsLate).length, leave: onLeave.length,
      absent: Math.max(0, ids.length - att.length - onLeave.length) },
  });
});

/* ── Reports ───────────────────────────────────────────────────────── */
async function reportUsers(req) {
  if (req.query.scope === 'team') {
    if (!isManager(req.user)) throw forbidden();
    return teamIds(req.user);
  }
  return [await targetUserId(req)];
}

/* GET /reports/sales-trend?days=6&scope=team|me&userId */
router.get('/reports/sales-trend', async (req, res) => {
  const ids = await reportUsers(req);
  const days = Math.min(31, Math.max(1, Number(req.query.days) || 6));
  const today = localDate();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    out.push({ date: d, amount: await salesBetween(ids, d, d) });
  }
  const prev = await salesBetween(ids, addDays(today, -2 * days + 1), addDays(today, -days));
  const cur = out.reduce((s, x) => s + x.amount, 0);
  res.json({ days: out, total: cur, changePct: prev ? Math.round(((cur - prev) / prev) * 100) : null });
});

/* GET /reports/beat-coverage?userId — % of a beat's outlets visited this month */
router.get('/reports/beat-coverage', async (req, res) => {
  const userId = await targetUserId(req);
  const { year, month } = localYearMonth();
  const { from, to } = monthRange(year, month);
  const rows = await db.query(
    `SELECT s.BeatId, s.BeatCode, s.BeatName, s.OutletCount,
            (SELECT COUNT(DISTINCT v.OutletId) FROM dbo.OutletVisits v JOIN dbo.Outlets o ON o.OutletId = v.OutletId
              WHERE o.BeatId = s.BeatId AND v.UserId = @u AND v.VisitDate BETWEEN @from AND @to) AS Visited
       FROM dbo.vw_BeatSummary s JOIN dbo.BeatAssignments ba ON ba.BeatId = s.BeatId AND ba.UserId = @u ORDER BY s.BeatName`,
    { u: userId, from, to });
  const beats = await beatInsights({ beatIds: rows.map(r => r.BeatId), visitUserIds: [userId] });
  res.json(rows.map(r => ({ beatId: r.BeatId, code: r.BeatCode, name: r.BeatName, outlets: r.OutletCount, visited: r.Visited,
    pct: r.OutletCount ? Math.round((r.Visited / r.OutletCount) * 100) : 0, indicator: beats.find(b => b.id === r.BeatId)?.indicator })));
});

/* GET /reports/team-summary — beat-change trend and attendance for the month */
router.get('/reports/team-summary', authorize(...MANAGERS), async (req, res) => {
  const ids = await teamIds(req.user);
  const { year, month, day } = localYearMonth();
  const { from } = monthRange(year, month);
  const today = localDate();
  const lastFrom = isoDate(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1, 1);
  const p = { ids: JSON.stringify(ids), from, today, lf: lastFrom, lt: addDays(lastFrom, day - 1),
              s1: utcRange(from).start, s0: utcRange(lastFrom).start, e0: utcRange(addDays(lastFrom, day - 1)).end };
  const [[bc], [att], byExec] = await db.queryMulti(
    `SELECT SUM(CASE WHEN CreatedAt >= @s1 THEN 1 ELSE 0 END) AS cur, SUM(CASE WHEN CreatedAt >= @s0 AND CreatedAt < @e0 THEN 1 ELSE 0 END) AS prev
       FROM dbo.BeatChangeRequests WHERE UserId IN (SELECT value FROM OPENJSON(@ids));
     SELECT COUNT(*) AS present, SUM(CAST(IsLate AS INT)) AS late FROM dbo.AttendanceDays
      WHERE WorkDate BETWEEN @from AND @today AND UserId IN (SELECT value FROM OPENJSON(@ids));
     SELECT u.FullName AS name, COUNT(r.RequestId) AS changes FROM dbo.Users u
       LEFT JOIN dbo.BeatChangeRequests r ON r.UserId = u.UserId AND r.CreatedAt >= @s1
      WHERE u.UserId IN (SELECT value FROM OPENJSON(@ids)) GROUP BY u.FullName ORDER BY changes DESC;`, p);
  const leave = await db.one(
    `SELECT COUNT(*) AS n FROM dbo.LeaveRequests WHERE Status = 'APPROVED' AND RequestKind = 'LEAVE'
       AND FromDate <= @today AND ToDate >= @from AND UserId IN (SELECT value FROM OPENJSON(@ids))`, p);
  const expected = workingDaysUpTo(year, month, day) * ids.length;
  res.json({
    beatChanges: { current: bc.cur ?? 0, previous: bc.prev ?? 0, changePct: bc.prev ? Math.round((((bc.cur ?? 0) - bc.prev) / bc.prev) * 100) : null, byExec },
    attendance: { presentPct: expected ? Math.round((att.present / expected) * 100) : 0, late: att.late ?? 0, leave: leave.n },
  });
});

/* GET /reports/export?type=orders|expenses|attendance|team&from&to — CSV (opens in Excel) */
const csvCell = v => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};
router.get('/reports/export', async (req, res) => {
  const type = z.enum(['orders', 'expenses', 'attendance', 'team']).parse(req.query.type);
  const today = localDate();
  const from = req.query.from || addDays(today, -30), to = req.query.to || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw badRequest('Invalid date range');
  const { start, end } = utcRange(from, to);
  const params = { start, end, from, to };
  const scope = await scopeFilter(req.user, 'x.UserId', params);
  let header, rows;
  if (type === 'orders') {
    header = ['Order No', 'Date', 'Executive', 'Emp Code', 'Outlet', 'Beat', 'Pieces', 'Sub Total', 'Tax', 'Total', 'Terms', 'Status', 'Invoice'];
    rows = (await db.query(`SELECT x.OrderNo, x.OrderedAt, u.FullName, u.EmpCode, o.OutletName, b.BeatName, x.TotalPieces, x.SubTotal, x.TaxAmount, x.TotalAmount, x.PaymentTerms, x.CurrentStatus, x.InvoiceNo
      FROM dbo.Orders x JOIN dbo.Users u ON u.UserId = x.UserId JOIN dbo.Outlets o ON o.OutletId = x.OutletId JOIN dbo.Beats b ON b.BeatId = o.BeatId
      WHERE ${scope} AND x.OrderedAt >= @start AND x.OrderedAt < @end ORDER BY x.OrderedAt`, params)).map(Object.values);
  } else if (type === 'expenses') {
    header = ['Date', 'Executive', 'Type', 'Amount', 'Limit', 'Status', 'Remark'];
    rows = (await db.query(`SELECT x.ExpenseDate, u.FullName, x.ExpenseType, x.Amount, x.LimitAmount, x.Status, x.ManagerRemark
      FROM dbo.Expenses x JOIN dbo.Users u ON u.UserId = x.UserId WHERE ${scope} AND x.ExpenseDate BETWEEN @from AND @to ORDER BY x.ExpenseDate`, params))
      .map(r => [toIso(r.ExpenseDate), r.FullName, r.ExpenseType, r.Amount, r.LimitAmount, r.Status, r.ManagerRemark]);
  } else if (type === 'attendance') {
    header = ['Date', 'Executive', 'Emp Code', 'Travel', 'Late', 'Day Start (UTC)', 'Day End (UTC)', 'Odo km'];
    rows = (await db.query(`SELECT x.WorkDate, u.FullName, u.EmpCode, x.TravelMode, x.IsLate, x.DayStartedAt, x.DayEndedAt, x.OdoEnd - x.OdoStart AS Km
      FROM dbo.AttendanceDays x JOIN dbo.Users u ON u.UserId = x.UserId WHERE ${scope} AND x.WorkDate BETWEEN @from AND @to ORDER BY x.WorkDate, u.FullName`, params))
      .map(r => [toIso(r.WorkDate), r.FullName, r.EmpCode, r.TravelMode, r.IsLate ? 'Yes' : 'No', r.DayStartedAt, r.DayEndedAt, r.Km]);
  } else {
    if (!isManager(req.user)) throw forbidden();
    header = ['Executive', 'Emp Code', 'Territory', 'Target', 'Sales MTD', 'Achieved %', 'Rank', 'Status'];
    rows = (await teamAchievement(await teamIds(req.user))).map(t => [t.name, t.empCode, t.territory, t.target, t.sales, t.achievedPct, t.rank, t.status]);
  }
  const csv = '\uFEFF' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${type}-${from}-to-${to}.csv"`);
  res.send(csv);
});

