import { db } from '../db/index.js';
import { scopeUserIds } from '../middleware/auth.js';
import { notFound, forbidden, conflict, badRequest } from '../utils/http.js';
import { notify } from './notify.js';

/* Generic approve / reject for the request tables that share
   (Status, ManagerRemark, ActionedBy, ActionedAt, UserId) columns. */
const TABLES = {
  leave:          { table: 'dbo.LeaveRequests',      key: 'LeaveRequestId',   label: 'Leave request' },
  regularization: { table: 'dbo.Regularizations',    key: 'RegularizationId', label: 'Regularization' },
  expense:        { table: 'dbo.Expenses',           key: 'ExpenseId',        label: 'Expense' },
  beatChange:     { table: 'dbo.BeatChangeRequests', key: 'RequestId',        label: 'Beat change' },
};

/** Loads a request and checks the caller manages its owner (managers cannot approve their own). */
export async function loadForAction(kind, id, user, tx) {
  const t = TABLES[kind];
  const row = await db.one(`SELECT * FROM ${t.table} WITH (UPDLOCK) WHERE ${t.key} = @id`, { id }, tx);
  if (!row) throw notFound(t.label);
  const ids = await scopeUserIds(user);
  if (row.UserId === user.id) throw forbidden('You cannot approve your own request');
  if (ids && !ids.includes(row.UserId)) throw forbidden('That request is outside your team');
  if (row.Status !== 'PENDING') throw conflict(`${t.label} has already been ${row.Status.toLowerCase()}`);
  return row;
}

export async function actionRequest(kind, id, user, { approve, remark }, tx) {
  const t = TABLES[kind];
  if (!approve && !remark?.trim()) throw badRequest('Remarks are required when rejecting');
  const row = await loadForAction(kind, id, user, tx);
  await db.query(
    `UPDATE ${t.table} SET Status = @s, ManagerRemark = @r, ActionedBy = @by, ActionedAt = SYSUTCDATETIME() WHERE ${t.key} = @id`,
    { s: approve ? 'APPROVED' : 'REJECTED', r: remark?.trim() || null, by: user.id, id }, tx);
  await notify(row.UserId, {
    icon: approve ? '✅' : '↩', title: `${t.label} ${approve ? 'approved' : 'rejected'}`,
    body: remark?.trim() ? `${user.name}: "${remark.trim()}"` : `Actioned by ${user.name}`, tone: approve ? 'green' : 'red',
  }, tx);
  return row;
}
