import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  visitIndicator, productiveCalls, beatPriority, sortByPriority, visitGroup, stockBand, outletPerformance,
  incentiveFor, priceOrder, exceedsCredit, validateKyc, haversineMeters, samplePadQr, unitPrice,
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
        colors: new Map([[11, { colorName: 'Walnut', stock: { 36: 'IN_STOCK', 38: 'STOPPED', 40: 'OOS_15' } }]]) }],
  [2, { productName: 'SILK SATIN', factoryRate: 430, mrp: 645, moq: 10, hasSleeves: false, halfSleeveFactor: 0.92,
        colors: new Map([[21, { colorName: 'Lavender', stock: { 36: 'IN_STOCK' } }]]) }],
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
