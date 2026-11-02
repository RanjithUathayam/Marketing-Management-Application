/* Business rules shared by the API. Pure functions — no I/O — so they are unit tested directly. */
import { daysBetween } from '../utils/dates.js';

/* ── Beat visits ───────────────────────────────────────────────────────
   Monthly indicator: 0 → NV · 1 → MV · 2 → V2 · 3 → V3 · 4+ → V4, V5 …  */
export function visitIndicator(n) {
  if (!n) return { code: 'NV', tone: 'nv', label: 'Not visited' };
  if (n === 1) return { code: 'MV', tone: 'v1', label: '1 visit' };
  return { code: 'V' + n, tone: n === 2 ? 'v2' : n === 3 ? 'v3' : 'v4', label: `${n} visits` };
}

export const PC_HIGH = 70;
export const PC_LOW = 40;
/** Productive calls = dealers who ordered ÷ dealers visited (last visit). */
export function productiveCalls(visited, ordered) {
  if (!visited) return null;
  const pct = Math.round((ordered / visited) * 100);
  return { pct, level: pct >= PC_HIGH ? 'hi' : pct >= PC_LOW ? 'mid' : 'low' };
}

export const MUST_VISIT_GAP_DAYS = 7;
/**
 * Priority group: Not Visited (rank 0) → Must Visit (1) → On Track (2).
 * Must Visit = visited this month but planned today, ≥7 days since last visit, or low productive calls.
 */
export function beatPriority({ monthVisitCount, lastVisitDate, plannedToday, pcLevel }, today) {
  const reasons = [];
  if (plannedToday) reasons.push('planned today');
  if (!monthVisitCount) {
    reasons.push(lastVisitDate ? `last visit ${daysBetween(lastVisitDate, today)} days ago` : 'never visited');
    return { rank: 0, group: 'nv', reasons };
  }
  const gap = lastVisitDate ? daysBetween(lastVisitDate, today) : 0;
  if (gap >= MUST_VISIT_GAP_DAYS) reasons.push(`${gap} days since last visit`);
  if (pcLevel === 'low') reasons.push('low productive calls');
  return reasons.length ? { rank: 1, group: 'must', reasons } : { rank: 2, group: 'ok', reasons: [] };
}
/** Sort beats by priority rank, then A-class outlet count (desc). */
export const sortByPriority = beats =>
  [...beats].sort((a, b) => a.priority.rank - b.priority.rank || (b.mix?.a ?? 0) - (a.mix?.a ?? 0));

/** NV · MV · Vs filter group. */
export const visitGroup = n => (n === 0 ? 'nv' : n === 1 ? 'mv' : 'vs');

/* ── Stock ─────────────────────────────────────────────────────────── */
export const STOCK_STATUS = {
  STOPPED:   { tone: 'darkred',  label: 'Stopped',                        orderable: false },
  IN_STOCK:  { tone: 'green',    label: 'In Stock',                       orderable: true },
  OOS_15:    { tone: 'lightred', label: 'Out of Stock (Refill ~15 Days)', orderable: true },
  REFILL_13: { tone: 'yellow',   label: 'Refill in ~13 Days',             orderable: true },
  REFILL_30: { tone: 'blue',     label: 'Refill in ~30 Days',             orderable: true },
};
/** Product-level availability band from total quantity on hand. */
export function stockBand(qty) {
  if (qty <= 0) return { tone: 'red', label: 'Out of Stock' };
  if (qty < 10) return { tone: 'orange', label: `Low (${qty})` };
  if (qty <= 50) return { tone: 'yellow', label: `Medium (${qty})` };
  return { tone: 'green', label: `In Stock (${qty})` };
}

/* ── Outlets ───────────────────────────────────────────────────────── */
/** nonorder (no order 30d) · outstanding (≥80% of credit used) · recent (order in 7d) · ok */
export function outletPerformance({ outstanding, creditLimit, lastOrderAt }, now = new Date()) {
  if (creditLimit > 0 && outstanding >= creditLimit * 0.8) return 'outstanding';
  if (!lastOrderAt) return 'nonorder';
  const days = (now - new Date(lastOrderAt)) / 864e5;
  if (days > 30) return 'nonorder';
  if (days <= 7) return 'recent';
  return 'ok';
}

/* ── Incentives ────────────────────────────────────────────────────── */
export function incentiveFor(slabs, achievedPct, achievedAmount) {
  const sorted = [...slabs].sort((a, b) => a.uptoPct - b.uptoPct);
  const slab = sorted.find(s => achievedPct <= s.uptoPct) ?? sorted[sorted.length - 1] ?? null;
  return { slab, earned: slab ? Math.round((achievedAmount * slab.ratePct) / 100) : 0 };
}

