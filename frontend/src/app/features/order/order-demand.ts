import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Geo } from '../../core/geo.service';
import { Ui } from '../../core/ui.service';
import { DemandLine, DemandList, DemandOrder, DemandReportRow, DemandStatus, MatrixProduct, Product, ProductColor, Sleeve, TeamMember } from '../../core/models';
import { DEMAND_STAGES, DtPipe, DPipe, InrPipe, demandStage, demandStockLabel, todayIso } from '../../core/format';
import { AppBar, Sheet, StateView, StatusPill } from '../../shared/ui.components';
import { OrderStore } from './order.store';

interface ReviewLine { key: string; p: MatrixProduct; c: ProductColor; size: string; sleeve: Sleeve; qty: number; price: number; stockQty: number; stockText: string }

/* ── Review & submit (after the matrix in Demand Order mode) ── */
@Component({
  selector: 'app-demand-review',
  imports: [FormsModule, AppBar, StateView, InrPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Demand Order" [sub]="store.outlet()?.name" fallback="/order/matrix" />
    <div class="body pad narrow">
      <div class="dmd-banner"><span class="dmd-ic">📝</span>
        <div><b>A requirement, not a stock order</b><span>Sent to your manager for review. Stock is not reserved or reduced — when stock arrives the demand is fulfilled through a regular order.</span></div></div>
      <app-state [loading]="loading()" [error]="err()" (retry)="load()">
        @for (g of groups(); track g.p.id) {
          <div class="card mb12" style="overflow:hidden">
            <div class="lrow" style="cursor:default">
              <span style="font-size:20px">{{ g.p.icon }}</span>
              <div class="lr-main"><b>{{ g.p.name }} <span class="dm-tag">Demand</span></b><span>{{ g.qty }} pcs · {{ g.amount | inr }} · FR {{ g.p.factoryRate | inr }}</span></div>
              <button type="button" class="dm-x" (click)="removeProduct(g.p)" [attr.aria-label]="'Remove ' + g.p.name + ' from the demand'">✕</button>
            </div>
            <div class="dm-scroll"><table class="dm-table">
              <thead><tr><th>Colour</th><th>Size</th>@if (g.p.hasSleeves) {<th>Sleeve</th>}<th>Stock now</th><th>Requested</th><th class="n">Unit price</th><th class="n">Amount</th><th></th></tr></thead>
              <tbody>
                @for (l of g.lines; track l.key) {
                  <tr>
                    <td><span class="sw" [style.background]="l.c.hex"></span>{{ l.c.name }} <span class="tiny">{{ l.c.code }}</span></td>
                    <td><b>{{ l.size }}</b></td>
                    @if (g.p.hasSleeves) { <td>{{ l.sleeve === 'HALF' ? 'Half' : 'Full' }}</td> }
                    <td><span class="dm-stk" [class.none]="!l.stockQty">{{ l.stockText }}</span></td>
                    <td><div class="dm-step">
                      <button type="button" (click)="bump(l, -1)" [disabled]="l.qty <= 1" aria-label="Decrease">−</button>
                      <input type="number" min="1" max="9999" inputmode="numeric" [class.err]="bad().has(l.key)" [ngModel]="l.qty" (ngModelChange)="setQty(l, $event)"
                             [attr.aria-label]="'Requested quantity, ' + l.c.name + ' size ' + l.size">
                      <button type="button" (click)="bump(l, 1)" aria-label="Increase">+</button></div></td>
                    <td class="n">{{ l.price | inr }}</td>
                    <td class="n"><b>{{ l.qty * l.price | inr }}</b></td>
                    <td><button type="button" class="dm-x" (click)="remove(l)" [attr.aria-label]="'Remove ' + l.c.name + ' size ' + l.size">✕</button></td>
                  </tr>
                }
              </tbody>
            </table></div>
          </div>
        } @empty {
          <div class="card p empty mb12">No demand items yet. In the Order Matrix turn on <b>📝 Demand Order</b> and enter quantities.</div>
        }
        <button class="btn ghost mb12" type="button" (click)="addProducts()">＋ Add products</button>
        <div class="card p">
          <div class="fld"><label for="dby">Required by <span class="tiny">(optional)</span></label>
            <input id="dby" type="date" [min]="today" [ngModel]="store.state().demandBy" (ngModelChange)="store.setDemandBy($event)"></div>
          <div class="fld" style="margin-bottom:0"><label for="drm">Remarks <span class="tiny">(optional)</span></label>
            <textarea id="drm" maxlength="500" [ngModel]="store.state().demandRemarks" (ngModelChange)="store.setDemandRemarks($event)" placeholder="Customer requirement, occasion, alternative colours…"></textarea></div>
        </div>
      </app-state>
    </div>
    <div class="bbar"><div class="bb-info"><div class="bb-lbl">{{ t().products }} product{{ t().products === 1 ? '' : 's' }} · {{ t().qty }} pcs · est. value</div><div class="bb-amt">{{ t().amount | inr }}</div></div>
      <button class="btns" type="button" (click)="router.navigateByUrl('/order/matrix')">Edit</button>
      <button class="btnp dmd" type="button" [disabled]="busy() || !t().qty" (click)="submit()">{{ busy() ? 'Submitting…' : 'Submit Demand →' }}</button></div>`,
})
export class DemandReviewPage {
  store = inject(OrderStore);
  router = inject(Router);
  private ui = inject(Ui);
  private geo = inject(Geo);
  today = todayIso();
  loading = signal(true);
  err = signal<string | null>(null);
  busy = signal(false);
  /** Cells whose typed quantity is not a whole number above zero. */
  bad = signal(new Set<string>());
  t = this.store.demandTotals;
  groups = computed(() => {
    const m = this.store.matrix(), lines = this.store.lines('demand');
    return (m?.products ?? []).map(p => {
      const ls: ReviewLine[] = lines.filter(l => l.productId === p.id).flatMap(l => {
        const c = p.colors.find(x => x.id === l.colorId);
        if (!c) return [];
        const stockQty = c.qty[l.size] ?? 0;
        return [{ key: `${p.id}|${c.id}|${l.size}|${l.sleeve}`, p, c, size: l.size, sleeve: l.sleeve, qty: l.qty,
          price: l.sleeve === 'HALF' ? p.halfRate : p.factoryRate, stockQty,
          stockText: demandStockLabel({ status: c.stock[l.size] ?? 'NONE', qty: stockQty }) }];
      });
      const sizes = m?.sizes ?? [];
      ls.sort((a, b) => a.c.name.localeCompare(b.c.name) || a.sleeve.localeCompare(b.sleeve) || sizes.indexOf(a.size) - sizes.indexOf(b.size));
      return { p, lines: ls, qty: ls.reduce((s, l) => s + l.qty, 0), amount: ls.reduce((s, l) => s + l.qty * l.price, 0) };
    }).filter(g => g.lines.length);
  });

  constructor() {
    if (!this.store.outlet()) { this.router.navigateByUrl('/outlets'); return; }
    this.load();
  }
  async load() {
    this.loading.set(true); this.err.set(null);
    try { await this.store.loadMatrix(); } catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  private put(l: ReviewLine, qty: number) { this.store.setQty(l.p.id, l.c.id, l.size, l.sleeve, qty, 'demand'); }
  private mark(key: string, isBad: boolean) {
    const s = new Set(this.bad());
    isBad ? s.add(key) : s.delete(key);
    this.bad.set(s);
  }
  setQty(l: ReviewLine, v: unknown) {
    const n = Number(v);
    const ok = Number.isInteger(n) && n >= 1 && n <= 9999;
    this.mark(l.key, !ok);
    if (ok) this.put(l, n);
  }
  bump(l: ReviewLine, d: number) { this.mark(l.key, false); this.put(l, Math.max(1, Math.min(9999, l.qty + d))); }
  remove(l: ReviewLine) { this.mark(l.key, false); this.put(l, 0); }
  async removeProduct(p: MatrixProduct) {
    if (!(await this.ui.confirm({ title: `Remove ${p.name} from the demand?`, message: 'Its demand quantities are cleared. Your stock order is not affected.', confirmText: 'Remove', danger: true }))) return;
    this.store.clearProduct(p.id, 'demand');
    this.bad.set(new Set([...this.bad()].filter(k => !k.startsWith(p.id + '|'))));
  }
  addProducts() { this.store.setDemandMode(true); this.router.navigateByUrl('/order'); }

  async submit() {
    if (this.bad().size) { this.ui.error('Requested quantity must be greater than zero'); return; }
    const t = this.t(), by = this.store.state().demandBy;
    if (!t.qty) { this.ui.error('Add at least one item to the demand order'); return; }
    if (by && by < this.today) { this.ui.error('Required-by date cannot be in the past'); return; }
    if (!(await this.ui.confirm({ title: `Submit demand for ${t.qty} pcs?`, message: `${t.products} product(s) · est. ₹${t.amount.toLocaleString('en-IN')}. Your manager reviews it; stock is not reserved.`, confirmText: 'Submit' }))) return;
    this.busy.set(true);
    try {
      const pos = await this.geo.current(5000);
      const d = await this.store.placeDemand(pos?.lat, pos?.lng);
      this.router.navigate(['/order/demand/success', d.id], { replaceUrl: true });
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}

/** Status chip for a demand order (same look as the order status pill). */
@Component({
  selector: 'app-demand-pill',
  template: `<span class="os-pill" [class.sm]="sm()" [class.live]="status() !== 'FULFILLED' && status() !== 'REJECTED'" [style.--c]="st().c" [style.--c2]="st().c2"><i></i>{{ st().lbl }}</span>`,
})
export class DemandPill {
  status = input.required<DemandStatus>();
  sm = input(false);
  st = computed(() => demandStage(this.status()));
}

/* ── Submitted ── */
@Component({
  selector: 'app-demand-success',
  imports: [AppBar, StateView, InrPipe, DPipe, DemandPill],
  host: { class: 'sc' },
  template: `
    <app-bar title="Demand Submitted" [back]="false" />
    <div class="body" style="display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:24px">
      <div class="auth-wrap">
      <app-state [loading]="!d()">
        @if (d(); as d) {
          <div style="width:92px;height:92px;border-radius:50%;background:linear-gradient(135deg,#4c1d95,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:42px;margin:0 auto 16px;box-shadow:0 10px 30px rgba(109,40,217,.35)">📝</div>
          <div style="font-size:22px;font-weight:800">Demand Order Submitted</div>
          <div class="muted" style="margin:6px 0 16px">Requirement captured for <b>{{ d.outletName }}</b> — awaiting review</div>
          <div class="card p" style="width:100%;text-align:left">
            <div class="between" style="margin-bottom:9px"><span class="muted">Demand #</span><b>{{ d.demandNo }}</b></div>
            <div class="between" style="margin-bottom:9px"><span class="muted">Requested</span><b>{{ d.productCount }} product(s) · {{ d.totalPieces }} pcs</b></div>
            <div class="between" style="margin-bottom:9px"><span class="muted">Estimated value</span><b style="color:var(--dmd)">{{ d.subTotal | inr }}</b></div>
            @if (d.expectedBy) { <div class="between" style="margin-bottom:9px"><span class="muted">Required by</span><b>{{ d.expectedBy | d:true }}</b></div> }
            <div class="between"><span class="muted">Status</span><app-demand-pill [status]="d.status" [sm]="true" /></div>
          </div>
          <div class="tiny mt8">Stock has not been reserved. You will be notified as the demand is approved and fulfilled.</div>
          @if (stockQty) { <button class="btn primary mt14" type="button" (click)="go('/order/matrix')">Continue stock order ({{ stockQty }} pcs) →</button> }
          @if (auth.isPhoneOrder()) {
            <button class="btn ghost mt8" type="button" (click)="go('/outlets')">📞 Take another phone order</button>
            <button class="btn {{ stockQty ? 'ghost' : 'primary' }} mt8" type="button" (click)="exit()">✓ Done · back to login</button>
          } @else {
            <button class="btn ghost mt8" type="button" (click)="go('/demand-orders/' + d.id)">📋 Track demand</button>
            <button class="btn {{ stockQty ? 'ghost' : 'primary' }} mt8" type="button" (click)="go('/home')">← Back to Dashboard</button>
          }
        }
      </app-state>
      </div>
    </div>`,
})
export class DemandSuccessPage {
  id = input.required<string>();
  auth = inject(AuthService);
  private api = inject(Api);
  private router = inject(Router);
  private store = inject(OrderStore);
  d = signal<DemandOrder | null>(null);
  /** Pieces still in the regular stock-order cart, so the executive can carry on with it. */
  stockQty = this.store.lines().reduce((s, l) => s + l.qty, 0);
  constructor() {
    queueMicrotask(async () => {
      try {
        this.d.set(await this.api.get<DemandOrder>(`/demand-orders/${this.id()}`));
        this.store.clearDemand();
      } catch { this.router.navigateByUrl('/demand-orders'); }
    });
  }
  go(url: string) { this.router.navigateByUrl(url); }
  /** Ends a phone order session started from the login page. */
  exit() { this.store.reset(); this.auth.logout(); }
}

/* ── List, filters and pending-quantity tracking ── */
@Component({
  selector: 'app-demand-list',
  imports: [FormsModule, AppBar, StateView, InrPipe, DtPipe, DPipe, DemandPill],
  host: { class: 'sc' },
  template: `
    <app-bar title="Demand Orders" [sub]="sub()" [back]="auth.isManager()" fallback="/manager" />
    <div class="body pad">
      <div class="os-switch" role="tablist" aria-label="Order type">
        <button type="button" role="tab" [attr.aria-selected]="false" (click)="router.navigateByUrl('/orders')">📦 Stock Orders</button>
        <button type="button" role="tab" class="on dmd" [attr.aria-selected]="true">📝 Demand Orders</button>
      </div>
      <div class="os-kpis dm-kpis">
        <div><b>{{ data()?.totals?.pieces ?? 0 }} pcs</b><span>Requested · {{ (data()?.totals?.amount ?? 0) | inr }}</span></div>
        <div><b>{{ data()?.totals?.pending ?? 0 }} pcs</b><span>Pending</span></div>
        <div><b>{{ data()?.totals?.fulfilled ?? 0 }} pcs</b><span>Fulfilled</span></div>
      </div>
      <div class="os-search"><span>🔍</span><input [(ngModel)]="q" (ngModelChange)="debounced()" placeholder="Search demand no. or customer" aria-label="Search demand orders"></div>
      <div class="dm-filters">
        <label>From<input type="date" [(ngModel)]="from" (ngModelChange)="load()"></label>
        <label>To<input type="date" [(ngModel)]="to" (ngModelChange)="load()"></label>
        <label>Product<select [(ngModel)]="productId" (ngModelChange)="load()"><option [ngValue]="null">All products</option>
          @for (p of products(); track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }</select></label>
        @if (auth.isManager()) {
          <label>Sales rep<select [(ngModel)]="rep" (ngModelChange)="load()"><option [ngValue]="null">Whole team</option>
            @for (m of team(); track m.id) { <option [ngValue]="m.id">{{ m.name }} · {{ m.empCode }}</option> }</select></label>
        }
      </div>
      <div class="os-chips" role="tablist" aria-label="Filter by status">
        <button type="button" role="tab" class="os-chip" [class.on]="!filter() && !openOnly()" style="--c:#0f172a" (click)="setFilter(null)">All<em>{{ allCount() }}</em></button>
        <button type="button" role="tab" class="os-chip" [class.on]="openOnly()" style="--c:#6d28d9" (click)="setOpen()">⏳ Open<em>{{ openCount() }}</em></button>
        @for (s of stages; track s.k) {
          <button type="button" role="tab" class="os-chip" [class.on]="filter() === s.k" [style.--c]="s.c" (click)="setFilter(s.k)">{{ s.ic }} {{ s.lbl }}<em>{{ data()?.statusCounts?.[s.k] ?? 0 }}</em></button>
        }
      </div>
      <div class="seg mb12" role="tablist" aria-label="View">
        <button type="button" role="tab" [class.on]="view() === 'list'" (click)="setView('list')">Demands</button>
        <button type="button" role="tab" [class.on]="view() === 'items'" (click)="setView('items')">Pending by item</button>
      </div>
      <app-state [loading]="loading()" [error]="err()" (retry)="load()">
        @if (view() === 'list') {
          <div class="card-grid cols-3">
            @for (d of data()?.items ?? []; track d.id; let i = $index) {
              <button type="button" class="os-card" [style.--c]="st(d).c" [style.--c2]="st(d).c2" [style.animation-delay.s]="i * 0.05" (click)="router.navigate(['/demand-orders', d.id])">
                <div class="os-card-top"><div class="os-ic">{{ st(d).ic }}</div>
                  <div class="os-main"><b>{{ d.outletName }}</b><span>{{ d.demandNo }} · {{ d.beatName }}@if (auth.isManager()) { · {{ d.execName }} }</span></div>
                  <app-demand-pill [status]="d.status" [sm]="true" /></div>
                <div class="dm-prog" [attr.aria-label]="d.fulfilledPieces + ' of ' + d.totalPieces + ' fulfilled'"><i [style.width.%]="pct(d)"></i></div>
                <div class="os-card-bot"><div><span>Requested</span><b>{{ d.orderedAt | dt }}</b></div>
                  <div><span>{{ d.expectedBy ? 'Required by' : 'Fulfilled' }}</span><b>{{ d.expectedBy ? (d.expectedBy | d:true) : d.fulfilledPieces + ' / ' + d.totalPieces + ' pcs' }}</b></div>
                  <div class="r"><span>{{ d.productCount }} prod · {{ d.pendingPieces }} pcs pending</span><b class="amt" style="color:var(--dmd)">{{ d.subTotal | inr }}</b></div></div>
              </button>
            } @empty { <div class="card p empty">No demand orders match.</div> }
          </div>
          @if ((data()?.total ?? 0) > (data()?.items?.length ?? 0)) { <button class="btn ghost" type="button" (click)="more()">Load more</button> }
        } @else {
          <div class="card dm-scroll">
            <table class="dm-table">
              <thead><tr><th>Product</th><th>Colour</th><th>Size</th><th class="n">Requested</th><th class="n">Fulfilled</th><th class="n">Pending</th><th class="n">Outlets</th><th>Stock now</th></tr></thead>
              <tbody>
                @for (r of report(); track r.colorId + r.size + r.sleeve) {
                  <tr><td>{{ r.icon }} <b>{{ r.productName }}</b></td>
                    <td><span class="sw" [style.background]="r.hex"></span>{{ r.color }}</td>
                    <td><b>{{ r.size }}</b>@if (r.sleeve === 'HALF') { <span class="tiny"> half</span> }</td>
                    <td class="n">{{ r.requested }}</td><td class="n">{{ r.fulfilled }}</td><td class="n"><b [style.color]="r.pending ? 'var(--dmd)' : ''">{{ r.pending }}</b></td>
                    <td class="n">{{ r.outlets }}</td><td><span class="dm-stk" [class.none]="!r.stockNow.qty">{{ stockText(r) }}</span></td></tr>
                } @empty { <tr><td colspan="8" class="empty">No demand quantities match.</td></tr> }
              </tbody>
            </table>
          </div>
        }
      </app-state>
    </div>`,
})
export class DemandListPage {
  userId = input<string>();
  auth = inject(AuthService);
  router = inject(Router);
  private api = inject(Api);
  stages = DEMAND_STAGES;
  data = signal<DemandList | null>(null);
  report = signal<DemandReportRow[]>([]);
  products = signal<Product[]>([]);
  team = signal<TeamMember[]>([]);
  loading = signal(true);
  err = signal<string | null>(null);
  filter = signal<DemandStatus | null>(null);
  openOnly = signal(false);
  view = signal<'list' | 'items'>('list');
  pageSize = 20;
  q = '';
  from = '';
  to = '';
  productId: number | null = null;
  rep: number | null = null;
  private t?: ReturnType<typeof setTimeout>;
  st = (d: DemandOrder) => demandStage(d.status);
  pct = (d: DemandOrder) => (d.totalPieces ? Math.round((d.fulfilledPieces / d.totalPieces) * 100) : 0);
  stockText = (r: DemandReportRow) => demandStockLabel(r.stockNow);
  allCount = computed(() => Object.values(this.data()?.statusCounts ?? {}).reduce((s, n) => s + (n ?? 0), 0));
  openCount = computed(() => { const c = this.data()?.statusCounts ?? {}; return this.allCount() - (c.FULFILLED ?? 0) - (c.REJECTED ?? 0); });
  sub = computed(() => `${this.allCount()} demands · ${this.openCount()} open`);

  constructor() {
    queueMicrotask(() => this.load());
    this.api.get<Product[]>('/products').then(p => this.products.set(p)).catch(() => {});
    if (this.auth.isManager()) this.api.get<{ members: TeamMember[] }>('/team').then(r => this.team.set(r.members)).catch(() => {});
  }
  debounced() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 300); }
  setFilter(s: DemandStatus | null) { this.filter.set(s); this.openOnly.set(false); this.load(); }
  setOpen() { this.filter.set(null); this.openOnly.set(true); this.load(); }
  setView(v: 'list' | 'items') { this.view.set(v); this.load(); }
  private query(page = 1) {
    return { status: this.filter(), open: this.openOnly() || null, search: this.q.trim(), from: this.from, to: this.to,
      productId: this.productId, userId: this.rep ?? this.userId(), pageSize: this.pageSize, page };
  }
  async more() {
    const d = this.data(); if (!d) return;
    try {
      const r = await this.api.get<DemandList>('/demand-orders', this.query(d.page + 1));
      this.data.set({ ...r, items: [...d.items, ...r.items] });
    } catch (e) { this.err.set(errorMessage(e)); }
  }
  async load() {
    this.err.set(null);
    if (!this.data()) this.loading.set(true);
    try {
      const [list, rows] = await Promise.all([
        this.api.get<DemandList>('/demand-orders', this.query()),
        this.view() === 'items' ? this.api.get<DemandReportRow[]>('/demand-orders/report', this.query()) : Promise.resolve(this.report()),
      ]);
      this.data.set(list);
      this.report.set(rows);
    } catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
}

interface FulfilRow { line: DemandLine; qty: number }

/* ── Detail, review (managers) and fulfilment ── */
@Component({
  selector: 'app-demand-detail',
  imports: [FormsModule, AppBar, StateView, StatusPill, Sheet, InrPipe, DtPipe, DPipe, DemandPill],
  host: { class: 'sc' },
  template: `
    <app-bar title="Demand Order" [sub]="d()?.demandNo" fallback="/demand-orders" />
    <div class="body pad">
      <app-state [loading]="!d() && !err()" [error]="err()" (retry)="load()">
        @if (d(); as d) {
          <div class="os-hero" [style.--c]="st().c" [style.--c2]="st().c2">
            <div class="os-hero-top"><div><b>{{ d.demandNo }} <span class="dm-tag">Demand</span></b><span>{{ d.outletName }} · {{ d.beatName }}</span></div><app-demand-pill [status]="d.status" /></div>
            <div class="os-hero-ic">{{ st().ic }}</div>
            <div class="os-hero-lbl">{{ st().lbl }}</div>
            <div class="os-hero-at">{{ st().note }} · updated {{ d.log[d.log.length - 1]?.at | dt }}</div>
          </div>
          @if (d.status === 'REJECTED' && d.reviewNote) { <div class="pc-alert mt12">⛔ <span>Rejected by {{ d.reviewedBy }}: {{ d.reviewNote }}</span></div> }
          <div class="metrics" style="margin:12px 0;grid-template-columns:repeat(4,1fr)">
            <div><b>{{ d.totalPieces }}</b><span>Requested</span></div><div><b>{{ d.fulfilledPieces }}</b><span>Fulfilled</span></div>
            <div><b style="color:var(--dmd)">{{ d.pendingPieces }}</b><span>Pending</span></div><div><b style="font-size:15px">{{ d.subTotal | inr }}</b><span>Est. value</span></div>
          </div>
          <div class="card p mb12">
            <div class="between"><span class="muted">Requested on</span><b>{{ d.orderedAt | dt }}</b></div>
            @if (d.expectedBy) { <div class="between mt8"><span class="muted">Required by</span><b>{{ d.expectedBy | d:true }}</b></div> }
            <div class="between mt8"><span class="muted">Sales rep</span><b>{{ d.execName }} ({{ d.empCode }})</b></div>
            @if (d.reviewedBy && d.status !== 'REJECTED') { <div class="between mt8"><span class="muted">Reviewed by</span><b>{{ d.reviewedBy }}@if (d.reviewNote) { · {{ d.reviewNote }} }</b></div> }
            @if (d.remarks) { <div class="tiny mt8">Remarks: {{ d.remarks }}</div> }
          </div>

          @if (auth.isManager() && actions().length) {
            <div class="row mb12" style="gap:8px;flex-wrap:wrap">
              @for (a of actions(); track a.k) {
                <button type="button" class="btn sm {{ a.cls }}" [disabled]="busy()" (click)="a.run()">{{ a.lbl }}</button>
              }
            </div>
          }

          <div class="sec-title">Requested Items</div>
          @for (g of groups(); track g.productId) {
            <div class="card mb12" style="overflow:hidden">
              <div class="lrow" style="cursor:default"><span style="font-size:20px">{{ g.icon }}</span><div class="lr-main"><b>{{ g.name }}</b><span>{{ g.qty }} pcs requested · {{ g.pending }} pending</span></div></div>
              <div class="dm-scroll"><table class="dm-table">
                <thead><tr><th>Colour</th><th>Size</th><th class="n">Req.</th><th class="n">Fulfilled</th><th class="n">Pending</th><th>At order</th><th>Stock now</th><th class="n">Amount</th></tr></thead>
                <tbody>@for (l of g.lines; track l.id) {
                  <tr><td><span class="sw" [style.background]="l.hex"></span>{{ l.color }} <span class="tiny">{{ l.colorCode }}</span></td>
                    <td><b>{{ l.size }}</b>@if (l.sleeve === 'HALF') { <span class="tiny"> half</span> }</td>
                    <td class="n">{{ l.qty }}</td><td class="n">{{ l.fulfilledQty }}</td><td class="n"><b [style.color]="l.pendingQty ? 'var(--dmd)' : ''">{{ l.pendingQty }}</b></td>
                    <td><span class="dm-stk" [class.none]="!l.stockAtOrder.qty">{{ stockText(l.stockAtOrder) }}</span></td>
                    <td><span class="dm-stk" [class.none]="!l.stockNow.qty">{{ stockText(l.stockNow) }}</span></td>
                    <td class="n">{{ l.amount | inr }}</td></tr>
                }</tbody></table></div>
            </div>
          }

          @if (d.orders?.length) {
            <div class="sec-title">Fulfilment Orders</div>
            <div class="card">
              @for (o of d.orders; track o.id) {
                <button type="button" class="lrow" (click)="router.navigate(['/orders', o.id])">
                  <div class="lr-main"><b>{{ o.orderNo }}</b><span>{{ o.orderedAt | dt }} · {{ o.totalPieces }} pcs · {{ o.totalAmount | inr }}</span></div>
                  <app-status-pill [status]="o.status" [sm]="true" /><span class="lr-go">›</span></button>
              }
            </div>
          }

          <div class="sec-title">Status History</div>
          <div class="card">
            @for (l of d.log; track $index) {
              <div class="lrow" style="cursor:default"><span style="font-size:17px">{{ stageOf(l.status).ic }}</span>
                <div class="lr-main"><b>{{ stageOf(l.status).lbl }}</b><span>{{ l.at | dt }}@if (l.by) { · {{ l.by }} }@if (l.note) { · {{ l.note }} }</span></div></div>
            }
          </div>
        }
      </app-state>
    </div>

    <app-sheet [(open)]="fulfilOpen" heading="Fulfil from stock" subheading="Creates a regular order for these quantities; it then follows approval, invoice and dispatch.">
      <div class="pad" style="padding-top:0">
        <div class="dm-scroll"><table class="dm-table">
          <thead><tr><th>Item</th><th class="n">Pending</th><th>Stock now</th><th>Fulfil</th></tr></thead>
          <tbody>@for (r of rows(); track r.line.id) {
            <tr><td>{{ r.line.productName }} · <span class="sw" [style.background]="r.line.hex"></span>{{ r.line.color }} · <b>{{ r.line.size }}</b>@if (r.line.sleeve === 'HALF') { <span class="tiny"> half</span> }</td>
              <td class="n">{{ r.line.pendingQty }}</td>
              <td><span class="dm-stk" [class.none]="!fulfillable(r.line)">{{ stockText(r.line.stockNow) }}</span></td>
              <td><div class="dm-step"><input type="number" min="0" [max]="maxFor(r.line)" [(ngModel)]="r.qty" [disabled]="!fulfillable(r.line)"
                     [attr.aria-label]="'Quantity to fulfil, ' + r.line.color + ' size ' + r.line.size"></div></td></tr>
          }</tbody></table></div>
        <div class="fld mt12"><label>Payment terms</label>
          <div class="seg">@for (t of terms; track t[0]) { <button type="button" [class.on]="payTerms() === t[0]" (click)="payTerms.set(t[0])">{{ t[1] }}</button> }</div></div>
        <div class="fld"><label for="fn">Note <span class="tiny">(optional)</span></label><input id="fn" [(ngModel)]="fulfilNote" maxlength="150" placeholder="e.g. GRN 4512 received"></div>
        <button class="btn primary" type="button" [disabled]="busy() || !fulfilQty()" (click)="fulfil()">{{ busy() ? 'Creating order…' : 'Create order for ' + fulfilQty() + ' pcs →' }}</button>
      </div>
    </app-sheet>

    <app-sheet [(open)]="rejectOpen" [heading]="d()?.status === 'PARTIALLY_FULFILLED' ? 'Close the unfulfilled remainder' : 'Reject demand'" subheading="The sales rep sees this reason.">
      <div class="pad" style="padding-top:0">
        <div class="fld"><label for="rj">Reason *</label><textarea id="rj" [(ngModel)]="rejectNote" maxlength="200" placeholder="e.g. Colour discontinued — suggest Lavender instead"></textarea></div>
        <button class="btn danger-ghost" type="button" [disabled]="busy()" (click)="confirmReject()">{{ busy() ? 'Saving…' : '⛔ Confirm' }}</button>
      </div>
    </app-sheet>`,
})
export class DemandDetailPage {
  id = input.required<string>();
  auth = inject(AuthService);
  router = inject(Router);
  private api = inject(Api);
  private ui = inject(Ui);
  d = signal<DemandOrder | null>(null);
  err = signal<string | null>(null);
  busy = signal(false);
  fulfilOpen = signal(false);
  rows = signal<FulfilRow[]>([]);
  payTerms = signal<'CREDIT' | 'CASH' | 'ONLINE'>('CREDIT');
  terms: ['CREDIT' | 'CASH' | 'ONLINE', string][] = [['CREDIT', 'Credit'], ['CASH', 'Cash'], ['ONLINE', 'Online']];
  fulfilNote = '';
  private fulfilRef = '';
  rejectOpen = signal(false);
  rejectNote = '';
  st = computed(() => demandStage(this.d()?.status ?? 'PENDING'));
  stageOf = demandStage;
  stockText = demandStockLabel;
  groups = computed(() => {
    const by = new Map<number, { productId: number; name: string; icon: string; qty: number; pending: number; lines: DemandLine[] }>();
    for (const l of this.d()?.lines ?? []) {
      const g = by.get(l.productId) ?? { productId: l.productId, name: l.productName, icon: l.icon, qty: 0, pending: 0, lines: [] };
      g.qty += l.qty; g.pending += l.pendingQty; g.lines.push(l);
      by.set(l.productId, g);
    }
    return [...by.values()];
  });
  /** Review actions allowed from the current status (mirrors the server's DEMAND_TRANSITIONS). */
  actions = computed(() => {
    const s = this.d()?.status, list: { k: string; lbl: string; cls: string; run: () => void }[] = [];
    if (s === 'PENDING') list.push({ k: 'a', lbl: '✅ Approve', cls: 'primary', run: () => this.move('APPROVED') });
    if (s === 'APPROVED') list.push({ k: 'p', lbl: '🏭 Mark processing', cls: 'ghost', run: () => this.move('PROCESSING') });
    if (s === 'APPROVED' || s === 'PROCESSING' || s === 'PARTIALLY_FULFILLED') list.push({ k: 'f', lbl: '📦 Fulfil from stock', cls: 'primary', run: () => this.openFulfil() });
    if (s && s !== 'FULFILLED' && s !== 'REJECTED') list.push({ k: 'r', lbl: s === 'PARTIALLY_FULFILLED' ? '⛔ Close remainder' : '⛔ Reject', cls: 'danger-ghost', run: () => this.reject() });
    return list;
  });
  fulfilQty = () => this.rows().reduce((s, r) => s + (Number.isInteger(+r.qty) && +r.qty > 0 ? +r.qty : 0), 0);
  fulfillable = (l: DemandLine) => l.pendingQty > 0 && l.stockNow.status !== 'STOPPED' && l.stockNow.qty > 0;
  maxFor = (l: DemandLine) => Math.min(l.pendingQty, l.stockNow.qty);

  constructor() { queueMicrotask(() => this.load()); }
  async load() {
    this.err.set(null);
    try { this.d.set(await this.api.get<DemandOrder>(`/demand-orders/${this.id()}`)); } catch (e) { this.err.set(errorMessage(e)); }
  }
  async move(status: DemandStatus, note?: string) {
    const lbl = demandStage(status).lbl;
    if (!note && !(await this.ui.confirm({ title: `Mark ${this.d()!.demandNo} as ${lbl}?`, message: 'The sales rep is notified.', confirmText: 'Confirm' }))) return;
    this.busy.set(true);
    try {
      this.d.set(await this.api.post<DemandOrder>(`/demand-orders/${this.id()}/status`, { status, note }));
      this.ui.success(`${demandStage(status).ic} ${this.d()!.demandNo} → ${lbl}`);
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  reject() { this.rejectNote = ''; this.rejectOpen.set(true); }
  async confirmReject() {
    const note = this.rejectNote.trim();
    if (!note) { this.ui.error('Enter a reason for rejecting the demand'); return; }
    await this.move('REJECTED', note);
    if (this.d()?.status === 'REJECTED') this.rejectOpen.set(false);
  }
  openFulfil() {
    this.rows.set((this.d()?.lines ?? []).filter(l => l.pendingQty > 0).map(line => ({ line, qty: this.fulfillable(line) ? this.maxFor(line) : 0 })));
    this.fulfilRef = crypto.randomUUID();
    this.fulfilNote = '';
    this.fulfilOpen.set(true);
  }
  async fulfil() {
    const bad = this.rows().find(r => { const n = +r.qty; return !Number.isInteger(n) || n < 0 || n > (this.fulfillable(r.line) ? this.maxFor(r.line) : 0); });
    if (bad) { this.ui.error(`${bad.line.color} size ${bad.line.size}: enter 0–${this.maxFor(bad.line)} pcs`); return; }
    const lines = this.rows().filter(r => +r.qty > 0).map(r => ({ lineId: r.line.id, qty: +r.qty }));
    if (!lines.length) { this.ui.error('Enter a quantity to fulfil for at least one line'); return; }
    this.busy.set(true);
    try {
      this.d.set(await this.api.post<DemandOrder>(`/demand-orders/${this.id()}/fulfil`,
        { clientRef: this.fulfilRef, paymentTerms: this.payTerms(), lines, note: this.fulfilNote.trim() || undefined }));
      this.fulfilOpen.set(false);
      const o = this.d()!.orders?.at(-1);
      this.ui.success(`📦 ${o?.orderNo ?? 'Order'} created — continue it in Order Status`);
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
