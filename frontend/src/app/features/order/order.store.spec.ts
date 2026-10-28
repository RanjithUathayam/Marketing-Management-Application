import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { OrderStore } from './order.store';
import { Matrix, MatrixProduct, Outlet } from '../../core/models';

const product = (id: number, fr: number, alt: number | null = null): MatrixProduct => ({
  id, code: 'p' + id, qrCode: 'Q' + id, name: 'P' + id, icon: '👔', category: 'shirt', brand: 'Ariser', subBrand: 'Shirt',
  factoryRate: fr, halfRate: Math.round(fr * 0.92), mrp: fr * 1.5, scheme: null, altProductId: alt, moq: 5, nonReturnable: false,
  tag: null, hasSleeves: true, colorCount: 1, stockQty: 50, stockBand: { tone: 'green', label: 'ok' }, frequent: false,
  colors: [{ id: id * 10, code: 'C', name: 'Navy', hex: '#000', isCore: true, stock: { '36': 'IN_STOCK', '38': 'OOS_15' } }],
});
const outlet = { id: 7, name: 'Sujal Fashion', area: 'Koramangala', mobile: '9880122114' } as Outlet;

describe('OrderStore', () => {
  let store: OrderStore;
  let http: HttpTestingController;
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(OrderStore);
    http = TestBed.inject(HttpTestingController);
    store.start(outlet);
  });

  it('builds order lines only for selected products and positive quantities', () => {
    store.select(1);
    store.setQty(1, 10, '36', 'FULL', 6);
    store.setQty(1, 10, '38', 'HALF', 4);
    store.setQty(2, 20, '36', 'FULL', 9);   // product 2 not selected
    store.setQty(1, 10, '36', 'FULL', 0);   // cleared
    expect(store.lines()).toEqual([{ productId: 1, colorId: 10, size: '38', sleeve: 'HALF', qty: 4 }]);
  });

  it('computes live totals with half-sleeve pricing', () => {
    store.matrix.set({ sizes: ['36', '38'], products: [product(1, 555)], stockStatuses: {} as Matrix['stockStatuses'] });
    store.select(1);
    store.setQty(1, 10, '36', 'FULL', 6);
    store.setQty(1, 10, '38', 'HALF', 4);
    expect(store.totals()).toEqual({ qty: 10, amount: 6 * 555 + 4 * 511, mrp: 10 * 832.5, products: 1 });
  });

  it('keepInStock removes quantities from out-of-stock cells', () => {
    const p = product(1, 555);
    store.select(1);
    store.setQty(1, 10, '36', 'FULL', 6);
    store.setQty(1, 10, '38', 'FULL', 8);
    store.keepInStock(p);
    expect(store.lines().map(l => l.size)).toEqual(['36']);
  });

  it('preloads same-price alternates into the matrix', async () => {
    store.select(1);
    const done = store.loadMatrix();
    http.expectOne(r => r.url.endsWith('/products/matrix') && r.params.get('ids') === '1')
      .flush({ sizes: ['36'], products: [product(1, 555, 6)], stockStatuses: {} });
    await Promise.resolve();
    http.expectOne(r => r.params.get('ids') === '1,6').flush({ sizes: ['36'], products: [product(1, 555, 6), product(6, 555, 1)], stockStatuses: {} });
    await done;
    expect(store.matrix()!.products.map(p => p.id)).toEqual([1, 6]);
    http.verify();
  });

  it('sends an idempotent clientRef and today as delivery date for immediate delivery', async () => {
    store.select(1);
    store.setQty(1, 10, '36', 'FULL', 6);
    store.setTransport({ transporter: 'Uathayam', destination: 'Koramangala' });
    const p = store.place(12.9, 77.6);
    const req = http.expectOne(r => r.url.endsWith('/orders'));
    expect(req.request.body.clientRef).toBe(store.state().clientRef);
    expect(req.request.body.transport.deliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(req.request.body.lines).toHaveLength(1);
    req.flush({ id: 1 });
    await p;
  });
});
