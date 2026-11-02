import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  visitIndicator, productiveCalls, beatPriority, sortByPriority, visitGroup, stockBand, outletPerformance,
  incentiveFor, priceOrder, exceedsCredit, validateKyc, haversineMeters, samplePadQr, unitPrice,
  canMoveDemand, planFulfilment, demandStatusAfterFulfil,
} from '../src/domain/rules.js';
import { utcRange, addDays, daysBetween, weekday } from '../src/utils/dates.js';
import { workingDaysUpTo } from '../src/services/targets.js';

test('visit indicator NV / MV / V2 / V3 / V4+', () => {
  assert.equal(visitIndicator(0).code, 'NV');
  assert.equal(visitIndicator(1).code, 'MV');
  assert.deepEqual([2, 3].map(n => visitIndicator(n).tone), ['v2', 'v3']);
  assert.equal(visitIndicator(5).code, 'V5');
  assert.equal(visitIndicator(5).tone, 'v4');
  assert.deepEqual([0, 1, 2, 7].map(visitGroup), ['nv', 'mv', 'vs', 'vs']);
});

test('productive calls thresholds 70 / 40', () => {
  assert.equal(productiveCalls(0, 0), null);
  assert.deepEqual(productiveCalls(10, 7), { pct: 70, level: 'hi' });
  assert.equal(productiveCalls(10, 4).level, 'mid');
  assert.equal(productiveCalls(13, 4).level, 'low');
});

test('beat priority: not visited → must visit → on track, A-class first', () => {
  const today = '2026-06-10';
  assert.equal(beatPriority({ monthVisitCount: 0, lastVisitDate: '2026-05-21' }, today).group, 'nv');
  assert.match(beatPriority({ monthVisitCount: 0, lastVisitDate: '2026-05-21' }, today).reasons[0], /20 days ago/);
  assert.equal(beatPriority({ monthVisitCount: 0 }, today).reasons[0], 'never visited');
  assert.equal(beatPriority({ monthVisitCount: 1, lastVisitDate: '2026-06-03' }, today).group, 'must');      // 7 days
  assert.equal(beatPriority({ monthVisitCount: 2, lastVisitDate: '2026-06-09', pcLevel: 'low' }, today).group, 'must');
  assert.equal(beatPriority({ monthVisitCount: 2, lastVisitDate: '2026-06-09', plannedToday: true }, today).group, 'must');
  assert.equal(beatPriority({ monthVisitCount: 2, lastVisitDate: '2026-06-09', pcLevel: 'hi' }, today).group, 'ok');
  const sorted = sortByPriority([
    { id: 1, priority: { rank: 2 }, mix: { a: 9 } }, { id: 2, priority: { rank: 0 }, mix: { a: 1 } },
    { id: 3, priority: { rank: 0 }, mix: { a: 6 } }, { id: 4, priority: { rank: 1 }, mix: { a: 0 } }]);
  assert.deepEqual(sorted.map(b => b.id), [3, 2, 4, 1]);
});

test('stock band and outlet performance flags', () => {
  assert.equal(stockBand(0).tone, 'red');
  assert.equal(stockBand(8).tone, 'orange');
  assert.equal(stockBand(45).tone, 'yellow');
  assert.equal(stockBand(90).tone, 'green');
  const now = new Date('2026-06-10T10:00:00Z');
  assert.equal(outletPerformance({ outstanding: 96500, creditLimit: 80000, lastOrderAt: '2026-06-09' }, now), 'outstanding');
  assert.equal(outletPerformance({ outstanding: 0, creditLimit: 80000, lastOrderAt: null }, now), 'nonorder');
  assert.equal(outletPerformance({ outstanding: 0, creditLimit: 80000, lastOrderAt: '2026-06-08' }, now), 'recent');
  assert.equal(outletPerformance({ outstanding: 0, creditLimit: 80000, lastOrderAt: '2026-05-20' }, now), 'ok');
  assert.equal(outletPerformance({ outstanding: 0, creditLimit: 80000, lastOrderAt: '2026-04-01' }, now), 'nonorder');
});

test('incentive slab selection', () => {
  const slabs = [{ uptoPct: 80, ratePct: 0 }, { uptoPct: 100, ratePct: 1.2 }, { uptoPct: 120, ratePct: 2 }, { uptoPct: 999, ratePct: 2.8 }];
  assert.deepEqual(incentiveFor(slabs, 66, 986000), { slab: slabs[0], earned: 0 });
  assert.equal(incentiveFor(slabs, 95, 1_000_000).earned, 12000);
  assert.equal(incentiveFor(slabs, 130, 1_000_000).slab.ratePct, 2.8);
});

