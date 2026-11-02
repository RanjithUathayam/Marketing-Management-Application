import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Api } from '../../core/api.service';
import { DemandOrder, Matrix, MatrixProduct, Order, OrderLineInput, Outlet, Quote, Sleeve } from '../../core/models';
import { todayIso } from '../../core/format';

const KEY = 'mma.cart';
const cellKey = (pid: number, colorId: number, size: string, sleeve: Sleeve) => `${pid}|${colorId}|${size}|${sleeve}`;
/** Which quantity map a cell belongs to: the regular stock order or the demand order. */
export type Cart = 'qty' | 'demand';

interface Persisted {
  outlet: Outlet | null; selected: number[]; qty: Record<string, number>; sleeve: Record<number, Sleeve>;
  terms: 'CREDIT' | 'CASH' | 'ONLINE'; instructions: string; clientRef: string;
  transport: { mode: 'Lorry' | 'Van' | 'Bus'; transporter: string; destination: string; deliveryDate: string; immediate: boolean };
  /** Demand order — kept apart from `qty` so it never mixes with the stock order. */
  demand: Record<string, number>; demandMode: boolean; demandRef: string; demandRemarks: string; demandBy: string;
}
const fresh = (outlet: Outlet | null = null): Persisted => ({
  outlet, selected: [], qty: {}, sleeve: {}, terms: 'CREDIT', instructions: '', clientRef: crypto.randomUUID(),
  transport: { mode: 'Lorry', transporter: '', destination: outlet?.area ?? '', deliveryDate: todayIso(), immediate: true },
  demand: {}, demandMode: false, demandRef: crypto.randomUUID(), demandRemarks: '', demandBy: '',
});

/** Order-taking cart shared by the select → matrix → summary → transport → success screens. */
@Injectable({ providedIn: 'root' })
export class OrderStore {
  private api = inject(Api);
  private s = signal<Persisted>(this.restore());
  readonly matrix = signal<Matrix | null>(null);
  readonly quote = signal<Quote | null>(null);
  signature = '';

  readonly outlet = computed(() => this.s().outlet);
  readonly selected = computed(() => new Set(this.s().selected));
  readonly state = this.s.asReadonly();
  readonly demandMode = computed(() => this.s().demandMode);

