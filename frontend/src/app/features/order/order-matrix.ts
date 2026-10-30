import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { MatrixProduct, ProductColor, Sleeve, StockStatus } from '../../core/models';
import { InrPipe, STOCK_LABEL, STOCK_TONE } from '../../core/format';
import { AppBar, StateView } from '../../shared/ui.components';
import { OrderStore } from './order.store';

interface KCtx { pid: number; colorId: number; size: string; mode: 'single' | 'all' }
const LEGEND: { st: StockStatus; c: string; lbl: string }[] = [
  { st: 'STOPPED', c: '#991b1bcc', lbl: 'Stopped' }, { st: 'IN_STOCK', c: 'rgba(16,185,129,.6)', lbl: 'In Stock' },
  { st: 'OOS_15', c: 'rgba(239,68,68,.5)', lbl: 'OOS ~15d' }, { st: 'REFILL_13', c: 'rgba(234,179,8,.6)', lbl: '~13d' }, { st: 'REFILL_30', c: 'rgba(59,130,246,.5)', lbl: '~30d' },
];

@Component({
  selector: 'app-order-matrix',
  imports: [FormsModule, AppBar, StateView, InrPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Order Matrix" [sub]="store.outlet()?.name" fallback="/order">
      <button class="bar-preview" type="button" [disabled]="!store.totals().qty" (click)="preview()">Preview →</button>
      <button class="bico" type="button" (click)="router.navigateByUrl('/order')" aria-label="Add products">＋</button>
    </app-bar>
    <div class="body pad" id="mx-body">
      <app-state [loading]="loading()" [error]="err()" (retry)="load()">
        @for (p of products(); track p.id) {
          <div class="card" style="margin-bottom:9px;overflow:hidden" [id]="'mp-' + p.id">
            <button type="button" class="lrow" style="border-bottom:0" [attr.aria-expanded]="isOpen(p.id)" (click)="toggleOpen(p.id)">
              <span class="chip xs c-green" style="padding:3px 6px">{{ isOpen(p.id) ? '▾' : '▸' }}</span>
              <span style="font-size:20px">{{ p.icon }}</span>
              <div class="lr-main">
                <div class="row" style="gap:6px;flex-wrap:wrap"><b style="font-size:13px">{{ p.name }}</b>
                  @if (p.scheme) { <span class="chip xs c-amber" role="button" tabindex="0" (click)="$event.stopPropagation(); ui.toast('🎁 ' + p.name + ': ' + p.scheme.text)">🎁 OFFER</span>
                    @if (nudge(p); as n) { <span class="sn-mini" [class.win]="n.win">{{ n.text }}</span> } }
                  @if (p.nonReturnable) { <span class="chip xs c-red">Non-ret</span> }
                  @if (compare()?.alternate === p.id && totals(p).qty) {
                    <span class="row" style="gap:5px"><button type="button" class="pillbtn" style="padding:3px 8px;font-size:10px" (click)="$event.stopPropagation(); useOriginal()">↺ Use</button>
                      <button type="button" class="pillbtn on" style="padding:3px 8px;font-size:10px;background:linear-gradient(135deg,#7c3aed,#db2777);border:0" (click)="$event.stopPropagation(); useAlternate()">✓ Alter</button></span>
                  }</div>
                <span>{{ p.brand }} · {{ p.colors.length }} colours · FR {{ p.factoryRate | inr }} · MRP {{ p.mrp | inr }}</span>
              </div>
              <div style="text-align:right"><div style="font-size:17px;font-weight:800;line-height:1">{{ totals(p).qty }}</div><div style="font-size:11px;color:var(--g);font-weight:700">{{ totals(p).amount | inr }}</div></div>
            </button>
            @if (totals(p).qty > 0 && totals(p).qty < p.moq) { <div class="chip c-red" style="margin:0 12px 8px">⚠ MOQ is {{ p.moq }} — add {{ p.moq - totals(p).qty }} more</div> }
            @if (p.altProductId && stock(p); as s) {
              <div class="stock-ind" [class.ok]="!s.warn" [class.warn]="s.warn">
                <div class="wrap" style="gap:5px">@for (c of s.chips; track c.tone) { <span class="qchip {{ c.tone }}"><i></i>{{ c.qty }}</span> }</div>
                <div class="row" style="gap:7px;flex-wrap:wrap">
                  @if (!s.warn) { <span class="si-tag ok">✓ Stock available</span> }
                  @else {
                    <span class="si-tag warn">⚠ Stock low</span>
                    @if (compare()?.alternate !== p.id && alt(p); as a) {
                      <button type="button" class="si-alt" (click)="openAlternate(p, a.id)">Try {{ a.name }} →</button><span class="tiny">same price {{ a.factoryRate | inr }}</span>
                    }
                  }
                </div>
              </div>
            }
            @if (isOpen(p.id)) {
              <div style="border-top:1px solid var(--brd);padding:8px 10px">
                @if (p.hasSleeves) {
                  <div class="seg mb12">@for (sl of sleeves; track sl[0]) { <button type="button" [class.on]="store.sleeveOf(p.id) === sl[0]" (click)="store.setSleeve(p.id, sl[0]); closeKpad()">{{ sl[1] }} · {{ (sl[0] === 'HALF' ? p.halfRate : p.factoryRate) | inr }}</button> }</div>
                }
                @if (kctx()?.mode === 'all' && kctx()?.pid === p.id) {
                  <div class="asz-banner">📐 All-Sizes Mode: {{ colorName(p, kctx()!.colorId) }} <span style="flex:1;font-weight:500;opacity:.85">Qty fills all sizes</span><button type="button" (click)="closeKpad()">✕ Clear</button></div>
                }
                <div class="row mb12 mx-tools" style="gap:6px">
                  <div class="sbox" style="flex:1;padding:6px 10px"><span>🔍</span><input [ngModel]="colorQuery()[p.id] || ''" (ngModelChange)="setQuery(p.id, $event)" placeholder="Search colour…" [attr.aria-label]="'Search colour in ' + p.name"></div>
                  <div class="seg" style="padding:2px">@for (c of cats; track c[0]) { <button type="button" style="padding:6px 8px;font-size:10px" [class.on]="(catSel()[p.id] || 'all') === c[0]" (click)="setCat(p.id, c[0])">{{ c[1] }}</button> }</div>
                </div>
                <div class="wrap" style="gap:5px 10px;margin-bottom:6px">
                  @for (l of legend; track l.st) { <span style="display:flex;align-items:center;gap:3px;font-size:9px;color:#6b7280;font-weight:600"><span style="width:8px;height:8px;border-radius:2px" [style.background]="l.c"></span>{{ l.lbl }}@if (tally(p, l.st); as n) {<b class="sn-mini" style="padding:0 4px">{{ n }}</b>}</span> }
                </div>
                <div style="overflow-x:auto">
                  <div class="mx-gridwrap" style="min-width:330px">
                    <div style="display:grid;grid-template-columns:84px repeat(6,1fr);gap:4px;align-items:center;margin-bottom:5px;background:var(--gdk);border-radius:8px;padding:6px 6px">
                      <span style="font-size:10px;color:rgba(255,255,255,.7);font-weight:600">Colour</span>@for (s of sizes(); track s) { <span style="text-align:center;font-weight:800;color:#fff;font-size:11px">{{ s }}</span> }
                    </div>
                    @for (c of visibleColors(p); track c.id) {
                      <div style="display:grid;grid-template-columns:84px repeat(6,1fr);gap:4px;align-items:center;margin-bottom:4px">
                        <button type="button" class="mx-lbl" [class.asz]="kctx()?.mode === 'all' && kctx()?.pid === p.id && kctx()?.colorId === c.id" (click)="allSizes(p, c)" [attr.aria-label]="'Fill all sizes of ' + c.name">
                          <span style="width:12px;height:12px;border-radius:50%;flex-shrink:0;border:1.5px solid rgba(0,0,0,.12)" [style.background]="c.hex"></span>
                          <span style="min-width:0"><span style="display:block;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ c.name }}</span><span style="display:block;font-size:9px;color:var(--t3);white-space:nowrap">{{ c.code }}</span></span>
                        </button>
                        @for (sz of sizes(); track sz) {
                          <button type="button" class="mx-cell" [class.stopped]="c.stock[sz] === 'STOPPED'" [class.has]="q(p.id, c.id, sz) > 0" [class.sel]="isSel(p.id, c.id, sz)" [class.asz]="isAsz(p.id, c.id)"
                                  [disabled]="c.stock[sz] === 'STOPPED'" [title]="stockLabel[c.stock[sz]]" [attr.aria-label]="c.name + ' size ' + sz + ', ' + stockLabel[c.stock[sz]] + ', quantity ' + q(p.id, c.id, sz)"
                                  (click)="pick(p, c, sz)">
                            <span class="sb s-{{ tone[c.stock[sz]] }}"></span>{{ c.stock[sz] === 'STOPPED' ? '✕' : q(p.id, c.id, sz) || '—' }}
                          </button>
                        }
                      </div>
                    } @empty { <div class="empty">No colours match.</div> }
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </app-state>
    </div>
    @if (kctx(); as k) {
      <div style="flex-shrink:0;background:#fff;border-top:1px solid var(--brd);padding:8px 12px 11px">
        <div class="between" style="margin-bottom:6px">
          <div style="min-width:0"><div class="tiny" style="font-weight:700;text-transform:uppercase">{{ kLabel() }}</div><div style="font-size:11px;font-weight:800">{{ kCtxText() }}</div></div>
          <div class="row" style="gap:8px"><div style="font-size:23px;font-weight:800" [style.color]="kval() ? 'var(--t1)' : 'var(--t3)'">{{ kval() || '—' }}</div>
            <button type="button" class="pillbtn" style="padding:4px 9px" (click)="closeKpad()" aria-label="Close keypad">✕</button></div>
        </div>
        <div class="row" style="gap:6px;margin-bottom:6px">
          <span class="tiny" style="font-weight:700">Quick:</span>
          @for (n of [3, 6, 12, 24]; track n) { <button class="pillbtn" type="button" style="padding:5px 12px" (click)="quick(n)">{{ n }}</button> }
          <button class="pillbtn" type="button" style="padding:5px 12px;margin-left:auto" (click)="quick(0)">Clear</button>
        </div>
        <div class="row" style="gap:6px;margin-bottom:6px"><button class="btns" type="button" style="flex:1;padding:6px" (click)="adj(-1)" aria-label="Decrease">−</button>
          <div style="flex:2;text-align:center;font-size:16px;font-weight:800">{{ +kval() || 0 }}</div><button class="btns" type="button" style="flex:1;padding:6px" (click)="adj(1)" aria-label="Increase">+</button></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px">
          @for (n of [1,2,3,4,5,6,7,8,9]; track n) { <button class="btns" type="button" style="padding:8px" (click)="key(n)">{{ n }}</button> }
          <button class="btns" type="button" style="padding:8px;color:var(--r);background:var(--r2)" (click)="del()" aria-label="Delete">⌫</button>
          <button class="btns" type="button" style="padding:8px" (click)="key(0)">0</button>
          <button class="btnp" type="button" style="padding:8px" (click)="ok()" aria-label="Confirm">✓</button>
        </div>
      </div>
    }
    <div class="bbar" style="padding:9px 12px;background:var(--gdk);color:#fff">
      @for (t of liveTotals(); track t[0]) {
        <div style="flex:1;text-align:center"><div style="font-size:9px;opacity:.6;font-weight:600;text-transform:uppercase">{{ t[0] }}</div><div style="font-size:14px;font-weight:800" [style.color]="t[0] === 'Amount' ? '#4ade80' : ''">{{ t[1] }}</div></div>
      }
    </div>`,
})
export class OrderMatrixPage {
  focus = input<string>();
  store = inject(OrderStore);
  ui = inject(Ui);
  router = inject(Router);
  loading = signal(true);
  err = signal<string | null>(null);
  opened = signal(new Set<number>());
  kctx = signal<KCtx | null>(null);
  kval = signal('');
  colorQuery = signal<Record<number, string>>({});
  catSel = signal<Record<number, string>>({});
  compare = signal<{ original: number; alternate: number } | null>(null);
  sleeves: [Sleeve, string][] = [['FULL', 'Full Sleeve'], ['HALF', 'Half Sleeve']];
  cats: [string, string][] = [['all', 'All'], ['core', 'Core'], ['noncore', 'Non-Core']];
  legend = LEGEND;
  tone = STOCK_TONE;
  stockLabel = STOCK_LABEL;
  sizes = computed(() => this.store.matrix()?.sizes ?? []);
  products = computed(() => (this.store.matrix()?.products ?? []).filter(p => this.store.selected().has(p.id)));
  liveTotals = computed(() => {
    const t = this.store.totals();
    return [['Products', String(t.products)], ['Total Qty', String(t.qty)], ['Amount', '₹' + t.amount.toLocaleString('en-IN')], ['MRP Value', '₹' + t.mrp.toLocaleString('en-IN')]];
  });

  constructor() {
    if (!this.store.outlet()) { this.router.navigateByUrl('/outlets'); return; }
    this.load();
  }
  async load() {
    this.loading.set(true); this.err.set(null);
    try {
      await this.store.loadMatrix();
      const f = Number(this.focus()) || this.products()[0]?.id;
      if (f) { this.opened.set(new Set([...this.opened(), f])); setTimeout(() => this.scrollTo(f), 80); }
    } catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  private scrollTo(pid: number) {
    const body = document.getElementById('mx-body'), el = document.getElementById('mp-' + pid);
    if (body && el) body.scrollTo({ top: body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top - 6, behavior: 'smooth' });
  }

  isOpen = (pid: number) => this.opened().has(pid);
  toggleOpen(pid: number) { const s = new Set(this.opened()); s.has(pid) ? s.delete(pid) : s.add(pid); this.opened.set(s); if (!s.has(pid)) this.closeKpad(); }
  totals = (p: MatrixProduct) => this.store.productTotals(p);
  q = (pid: number, colorId: number, size: string) => this.store.qtyOf(pid, colorId, size, this.store.sleeveOf(pid));
  isSel = (pid: number, colorId: number, size: string) => { const k = this.kctx(); return !!k && k.mode === 'single' && k.pid === pid && k.colorId === colorId && k.size === size; };
  isAsz = (pid: number, colorId: number) => { const k = this.kctx(); return !!k && k.mode === 'all' && k.pid === pid && k.colorId === colorId; };
  colorName = (p: MatrixProduct, id: number) => p.colors.find(c => c.id === id)?.name ?? '';
  setQuery(pid: number, v: string) { this.colorQuery.set({ ...this.colorQuery(), [pid]: v }); }
  setCat(pid: number, v: string) { this.catSel.set({ ...this.catSel(), [pid]: v }); }
  visibleColors(p: MatrixProduct) {
    const q = (this.colorQuery()[p.id] || '').trim().toLowerCase(), cat = this.catSel()[p.id] || 'all';
    const inCat = (c: ProductColor) => cat === 'all' || (cat === 'core') === c.isCore;
    const list = p.colors.filter(inCat);
    if (!q) return list;
    return list.filter(c => (c.code + ' ' + c.name).toLowerCase().includes(q));   // matches rise to the top by filtering
  }
  tally(p: MatrixProduct, st: StockStatus) {
    const sl = this.store.sleeveOf(p.id);
    let n = 0;
    for (const c of p.colors) for (const s of this.sizes()) if (c.stock[s] === st) n += this.store.qtyOf(p.id, c.id, s, sl);
    return n;
  }
  /** Scheme nudge: "+n → k FREE" or "🎉 k FREE". */
  nudge(p: MatrixProduct) {
    const t = this.totals(p).qty, buy = p.scheme?.buyQty ?? 0, free = p.scheme?.freeQty ?? 0;
    if (!t || !buy) return null;
    const earned = Math.floor(t / buy) * free, rem = t % buy;
    return rem === 0 ? { text: `🎉 ${earned} FREE`, win: true } : { text: `+${buy - rem} → ${earned + free} FREE`, win: false };
  }
  /** Ordered qty split by stock status across both sleeves; warn when restock demand exceeds in-stock demand. */
  stock(p: MatrixProduct) {
    const sums: Record<string, number> = { green: 0, lightred: 0, yellow: 0, blue: 0 };
    let total = 0;
    for (const [k, v] of Object.entries(this.store.state().qty)) {
      const [pid, colorId, size] = k.split('|');
      if (+pid !== p.id) continue;
      const st = p.colors.find(c => c.id === +colorId)?.stock[size];
      const tone = st ? STOCK_TONE[st] : null;
      if (tone && tone in sums) { sums[tone] += v; total += v; }
    }
    if (!total) return null;
    const restock = sums['lightred'] + sums['yellow'] + sums['blue'];
    return { warn: restock > sums['green'], chips: Object.entries(sums).filter(([, n]) => n > 0).map(([tone, qty]) => ({ tone, qty })) };
  }
  alt(p: MatrixProduct) {
    const all = this.store.matrix()?.products ?? [];
    return all.find(x => x.id === p.altProductId) ?? { id: p.altProductId!, name: 'alternate', factoryRate: p.factoryRate };
  }
  async openAlternate(p: MatrixProduct, altId: number) {
    this.store.select(altId);
    this.compare.set({ original: p.id, alternate: altId });
    await this.load();
    this.opened.set(new Set([...this.opened(), altId]));
    setTimeout(() => this.scrollTo(altId), 80);
  }
  /** "↺ Use" — keep the previous product's in-stock quantities; both products stay on the order. */
  useOriginal() {
    const c = this.compare(); if (!c) return;
    const orig = this.store.matrix()?.products.find(x => x.id === c.original);
    if (orig) this.store.keepInStock(orig);
    this.compare.set(null);
    this.ui.toast('Kept in-stock quantities of the original product');
  }
  /** "✓ Alter" — drop the previous product and its quantities; keep the alternate. */
  useAlternate() {
    const c = this.compare(); if (!c) return;
    this.store.clearProduct(c.original);
    this.store.deselect(c.original);
    this.compare.set(null);
    this.ui.toast('Switched to the alternate product');
  }

  /* ── keypad ── */
  /** True until the first digit after opening a cell: that digit replaces the old quantity instead of appending to it. */
  private fresh = true;
  pick(p: MatrixProduct, c: ProductColor, sz: string) {
    if (c.stock[sz] === 'STOPPED') return;
    this.kctx.set({ pid: p.id, colorId: c.id, size: sz, mode: 'single' });
    const v = this.q(p.id, c.id, sz);
    this.kval.set(v ? String(v) : '');
    this.fresh = true;
  }
  allSizes(p: MatrixProduct, c: ProductColor) {
    const k = this.kctx();
    if (k?.mode === 'all' && k.pid === p.id && k.colorId === c.id) { this.closeKpad(); return; }
    const first = this.sizes().find(s => c.stock[s] !== 'STOPPED');
    if (!first) { this.ui.error(`${c.name} is stopped in every size`); return; }
    this.kctx.set({ pid: p.id, colorId: c.id, size: first, mode: 'all' });
    const v = this.q(p.id, c.id, first);
    this.kval.set(v ? String(v) : '');
    this.fresh = true;
  }
  kLabel() {
    const k = this.kctx()!, p = this.products().find(x => x.id === k.pid)!, sl = this.store.sleeveOf(k.pid) === 'HALF' ? 'Half Sleeve' : 'Full Sleeve';
    return k.mode === 'all' ? `All sizes · ${p.hasSleeves ? sl + ' · ' : ''}${this.colorName(p, k.colorId)}` : `Size ${k.size} · ${p.hasSleeves ? sl + ' · ' : ''}${this.colorName(p, k.colorId)}`;
  }
  kCtxText() {
    const k = this.kctx()!, p = this.products().find(x => x.id === k.pid)!;
    const price = this.store.sleeveOf(k.pid) === 'HALF' ? p.halfRate : p.factoryRate;
    return `₹${price}/pc — ${k.mode === 'all' ? 'qty fills all sizes' : 'single cell'} · typing replaces the quantity`;
  }
  private commit() {
    const k = this.kctx(); if (!k) return;
    const p = this.products().find(x => x.id === k.pid)!, c = p.colors.find(x => x.id === k.colorId)!, sl = this.store.sleeveOf(k.pid), v = +this.kval() || 0;
    if (k.mode === 'all') for (const s of this.sizes()) { if (c.stock[s] !== 'STOPPED') this.store.setQty(p.id, c.id, s, sl, v); }
    else this.store.setQty(p.id, c.id, k.size, sl, v);
    if (p.scheme?.buyQty && this.totals(p).qty >= p.scheme.buyQty && v) {
      const n = this.nudge(p); if (n?.win) this.ui.toast(`🎁 ${p.name} scheme unlocked: ${p.scheme.text}`);
    }
  }
  key(n: number) {
    const base = this.fresh || this.kval() === '0' ? '' : this.kval();
    this.fresh = false;
    if (base.length >= 3) { this.ui.toast('Maximum 999 pcs per cell'); return; }
    this.kval.set(base + n);
    this.commit();
  }
  del() { this.fresh = false; this.kval.set(this.kval().slice(0, -1)); this.commit(); }
  adj(d: number) { this.fresh = false; const v = Math.max(0, Math.min(999, (+this.kval() || 0) + d)); this.kval.set(v ? String(v) : ''); this.commit(); }
  /** Quick quantities for common pack sizes. */
  quick(n: number) { this.fresh = false; this.kval.set(String(n)); this.commit(); }
  ok() {
    const k = this.kctx(); if (!k) return;
    if (k.mode === 'all') { this.closeKpad(); return; }
    const p = this.products().find(x => x.id === k.pid)!, c = p.colors.find(x => x.id === k.colorId)!;
    const rest = this.sizes().slice(this.sizes().indexOf(k.size) + 1).find(s => c.stock[s] !== 'STOPPED');
    if (rest) this.pick(p, c, rest); else this.closeKpad();
  }
  closeKpad() { this.kctx.set(null); this.kval.set(''); }

  preview() {
    const short = this.products().filter(p => { const t = this.totals(p).qty; return t > 0 && t < p.moq; });
    if (short.length) { this.ui.error(`⚠ ${short[0].name}: minimum order is ${short[0].moq} pcs`); return; }
    this.closeKpad();
    this.router.navigateByUrl('/order/summary');
  }
}
