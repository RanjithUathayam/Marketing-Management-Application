import { Pipe, PipeTransform } from '@angular/core';
import { OrderStatus } from './models';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const money = (n: number | null | undefined) => '₹' + Math.round(Number(n ?? 0)).toLocaleString('en-IN');
/** Short Indian-style amount for chart labels: ₹950 · ₹45k · ₹1.2L · ₹3.4Cr */
export function compactInr(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${+(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${+(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${Math.round(n / 1e3)}k`;
  return `₹${Math.round(n)}`;
}
export function fmtDT(iso: string | null | undefined, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  const t = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}${withTime ? ' · ' + t : ''}`;
}
export const fmtTime = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() : '';
/** 'YYYY-MM-DD' → '10 Jun' (or with year) */
export function fmtD(iso: string | null | undefined, year = false) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}${year ? ' ' + y : ''}`;
}
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function duration(ms: number, secs = true) {
  const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60, z = (n: number) => String(n).padStart(2, '0');
  return secs ? `${z(h)}:${z(m)}:${z(s)}` : `${h}h ${z(m)}m`;
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export const BEAT_COLOR: Record<string, string> = { green: '#0d6e50', teal: '#0d9488', amber: '#d97706' };
export const STOCK_HEX: Record<string, string> = { green: '#16a34a', yellow: '#ca8a04', orange: '#ea580c', red: '#dc2626' };
export const PERF: Record<string, { hex: string; label: string }> = {
  nonorder: { hex: '#ea580c', label: 'No order recently' },
  outstanding: { hex: '#991b1b', label: 'High outstanding' },
  recent: { hex: '#ca8a04', label: 'Recently ordered' },
  ok: { hex: '#16a34a', label: 'On track' },
};
export const STOCK_TONE: Record<string, string> = { STOPPED: 'darkred', IN_STOCK: 'green', OOS_15: 'lightred', REFILL_13: 'yellow', REFILL_30: 'blue' };
export const STOCK_LABEL: Record<string, string> = {
  STOPPED: '🔴 Stopped', IN_STOCK: '🟢 In Stock', OOS_15: '🟥 Out of Stock (Refill ~15 Days)', REFILL_13: '🟨 Refill in ~13 Days', REFILL_30: '🟦 Refill in ~30 Days',
};

/* Order lifecycle: Received → Approved → Delivered → Invoiced → Dispatched → Completed */
export const ORDER_STAGES: { k: OrderStatus; lbl: string; short: string; ic: string; c: string; c2: string; note: string }[] = [
  { k: 'RECEIVED', lbl: 'Order Received', short: 'Received', ic: '📥', c: '#2563eb', c2: '#dbeafe', note: 'Order logged in the system' },
  { k: 'APPROVED', lbl: 'Approved', short: 'Approved', ic: '✅', c: '#7c3aed', c2: '#ede9fe', note: 'Approved by manager' },
  { k: 'DELIVERED', lbl: 'Delivered', short: 'Delivered', ic: '📦', c: '#db2777', c2: '#fce7f3', note: 'Received at outlet' },
  { k: 'INVOICED', lbl: 'Invoiced', short: 'Invoiced', ic: '🧾', c: '#0891b2', c2: '#cffafe', note: 'Tax invoice generated' },
  { k: 'DISPATCHED', lbl: 'Dispatched', short: 'Dispatched', ic: '🚚', c: '#ea580c', c2: '#ffedd5', note: 'Handed to transporter' },
  { k: 'COMPLETED', lbl: 'Completed', short: 'Completed', ic: '🏁', c: '#0d6e50', c2: '#dcfce7', note: 'Payment settled · order closed' },
];
export const stage = (s: OrderStatus) => ORDER_STAGES.find(x => x.k === s) ?? ORDER_STAGES[0];
export const stageIdx = (s: OrderStatus) => ORDER_STAGES.findIndex(x => x.k === s);

@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform { transform(v: number | null | undefined) { return money(v); } }
@Pipe({ name: 'dt' })
export class DtPipe implements PipeTransform { transform(v: string | null | undefined, withTime = true) { return fmtDT(v, withTime); } }
@Pipe({ name: 'd' })
export class DPipe implements PipeTransform { transform(v: string | null | undefined, year = false) { return fmtD(v, year); } }
@Pipe({ name: 'time' })
export class TimePipe implements PipeTransform { transform(v: string | null | undefined) { return fmtTime(v); } }