  constructor() {
    effect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(this.s())); } catch { /* ignore */ } });
  }
  private restore(): Persisted {
    try { return { ...fresh(), ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return fresh(); }
  }
  private patch(p: Partial<Persisted>) { this.s.update(s => ({ ...s, ...p })); }

  start(outlet: Outlet) {
    this.s.set(fresh(outlet)); this.matrix.set(null); this.quote.set(null); this.signature = '';
    try { sessionStorage.setItem('mma.orderStart', String(Date.now())); } catch { /* ignore */ }
  }
  reset() { this.s.set(fresh()); this.matrix.set(null); this.quote.set(null); this.signature = ''; }
  /** After a stock order is placed: clears it but keeps an unsubmitted demand (same outlet) so it can still be sent. */
  finishStockOrder() {
    const s = this.s();
    if (!Object.keys(s.demand).length) { this.reset(); return; }
    this.s.set({ ...fresh(s.outlet), selected: s.selected, sleeve: s.sleeve,
      demand: s.demand, demandMode: true, demandRef: s.demandRef, demandRemarks: s.demandRemarks, demandBy: s.demandBy });
    this.quote.set(null); this.signature = '';
  }

  toggle(pid: number) {
    const sel = new Set(this.s().selected);
    sel.has(pid) ? sel.delete(pid) : sel.add(pid);
    this.patch({ selected: [...sel] });
  }
  select(pid: number) { if (!this.selected().has(pid)) this.patch({ selected: [...this.s().selected, pid] }); }
  deselect(pid: number) { this.patch({ selected: this.s().selected.filter(x => x !== pid) }); }
  only(pid: number) { this.patch({ selected: [pid] }); }

  sleeveOf(pid: number): Sleeve { return this.s().sleeve[pid] ?? 'FULL'; }
  setSleeve(pid: number, sl: Sleeve) { this.patch({ sleeve: { ...this.s().sleeve, [pid]: sl } }); }
  qtyOf(pid: number, colorId: number, size: string, sleeve: Sleeve, cart: Cart = 'qty') { return this.s()[cart][cellKey(pid, colorId, size, sleeve)] ?? 0; }
  setQty(pid: number, colorId: number, size: string, sleeve: Sleeve, qty: number, cart: Cart = 'qty') {
    const q = { ...this.s()[cart] }, k = cellKey(pid, colorId, size, sleeve);
    const v = Math.max(0, Math.min(9999, Math.floor(qty) || 0));
    if (v) q[k] = v; else delete q[k];
    this.patch(cart === 'qty' ? { qty: q } : { demand: q });
    if (cart === 'qty') this.quote.set(null);
  }
  clearProduct(pid: number, cart: Cart = 'qty') {
    const q = Object.fromEntries(Object.entries(this.s()[cart]).filter(([k]) => !k.startsWith(pid + '|')));
    this.patch(cart === 'qty' ? { qty: q } : { demand: q });
  }
  /** Keeps only quantities in IN_STOCK cells for a product. */
  keepInStock(p: MatrixProduct) {
    const q = { ...this.s().qty };
    for (const k of Object.keys(q)) {
      const [pid, colorId, size] = k.split('|');
      if (+pid !== p.id) continue;
      if (p.colors.find(c => c.id === +colorId)?.stock[size] !== 'IN_STOCK') delete q[k];
    }
    this.patch({ qty: q });
  }

  setTerms(t: Persisted['terms']) { this.patch({ terms: t }); }
  setInstructions(v: string) { this.patch({ instructions: v }); }
  setTransport(t: Partial<Persisted['transport']>) { this.patch({ transport: { ...this.s().transport, ...t } }); }

  setDemandMode(on: boolean) { this.patch({ demandMode: on }); }
  setDemandRemarks(v: string) { this.patch({ demandRemarks: v }); }
  setDemandBy(v: string) { this.patch({ demandBy: v }); }
  /** After a demand is submitted: the stock order (if any) stays in the cart. */
  clearDemand() { this.patch({ demand: {}, demandMode: false, demandRef: crypto.randomUUID(), demandRemarks: '', demandBy: '' }); }

  lines(cart: Cart = 'qty'): OrderLineInput[] {
    const sel = this.selected();
    return Object.entries(this.s()[cart]).map(([k, qty]) => {
      const [pid, colorId, size, sleeve] = k.split('|');
      return { productId: +pid, colorId: +colorId, size, sleeve: sleeve as Sleeve, qty };
    }).filter(l => sel.has(l.productId) && l.qty > 0);
  }
  /** Client-side live totals (the server re-prices authoritatively). */
  productTotals(p: MatrixProduct, cart: Cart = 'qty') {
    let qty = 0, amount = 0;
    for (const [k, v] of Object.entries(this.s()[cart])) {
      const [pid, , , sleeve] = k.split('|');
      if (+pid !== p.id) continue;
      qty += v; amount += v * (sleeve === 'HALF' ? p.halfRate : p.factoryRate);
    }
    return { qty, amount };
  }
  private cartTotals(cart: Cart) {
    const m = this.matrix(), sel = this.selected();
    let qty = 0, amount = 0, mrp = 0, products = 0;
    for (const p of m?.products ?? []) {
      if (!sel.has(p.id)) continue;
      const t = this.productTotals(p, cart);
      if (t.qty) products++;
      qty += t.qty; amount += t.amount; mrp += t.qty * p.mrp;
    }
    return { qty, amount, mrp, products };
  }
  readonly totals = computed(() => this.cartTotals('qty'));
  readonly demandTotals = computed(() => this.cartTotals('demand'));

  async loadMatrix() {
    const ids = [...this.selected()];
    const have = new Set(this.matrix()?.products.map(p => p.id));
    if (!ids.length) { this.matrix.set(null); return; }
    if (ids.every(id => have.has(id))) return;
    let m = await this.api.get<Matrix>('/products/matrix', { ids: ids.join(',') });
    // Preload same-price alternates (hidden until selected) so stock-low suggestions can name them.
    const alts = m.products.map(p => p.altProductId).filter((a): a is number => !!a && !ids.includes(a));
    if (alts.length) m = await this.api.get<Matrix>('/products/matrix', { ids: [...ids, ...new Set(alts)].join(',') });
    this.matrix.set(m);
  }
  /** Submits the demand cart. `demandRef` makes a retried or double-tapped submit return the same demand. */
  async placeDemand(lat?: number, lng?: number) {
    const s = this.s();
    return this.api.post<DemandOrder>('/demand-orders', {
      clientRef: s.demandRef, outletId: s.outlet!.id, lines: this.lines('demand'),
      remarks: s.demandRemarks.trim() || undefined, expectedBy: s.demandBy || undefined, lat, lng,
    });
  }
  async fetchQuote() {
    const q = await this.api.post<Quote>('/orders/quote', { outletId: this.outlet()!.id, lines: this.lines(), paymentTerms: this.s().terms });
    this.quote.set(q);
    return q;
  }
  async place(lat?: number, lng?: number) {
    const s = this.s();
    return this.api.post<Order>('/orders', {
      clientRef: s.clientRef, outletId: s.outlet!.id, lines: this.lines(), paymentTerms: s.terms,
      instructions: s.instructions.trim() || undefined, signature: this.signature || undefined,
      transport: { mode: s.transport.mode, transporter: s.transport.transporter.trim(), destination: s.transport.destination.trim(),
                   deliveryDate: s.transport.immediate ? todayIso() : s.transport.deliveryDate },
      lat, lng,
    });
  }
}