const catalog = new Map([
  [1, { productName: 'CARLOS', factoryRate: 555, mrp: 835, moq: 5, hasSleeves: true, halfSleeveFactor: 0.92, schemeBuyQty: 10, schemeFreeQty: 1,
        colors: new Map([[11, { colorName: 'Walnut', stock: { 36: 'IN_STOCK', 38: 'STOPPED', 40: 'OOS_15', 44: 'IN_STOCK' },
                                qty: { 36: 20, 38: 0, 40: 6, 44: 0 } }]]) }],
  [2, { productName: 'SILK SATIN', factoryRate: 430, mrp: 645, moq: 10, hasSleeves: false, halfSleeveFactor: 0.92,
        colors: new Map([[21, { colorName: 'Lavender', stock: { 36: 'IN_STOCK' }, qty: { 36: 30 } }]]) }],
]);

test('order pricing: full / half sleeve, scheme free goods, tax, merge duplicate cells', () => {
  assert.equal(unitPrice({ factoryRate: 555, hasSleeves: true, halfSleeveFactor: 0.92 }, 'HALF'), 511);
  const q = priceOrder([
    { productId: 1, colorId: 11, size: '36', sleeve: 'FULL', qty: 6 },
    { productId: 1, colorId: 11, size: '36', sleeve: 'FULL', qty: 2 },   // merged with the line above
    { productId: 1, colorId: 11, size: '40', sleeve: 'HALF', qty: 4 },
    { productId: 1, colorId: 11, size: '36', sleeve: 'FULL', qty: 0 },   // ignored
  ], catalog, { taxRate: 0.05 });
  assert.equal(q.lines.length, 2);
  assert.equal(q.subTotal, 8 * 555 + 4 * 511);
  assert.equal(q.totalPieces, 12);
  assert.equal(q.products[0].freeQty, 1);
  assert.equal(q.schemeValue, 555);
  assert.equal(q.taxAmount, Math.round(q.subTotal * 0.05));
  assert.equal(q.totalAmount, q.subTotal + q.taxAmount);
  assert.equal(q.mrpValue, 12 * 835);
});

test('order pricing rejects stopped cells, MOQ shortfall, half sleeve on fabric, empty orders', () => {
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '38', qty: 6 }], catalog), /stopped/);
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '36', qty: 3 }], catalog), /minimum order is 5/);
  assert.throws(() => priceOrder([{ productId: 2, colorId: 21, size: '36', sleeve: 'HALF', qty: 12 }], catalog), /no half sleeve/);
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '36', qty: 0 }], catalog), /at least one product/);
  assert.throws(() => priceOrder([{ productId: 9, colorId: 1, size: '36', qty: 5 }], catalog), /Unknown product/);
});

test('demand pricing accepts only zero-stock cells (stopped, out of stock, unstocked), skips MOQ, still rejects bad input', () => {
  const opts = { taxRate: 0, demand: true, sizes: ['36', '38', '40', '42', '44'], enforceMoq: false };
  const q = priceOrder([
    { productId: 1, colorId: 11, size: '38', qty: 2 },   // stopped, 0 on hand
    { productId: 1, colorId: 11, size: '44', qty: 1 },   // 0 on hand
    { productId: 1, colorId: 11, size: '42', qty: 1 },   // no stock record at all
  ], catalog, opts);
  assert.deepEqual(q.lines.map(l => l.stockStatus), ['STOPPED', 'IN_STOCK', 'NONE']);
  assert.equal(q.subTotal, 4 * 555);
  assert.equal(q.taxAmount, 0);
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '99', qty: 1 }], catalog, opts), /unknown size/);
  assert.throws(() => priceOrder([{ productId: 2, colorId: 21, size: '36', sleeve: 'HALF', qty: 1 }], catalog, opts), /no half sleeve/);
  // anything with stock on hand belongs on the stock order
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '40', qty: 1 }], catalog, opts), /has 6 pcs in stock — take it as a stock order/);
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '36', qty: 30 }], catalog, opts), /has 20 pcs in stock/);
  // regular orders are unchanged
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '42', qty: 6 }], catalog), /unknown size/);
});

