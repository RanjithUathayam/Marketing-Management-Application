import { db } from '../db/index.js';
import { localDate, localYearMonth, toIso, addDays } from '../utils/dates.js';
import { visitIndicator, productiveCalls, beatPriority, sortByPriority, visitGroup } from '../domain/rules.js';

/**
 * Beat insights: A/B/C mix, this month's visits (NV/MV/V2…), last visit productive calls,
 * planned days and visit priority. `visitUserIds` = whose visits count (null = everyone);
 * `planUserId` = whose journey plan decides "planned today".
 */
export async function beatInsights({ beatIds, visitUserIds = null, planUserId = null }, tx) {
  if (!beatIds?.length) return [];
  const today = localDate();
  const { year, month } = localYearMonth();
  const monthStart = today.slice(0, 8) + '01';
  const params = { beatIds: JSON.stringify(beatIds), since: addDays(today, -180), year, month, planUser: planUserId };
  let userFilter = '';
  if (visitUserIds) { params.users = JSON.stringify(visitUserIds); userFilter = 'AND bv.UserId IN (SELECT value FROM OPENJSON(@users))'; }

  const [beats, visits, planDays] = await db.queryMulti(
    `SELECT s.* FROM dbo.vw_BeatSummary s WHERE s.BeatId IN (SELECT value FROM OPENJSON(@beatIds));
     SELECT bv.BeatId, bv.VisitDate, SUM(bv.DealersVisited) AS Visited, SUM(bv.DealersOrdered) AS Ordered
       FROM dbo.BeatVisits bv
      WHERE bv.BeatId IN (SELECT value FROM OPENJSON(@beatIds)) AND bv.VisitDate >= @since ${userFilter}
      GROUP BY bv.BeatId, bv.VisitDate;
     SELECT d.PlanDay, d.BeatId FROM dbo.JourneyPlanDays d JOIN dbo.JourneyPlans p ON p.PlanId = d.PlanId
      WHERE p.UserId = @planUser AND p.PlanYear = @year AND p.PlanMonth = @month;`, params, tx);

  const day = Number(today.slice(8, 10));
  const result = beats.map(b => {
    const mine = visits.filter(v => v.BeatId === b.BeatId)
      .map(v => ({ date: toIso(v.VisitDate), visited: v.Visited, ordered: v.Ordered }))
      .sort((x, y) => x.date.localeCompare(y.date));
    const monthVisits = mine.filter(v => v.date >= monthStart && v.date <= today);
    const last = mine.filter(v => v.date <= today).at(-1) ?? null;
    const pc = last ? productiveCalls(last.visited, last.ordered) : null;
    const plannedToday = planDays.some(p => p.PlanDay === day && p.BeatId === b.BeatId);
    const priority = beatPriority({ monthVisitCount: monthVisits.length, lastVisitDate: last?.date, plannedToday, pcLevel: pc?.level }, today);
    return {
      id: b.BeatId, code: b.BeatCode, name: b.BeatName, area: b.Area, colorTag: b.ColorTag,
      outlets: b.OutletCount, mix: { a: b.ClassA, b: b.ClassB, c: b.ClassC },
      monthVisits, visitCount: monthVisits.length, indicator: visitIndicator(monthVisits.length), group: visitGroup(monthVisits.length),
      lastVisit: last ? { ...last, previousMonth: last.date < monthStart } : null,
      productiveCalls: pc, plannedToday, plannedDays: planDays.filter(p => p.BeatId === b.BeatId).length, priority,
    };
  });
  return sortByPriority(result);
}

/** Beat ids assigned to a set of users (null = all active beats). */
export async function assignedBeatIds(userIds, tx) {
  if (!userIds) return (await db.query('SELECT BeatId FROM dbo.Beats WHERE IsActive = 1', {}, tx)).map(r => r.BeatId);
  const rows = await db.query(
    `SELECT DISTINCT ba.BeatId FROM dbo.BeatAssignments ba JOIN dbo.Beats b ON b.BeatId = ba.BeatId
      WHERE b.IsActive = 1 AND ba.UserId IN (SELECT value FROM OPENJSON(@u))`, { u: JSON.stringify(userIds) }, tx);
  return rows.map(r => r.BeatId);
}

/** Assigned beats plus whatever today's journey plan points at — an approved beat change can move a day to an unassigned beat. */
export async function workingBeatIds(userIds, tx) {
  if (!userIds) return assignedBeatIds(null, tx);
  const { year, month, day } = localYearMonth();
  const assigned = await assignedBeatIds(userIds, tx);
  const planned = await db.query(
    `SELECT DISTINCT d.BeatId FROM dbo.JourneyPlanDays d JOIN dbo.JourneyPlans p ON p.PlanId = d.PlanId JOIN dbo.Beats b ON b.BeatId = d.BeatId
      WHERE b.IsActive = 1 AND p.PlanYear = @y AND p.PlanMonth = @m AND p.UserId IN (SELECT value FROM OPENJSON(@u)) AND d.PlanDay = @d`,
    { y: year, m: month, d: day, u: JSON.stringify(userIds) }, tx);
  return [...new Set([...assigned, ...planned.map(r => r.BeatId)])];
}

/** Compact counts used on approval cards. */
export function insightStrip(list) {
  return {
    nv: list.filter(b => b.group === 'nv').length,
    mv: list.filter(b => b.group === 'mv').length,
    vs: list.filter(b => b.group === 'vs').length,
    mustVisit: list.filter(b => b.priority.group === 'must').length,
    lowCalls: list.filter(b => b.productiveCalls?.level === 'low').length,
  };
}
