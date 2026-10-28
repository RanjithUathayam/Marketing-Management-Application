import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Api } from '../../core/api.service';
import { Matrix, MatrixProduct, Order, OrderLineInput, Outlet, Quote, Sleeve } from '../../core/models';
import { todayIso } from '../../core/format';

const KEY = 'mma.cart';
const cellKey = (pid: number, colorId: number, size: string, sleeve: Sleeve) => `${pid}|${colorId}|${size}|${sleeve}`;

interface Persisted {
  outlet: Outlet | null; selected: number[]; qty: Record<string, number>; sleeve: Record<number, Sleeve>;
  terms: 'CREDIT' | 'CASH' | 'ONLINE'; instructions: string; clientRef: string;
  transport: { mode: 'Lorry' | 'Van' | 'Bus'; transporter: string; destination: string; deliveryDate: string; immediate: boolean };
}
const fresh = (outlet: Outlet | null = null): Persisted => ({
  outlet, selected: [], qty: {}, sleeve: {}, terms: 'CREDIT', instructions: '', clientRef: crypto.randomUUID(),
  transport: { mode: 'Lorry', transporter: '', destination: outlet?.area ?? '', deliveryDate: todayIso(), immediate: true },
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
  qtyOf(pid: number, colorId: number, size: string, sleeve: Sleeve) { return this.s().qty[cellKey(pid, colorId, size, sleeve)] ?? 0; }
  setQty(pid: number, colorId: number, size: string, sleeve: Sleeve, qty: number) {
    const q = { ...this.s().qty }, k = cellKey(pid, colorId, size, sleeve);
    const v = Math.max(0, Math.min(9999, Math.floor(qty) || 0));
    if (v) q[k] = v; else delete q[k];
    this.patch({ qty: q });
    this.quote.set(null);
  }
  clearProduct(pid: number) {
    const q = Object.fromEntries(Object.entries(this.s().qty).filter(([k]) => !k.startsWith(pid + '|')));
    this.patch({ qty: q });
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

  lines(): OrderLineInput[] {
    const sel = this.selected();
    return Object.entries(this.s().qty).map(([k, qty]) => {
      const [pid, colorId, size, sleeve] = k.split('|');
      return { productId: +pid, colorId: +colorId, size, sleeve: sleeve as Sleeve, qty };
    }).filter(l => sel.has(l.productId) && l.qty > 0);
  }
  /** Client-side live totals (the server re-prices authoritatively). */
  productTotals(p: MatrixProduct) {
    let qty = 0, amount = 0;
    for (const [k, v] of Object.entries(this.s().qty)) {
      const [pid, , , sleeve] = k.split('|');
      if (+pid !== p.id) continue;
      qty += v; amount += v * (sleeve === 'HALF' ? p.halfRate : p.factoryRate);
    }
    return { qty, amount };
  }
  readonly totals = computed(() => {
    const m = this.matrix(), sel = this.selected();
    let qty = 0, amount = 0, mrp = 0, products = 0;
    for (const p of m?.products ?? []) {
      if (!sel.has(p.id)) continue;
      const t = this.productTotals(p);
      if (t.qty) products++;
      qty += t.qty; amount += t.amount; mrp += t.qty * p.mrp;
    }
    return { qty, amount, mrp, products };
  });

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
