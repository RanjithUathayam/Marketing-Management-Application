import { db } from '../db/index.js';
import { localDate, localYearMonth, utcRange, weekday, isoDate, addDays } from '../utils/dates.js';
import { incentiveFor } from '../domain/rules.js';

/** Working days (Mon–Sat) in a month up to and including `uptoDay`. */
export function workingDaysUpTo(year, month, uptoDay) {
  let n = 0;
  for (let d = 1; d <= uptoDay; d++) if (weekday(year, month, d) !== 0) n++;
  return n;
}

/** Sales (net of tax) for users in a local date range. */
export async function salesBetween(userIds, fromIso, toIso, tx) {
  const { start, end } = utcRange(fromIso, toIso);
  const r = await db.one(
    `SELECT ISNULL(SUM(SubTotal), 0) AS amt FROM dbo.Orders
      WHERE OrderedAt >= @start AND OrderedAt < @end AND UserId IN (SELECT value FROM OPENJSON(@u))`,
    { start, end, u: JSON.stringify(userIds) }, tx);
  return Number(r.amt);
}

/** Target vs achievement (daily / weekly / monthly / quarterly) and incentive for one executive. */
export async function targetSummary(userId) {
  const today = localDate();
  const { year, month, day } = localYearMonth();
  const monthStart = isoDate(year, month, 1);
  const q0 = Math.floor((month - 1) / 3) * 3 + 1;
  const [targets, slabs] = await db.queryMulti(
    `SELECT TargetMonth, MonthlyTarget, WorkingDays FROM dbo.SalesTargets WHERE UserId = @u AND TargetYear = @y AND TargetMonth BETWEEN @q0 AND @q1;
     SELECT UptoPct AS uptoPct, RatePct AS ratePct, Label AS label FROM dbo.IncentiveSlabs ORDER BY UptoPct;`,
    { u: userId, y: year, q0, q1: q0 + 2 });
  const t = targets.find(x => x.TargetMonth === month);
  const monthly = Number(t?.MonthlyTarget ?? 0), workingDays = t?.WorkingDays ?? 26;
  const daily = workingDays ? Math.round(monthly / workingDays) : 0;
  const dow = weekday(year, month, day) || 7;                       // Monday = 1 … Sunday = 7
  const weekStart = addDays(today, 1 - dow);
  const [achieved, todaySales, weekSales, quarterSales] = await Promise.all([
    salesBetween([userId], monthStart, today),
    salesBetween([userId], today, today),
    salesBetween([userId], weekStart, today),
    salesBetween([userId], isoDate(year, q0, 1), today),
  ]);
  const quarterTarget = targets.reduce((s, x) => s + Number(x.MonthlyTarget), 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const achievedPct = pct(achieved, monthly);
  const { slab, earned } = incentiveFor(slabs.map(s => ({ ...s, ratePct: Number(s.ratePct) })), achievedPct, achieved);
  const elapsed = workingDaysUpTo(year, month, day);
  const nextSlab = slab ? slabs.find(s => s.uptoPct > slab.uptoPct) : null;
  return {
    year, month, monthlyTarget: monthly, achieved, achievedPct, balance: Math.max(0, monthly - achieved),
    workingDays, elapsedWorkingDays: elapsed, daysLeft: Math.max(0, workingDays - elapsed),
    daily: { target: daily, achieved: todaySales, pct: pct(todaySales, daily) },
    weekly: { target: daily * 6, achieved: weekSales, pct: pct(weekSales, daily * 6) },
    quarterly: { target: quarterTarget, achieved: quarterSales, pct: pct(quarterSales, quarterTarget) },
    incentive: { slab, earned, slabs: slabs.map(s => ({ ...s, ratePct: Number(s.ratePct) })),
                 nextSlab: nextSlab ? { ...nextSlab, ratePct: Number(nextSlab.ratePct) } : null },
    hasTarget: !!t,
  };
}

/** Monthly achievement % for a list of users (team ranking). */
export async function teamAchievement(userIds) {
  if (!userIds.length) return [];
  const { year, month } = localYearMonth();
  const today = localDate();
  const { start, end } = utcRange(isoDate(year, month, 1), today);
  const rows = await db.query(
    `SELECT u.UserId, u.FullName, u.EmpCode, u.Territory, ISNULL(t.MonthlyTarget, 0) AS Target, ISNULL(s.Sales, 0) AS Sales,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.AttendanceSessions a WHERE a.UserId = u.UserId AND a.CheckOutAt IS NULL) THEN 1 ELSE 0 END AS Active,
            (SELECT MAX(g.CapturedAt) FROM dbo.GpsPoints g WHERE g.UserId = u.UserId AND g.CapturedAt >= @start) AS LastSeen
       FROM dbo.Users u
       LEFT JOIN dbo.SalesTargets t ON t.UserId = u.UserId AND t.TargetYear = @y AND t.TargetMonth = @m
       OUTER APPLY (SELECT SUM(o.SubTotal) AS Sales FROM dbo.Orders o WHERE o.UserId = u.UserId AND o.OrderedAt >= @start AND o.OrderedAt < @end) s
      WHERE u.RoleCode = 'EXEC' AND u.IsActive = 1 AND u.UserId IN (SELECT value FROM OPENJSON(@ids))`,
    { y: year, m: month, start, end, ids: JSON.stringify(userIds) });
  return rows.map(r => {
    const ach = Number(r.Target) ? Math.round((Number(r.Sales) / Number(r.Target)) * 100) : 0;
    return { id: r.UserId, name: r.FullName, empCode: r.EmpCode, territory: r.Territory, target: Number(r.Target),
      sales: Number(r.Sales), achievedPct: ach, rank: ach >= 75 ? 'top' : ach >= 50 ? 'avg' : 'low',
      status: r.Active ? 'active' : 'idle', lastSeenAt: r.LastSeen };
  }).sort((a, b) => b.achievedPct - a.achievedPct);
}