/* ── Orders ────────────────────────────────────────────────────────── */
export const unitPrice = (product, sleeve) =>
  sleeve === 'HALF' && product.hasSleeves ? Math.round(product.factoryRate * product.halfSleeveFactor) : product.factoryRate;

/**
 * Prices an order. `lines` = [{productId, colorId, size, sleeve, qty}],
 * `catalog` = Map(productId → {productName, factoryRate, mrp, moq, hasSleeves, halfSleeveFactor, schemeBuyQty, schemeFreeQty,
 *                              colors: Map(colorId → {stock: {size → status}})}).
 * Throws a list of human-readable problems if the order is not valid.
 * Stock orders need quantity on hand (`colors.qty[size]`): a zero-stock cell cannot be ordered and the pieces asked for
 * a colour × size (full + half sleeve together) cannot exceed it. Demand orders pass `demand: true` — the reverse: only
 * zero-stock cells (out of stock, stopped or with no stock record; `sizes` lists the valid size codes) may be requested —
 * and `enforceMoq: false`.
 */
export function priceOrder(lines, catalog, { taxRate = 0.05, demand = false, sizes = [], enforceMoq = true } = {}) {
  const problems = [];
  const merged = new Map();
  for (const l of lines) {
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty <= 0) continue;
    const sleeve = l.sleeve === 'HALF' ? 'HALF' : 'FULL';
    const key = `${l.productId}|${l.colorId}|${l.size}|${sleeve}`;
    merged.set(key, { ...l, sleeve, qty: (merged.get(key)?.qty ?? 0) + qty });
  }
  if (!merged.size) problems.push('Enter a quantity for at least one product');

  const priced = [];
  const perProduct = new Map();
  const perCell = new Map();   // colourId|size → pieces across sleeves, for the stock check
  for (const l of merged.values()) perCell.set(`${l.colorId}|${l.size}`, (perCell.get(`${l.colorId}|${l.size}`) ?? 0) + l.qty);
  const stockChecked = new Set();
  for (const l of merged.values()) {
    const p = catalog.get(Number(l.productId));
    if (!p) { problems.push(`Unknown product ${l.productId}`); continue; }
    const color = p.colors.get(Number(l.colorId));
    if (!color) { problems.push(`${p.productName}: unknown colour`); continue; }
    const status = color.stock[l.size] ?? (demand && sizes.includes(l.size) ? 'NONE' : null);
    if (!status) { problems.push(`${p.productName}: unknown size ${l.size}`); continue; }
    if (status === 'STOPPED' && !demand) { problems.push(`${p.productName} ${color.colorName} size ${l.size} is stopped`); continue; }
    if (l.sleeve === 'HALF' && !p.hasSleeves) { problems.push(`${p.productName} has no half sleeve`); continue; }
    const onHand = color.qty?.[l.size] ?? 0, cell = `${l.colorId}|${l.size}`;
    if (demand && onHand > 0) {
      problems.push(`${p.productName} ${color.colorName} size ${l.size} has ${onHand} pcs in stock — take it as a stock order`); continue;
    }
    if (!demand && !stockChecked.has(cell)) {
      stockChecked.add(cell);
      if (onHand <= 0) { problems.push(`${p.productName} ${color.colorName} size ${l.size} is out of stock — use Demand Order`); continue; }
      if (perCell.get(cell) > onHand) { problems.push(`${p.productName} ${color.colorName} size ${l.size}: only ${onHand} pcs in stock`); continue; }
    }
    const price = unitPrice(p, l.sleeve);
    priced.push({ productId: Number(l.productId), colorId: Number(l.colorId), size: l.size, sleeve: l.sleeve,
                  qty: l.qty, unitPrice: price, unitMrp: p.mrp, amount: price * l.qty, stockStatus: status,
                  stockQty: onHand });
    perProduct.set(Number(l.productId), (perProduct.get(Number(l.productId)) ?? 0) + l.qty);
  }

  const products = [];
  let schemeValue = 0;
  for (const [productId, qty] of perProduct) {
    const p = catalog.get(productId);
    if (enforceMoq && qty < p.moq) problems.push(`${p.productName}: minimum order is ${p.moq} pcs (add ${p.moq - qty} more)`);
    const freeQty = p.schemeBuyQty ? Math.floor(qty / p.schemeBuyQty) * (p.schemeFreeQty ?? 0) : 0;
    schemeValue += freeQty * p.factoryRate;
    const amount = priced.filter(x => x.productId === productId).reduce((s, x) => s + x.amount, 0);
    products.push({ productId, productName: p.productName, qty, amount, freeQty });
  }
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }
  const subTotal = priced.reduce((s, x) => s + x.amount, 0);
  const mrpValue = priced.reduce((s, x) => s + x.unitMrp * x.qty, 0);
  const taxAmount = Math.round(subTotal * taxRate);
  return {
    lines: priced, products,
    subTotal, mrpValue, schemeValue, taxAmount, totalAmount: subTotal + taxAmount,
    totalPieces: priced.reduce((s, x) => s + x.qty, 0),
  };
}