test('demand status transitions and fulfilment planning', () => {
  assert.equal(canMoveDemand('PENDING', 'APPROVED'), true);
  assert.equal(canMoveDemand('PENDING', 'PROCESSING'), false);
  assert.equal(canMoveDemand('APPROVED', 'PROCESSING'), true);
  assert.equal(canMoveDemand('PARTIALLY_FULFILLED', 'REJECTED'), true);
  assert.equal(canMoveDemand('FULFILLED', 'REJECTED'), false);
  assert.equal(canMoveDemand('REJECTED', 'APPROVED'), false);

  const lines = [
    { id: 1, qty: 10, fulfilledQty: 4, productName: 'CARLOS', colorName: 'Walnut', size: '36', stockStatus: 'IN_STOCK', stockQty: 50 },
    { id: 2, qty: 5, fulfilledQty: 0, productName: 'CARLOS', colorName: 'Walnut', size: '38', stockStatus: 'STOPPED', stockQty: 0 },
    { id: 3, qty: 8, fulfilledQty: 0, productName: 'CARLOS', colorName: 'Walnut', size: '40', stockStatus: 'IN_STOCK', stockQty: 3 },
  ];
  assert.deepEqual(planFulfilment(lines, [{ lineId: 1, qty: 6 }, { lineId: 3, qty: 0 }]).map(p => [p.line.id, p.qty]), [[1, 6]]);
  assert.throws(() => planFulfilment(lines, [{ lineId: 1, qty: 7 }]), /only 6 pcs are pending/);
  assert.throws(() => planFulfilment(lines, [{ lineId: 2, qty: 1 }]), /stopped/);
  assert.throws(() => planFulfilment(lines, [{ lineId: 3, qty: 4 }]), /only 3 pcs in stock/);
  assert.throws(() => planFulfilment(lines, [{ lineId: 9, qty: 1 }]), /not part of this demand/);
  assert.throws(() => planFulfilment(lines, [{ lineId: 1, qty: 0 }]), /at least one line/);

  assert.equal(demandStatusAfterFulfil([{ qty: 10, fulfilledQty: 10 }, { qty: 5, fulfilledQty: 5 }]), 'FULFILLED');
  assert.equal(demandStatusAfterFulfil([{ qty: 10, fulfilledQty: 10 }, { qty: 5, fulfilledQty: 0 }]), 'PARTIALLY_FULFILLED');
});

test('stock orders need quantity on hand; full and half sleeve share the stock of a cell', () => {
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '44', qty: 6 }], catalog), /out of stock — use Demand Order/);
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '36', qty: 21 }], catalog), /only 20 pcs in stock/);
  assert.throws(() => priceOrder([{ productId: 1, colorId: 11, size: '36', sleeve: 'FULL', qty: 15 },
                                  { productId: 1, colorId: 11, size: '36', sleeve: 'HALF', qty: 6 }], catalog), /only 20 pcs in stock/);
  assert.equal(priceOrder([{ productId: 1, colorId: 11, size: '36', qty: 20 }], catalog).totalPieces, 20);
  // the same zero-stock cell is fine on a demand order
  assert.equal(priceOrder([{ productId: 1, colorId: 11, size: '44', qty: 6 }], catalog, { demand: true, sizes: ['44'], enforceMoq: false }).totalPieces, 6);
});

test('credit limit check only applies to credit terms', () => {
  assert.equal(exceedsCredit({ outstanding: 96500, creditLimit: 80000 }, 1000, 'CREDIT'), true);
  assert.equal(exceedsCredit({ outstanding: 96500, creditLimit: 80000 }, 1000, 'CASH'), false);
  assert.equal(exceedsCredit({ outstanding: 0, creditLimit: 120000 }, 84500, 'CREDIT'), false);
});

test('KYC: GSTIN / PAN format, cross-check and photo requirements', () => {
  assert.deepEqual(validateKyc({}), []);
  assert.deepEqual(validateKyc({ gstin: '29ABCDE1234F1Z5', pan: 'ABCDE1234F', gstinPhotos: 1, panPhotos: 2 }), []);
  assert.ok(validateKyc({ gstin: '29ABCDE1234F1Z5', gstinPhotos: 0 }).some(e => /GSTIN certificate photo/.test(e)));
  assert.ok(validateKyc({ gstin: '29ABCDE1234F1Z5', pan: 'ZZZZZ9999Z', gstinPhotos: 1, panPhotos: 1 }).includes('PAN does not match the GSTIN'));
  assert.ok(validateKyc({ gstin: '99ABCDE1234F1Z5', gstinPhotos: 1 }).some(e => /unknown state/.test(e)));
  assert.ok(validateKyc({ pan: 'ABC123', panPhotos: 1 }).some(e => /Invalid PAN/.test(e)));
  assert.ok(validateKyc({ pan: 'ABCDE1234F', panPhotos: 6 }).some(e => /Up to 5/.test(e)));
});

test('geo distance and sample pad QR payload', () => {
  const d = haversineMeters({ lat: 12.935, lng: 77.626 }, { lat: 12.936, lng: 77.626 });
  assert.ok(d > 105 && d < 115);
  assert.equal(samplePadQr({ empCode: 'FA-2231', dcNo: 'DC/26-27/0871', itemCode: 'sp01' }), 'SP|FA-2231|DC/26-27/0871|SP01');
});

test('date helpers: IST day range, working days', () => {
  const { start, end } = utcRange('2026-06-10');
  assert.equal(start.toISOString(), '2026-06-09T18:30:00.000Z');
  assert.equal(end.toISOString(), '2026-06-10T18:30:00.000Z');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysBetween('2026-05-21', '2026-06-10'), 20);
  assert.equal(weekday(2026, 6, 7), 0);                    // 7 June 2026 is a Sunday
  assert.equal(workingDaysUpTo(2026, 6, 7), 6);
});