/** Order would push the outlet over its credit limit (credit terms only). */
export const exceedsCredit = ({ outstanding, creditLimit }, orderTotal, terms) =>
  terms === 'CREDIT' && creditLimit > 0 && outstanding + orderTotal > creditLimit;

/* ── Demand orders ─────────────────────────────────────────────────────
   Pending → Approved → Processing → (fulfilment orders) → Partially Fulfilled → Fulfilled.
   Rejected closes a demand (or its unfulfilled remainder) at any open stage.  */
export const DEMAND_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED'];
/** Manual status changes a reviewer may make; fulfilment statuses are set only by recording a fulfilment. */
export const DEMAND_TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED'], APPROVED: ['PROCESSING', 'REJECTED'], PROCESSING: ['REJECTED'],
  PARTIALLY_FULFILLED: ['REJECTED'], FULFILLED: [], REJECTED: [],
};
export const DEMAND_FULFILLABLE = ['APPROVED', 'PROCESSING', 'PARTIALLY_FULFILLED'];
export const canMoveDemand = (from, to) => (DEMAND_TRANSITIONS[from] ?? []).includes(to);

/**
 * Validates a fulfilment request against the demand's lines.
 * `lines` = [{id, qty, fulfilledQty, productName, colorName, size, stockStatus, stockQty}], `requested` = [{lineId, qty}].
 * Returns [{line, qty}]; throws a list of problems when a quantity exceeds what is pending or what is in stock.
 */
export function planFulfilment(lines, requested) {
  const problems = [];
  const plan = new Map();
  for (const r of requested) {
    const qty = Number(r.qty);
    if (!Number.isInteger(qty) || qty <= 0) continue;
    const line = lines.find(l => l.id === Number(r.lineId));
    if (!line) { problems.push(`Line ${r.lineId} is not part of this demand`); continue; }
    const total = (plan.get(line.id)?.qty ?? 0) + qty;
    const pending = line.qty - line.fulfilledQty;
    const what = `${line.productName} ${line.colorName} size ${line.size}`;
    if (total > pending) problems.push(`${what}: only ${pending} pcs are pending`);
    else if (line.stockStatus === 'STOPPED') problems.push(`${what} is stopped — it cannot be fulfilled from stock`);
    else if (total > (line.stockQty ?? 0)) problems.push(`${what}: only ${line.stockQty ?? 0} pcs in stock`);
    else plan.set(line.id, { line, qty: total });
  }
  if (!plan.size && !problems.length) problems.push('Enter a quantity to fulfil for at least one line');
  if (problems.length) {
    const err = new Error(problems[0]);
    err.problems = problems;
    throw err;
  }
  return [...plan.values()];
}

/** Status after fulfilment quantities are recorded: every line complete → FULFILLED, otherwise PARTIALLY_FULFILLED. */
export const demandStatusAfterFulfil = lines =>
  lines.every(l => l.fulfilledQty >= l.qty) ? 'FULFILLED' : 'PARTIALLY_FULFILLED';

/* ── KYC ───────────────────────────────────────────────────────────── */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IN_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};
/** Returns a list of KYC problems (empty = valid). */
export function validateKyc({ gstin, pan, gstinPhotos = 0, panPhotos = 0 }) {
  const errs = [];
  if (gstin) {
    if (!GSTIN_RE.test(gstin)) errs.push('Invalid GSTIN format');
    else if (!IN_STATES[gstin.slice(0, 2)]) errs.push('GSTIN has an unknown state code');
    if (!gstinPhotos) errs.push('Add at least 1 GSTIN certificate photo');
  }
  if (pan) {
    if (!PAN_RE.test(pan)) errs.push('Invalid PAN format (AAAAA9999A)');
    if (gstin && GSTIN_RE.test(gstin) && gstin.slice(2, 12) !== pan) errs.push('PAN does not match the GSTIN');
    if (!panPhotos) errs.push('Add at least 1 PAN card photo');
  }
  if (gstinPhotos > 5 || panPhotos > 5) errs.push('Up to 5 photos are allowed per document');
  return errs;
}

/* ── Geo ───────────────────────────────────────────────────────────── */
export function haversineMeters(a, b) {
  const R = 6371000, toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const pathMeters = pts => pts.slice(1).reduce((s, p, i) => s + haversineMeters(pts[i], p), 0);

/* ── Sample pads ───────────────────────────────────────────────────── */
export const samplePadQr = ({ empCode, dcNo, itemCode }) => `SP|${empCode}|${dcNo}|${itemCode.toUpperCase()}`;
