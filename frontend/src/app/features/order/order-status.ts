import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Ui } from '../../core/ui.service';
import { Order, OrderList, OrderStatus } from '../../core/models';
import { DtPipe, InrPipe, ORDER_STAGES, stage, stageIdx } from '../../core/format';
import { AppBar, MiniTrack, StateView, StatusPill } from '../../shared/ui.components';
import { Badges } from '../../core/badges.service';

@Component({
  selector: 'app-order-status',
  imports: [FormsModule, AppBar, StateView, StatusPill, MiniTrack, InrPipe, DtPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Order Status" [sub]="sub()" [back]="auth.isManager()" fallback="/manager" />
    <div class="body pad">
      <div class="os-kpis">
        <div><b>{{ (data()?.totalAmount ?? 0) | inr }}</b><span>Total value</span></div>
        <div><b>{{ inProgress() }}</b><span>In progress</span></div>
        <div><b>{{ data()?.statusCounts?.COMPLETED ?? 0 }}</b><span>Completed</span></div>
      </div>
      <div class="os-search"><span>🔍</span><input [(ngModel)]="q" (ngModelChange)="debounced()" placeholder="Search order no. or outlet" aria-label="Search orders"></div>
      <div class="os-chips" role="tablist" aria-label="Filter by status">
        <button type="button" role="tab" class="os-chip" [class.on]="!filter()" style="--c:#0f172a" (click)="setFilter(null)">All<em>{{ allCount() }}</em></button>
        @for (s of stages; track s.k) {
          <button type="button" role="tab" class="os-chip" [class.on]="filter() === s.k" [style.--c]="s.c" (click)="setFilter(s.k)">{{ s.ic }} {{ s.short }}<em>{{ data()?.statusCounts?.[s.k] ?? 0 }}</em></button>
        }
      </div>
      <app-state [loading]="loading()" [error]="err()" (retry)="load()"><div class="card-grid cols-3">
        @for (o of data()?.items ?? []; track o.id; let i = $index) {
          <button type="button" class="os-card" [style.--c]="st(o).c" [style.--c2]="st(o).c2" [style.animation-delay.s]="i * 0.05" (click)="router.navigate(['/orders', o.id])">
            <div class="os-card-top"><div class="os-ic">{{ st(o).ic }}</div><div class="os-main"><b>{{ o.outletName }}</b><span>{{ o.orderNo }} · {{ o.beatName }}@if (auth.isManager()) { · {{ o.execName }} }</span></div><app-status-pill [status]="o.status" [sm]="true" /></div>
            <app-mini-track [status]="o.status" />
            <div class="os-card-bot"><div><span>Placed</span><b>{{ o.orderedAt | dt }}</b></div><div><span>{{ st(o).short }}</span><b>{{ last(o) | dt }}</b></div>
              <div class="r"><span>{{ o.productCount }} prod · {{ o.totalPieces }} pcs</span><b class="amt">{{ o.totalAmount | inr }}</b></div></div>
            @if (o.creditHold) { <div class="chip xs c-red mt8">⚠ Credit hold — awaiting approval</div> }
          </button>
        } @empty { <div class="card p empty">No orders match.</div> }
        </div>
        @if ((data()?.total ?? 0) > (data()?.items?.length ?? 0)) {
          <button class="btn ghost" type="button" (click)="more()">Load more</button>
        }
      </app-state>
    </div>`,
})
export class OrderStatusPage {
  userId = input<string>();
  auth = inject(AuthService);
  router = inject(Router);
  private api = inject(Api);
  stages = ORDER_STAGES;
  data = signal<OrderList | null>(null);
  loading = signal(true);
  err = signal<string | null>(null);
  filter = signal<OrderStatus | null>(null);
  pageSize = 20;
  q = '';
  private t?: ReturnType<typeof setTimeout>;
  st = (o: Order) => stage(o.status);
  last = (o: Order) => o.log[o.log.length - 1]?.at ?? o.orderedAt;
  allCount = computed(() => Object.values(this.data()?.statusCounts ?? {}).reduce((s, n) => s + (n ?? 0), 0));
  inProgress = computed(() => this.allCount() - (this.data()?.statusCounts?.COMPLETED ?? 0));
  sub = computed(() => `${this.allCount()} orders · ${this.inProgress()} in progress`);

  constructor() { queueMicrotask(() => this.load()); }
  debounced() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 300); }
  setFilter(s: OrderStatus | null) { this.filter.set(s); this.load(); }
  /** Appends the next page to the current list. */
  async more() {
    const d = this.data(); if (!d) return;
    try {
      const r = await this.api.get<OrderList>('/orders', { status: this.filter(), search: this.q.trim(), pageSize: this.pageSize, page: d.page + 1, userId: this.userId() });
      this.data.set({ ...r, items: [...d.items, ...r.items] });
    } catch (e) { this.err.set(errorMessage(e)); }
  }
  async load() {
    this.err.set(null);
    if (!this.data()) this.loading.set(true);
    try { this.data.set(await this.api.get<OrderList>('/orders', { status: this.filter(), search: this.q.trim(), pageSize: this.pageSize, page: 1, userId: this.userId() })); }
    catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
}

@Component({
  selector: 'app-order-detail',
  imports: [AppBar, StateView, StatusPill, InrPipe, DtPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Order Details" [sub]="o()?.orderNo" fallback="/orders" />
    <div class="body pad">
      <app-state [loading]="!o() && !err()" [error]="err()" (retry)="load()">
        @if (o(); as o) {
          <div class="os-hero" [style.--c]="st().c" [style.--c2]="st().c2">
            <div class="os-hero-top"><div><b>{{ o.orderNo }}</b><span>{{ o.outletName }} · {{ o.beatName }}</span></div><app-status-pill [status]="o.status" /></div>
            <div class="os-hero-ic">{{ st().ic }}</div>
            <div class="os-hero-lbl">{{ st().lbl }}</div>
            <div class="os-hero-at">Updated {{ o.log[o.log.length - 1]?.at | dt }}</div>
            <div class="os-steps"><div class="os-steps-fill" [style.--w]="'calc((100% - 24px) * ' + pct() + ')'"></div>
              @for (s of stages; track s.k; let i = $index) {
                <div class="os-step" [class.done]="i < n()" [class.cur]="i === n()" [style.animation-delay.s]="i * 0.12" [title]="s.lbl">{{ i < n() ? '✓' : i === n() ? s.ic : i + 1 }}</div>
              }</div>
            <div class="os-steps-lbl">@for (s of stages; track s.k) { <em>{{ s.short }}</em> }</div>
          </div>
          @if (o.creditHold) { <div class="pc-alert mt12">⚠ <span>Credit hold — order + outstanding exceeds the outlet's credit limit. Manager approval is required.</span></div> }
          <div class="metrics" style="margin:12px 0"><div><b>{{ o.totalAmount | inr }}</b><span>Amount</span></div><div><b>{{ o.productCount }}</b><span>Products</span></div><div><b>{{ o.totalPieces }}</b><span>Pieces</span></div></div>
          @if (auth.isManager()) { <div class="tiny mb12">Executive: <b>{{ o.execName }}</b> ({{ o.empCode }}) · Terms: {{ o.paymentTerms }}</div> }
          <div class="sec-title" style="margin-top:4px">Status Timeline</div>
          <div>
            @for (s of stages; track s.k; let i = $index) {
              <div class="os-tl-i" [class.done]="i < n()" [class.cur]="i === n()" [class.todo]="i > n()" [style.--c]="s.c" [style.--c2]="s.c2" [style.animation-delay.s]="0.15 + i * 0.1">
                <div class="os-tl-dot">{{ i <= n() ? s.ic : '' }}</div>
                <div class="os-tl-body"><div class="os-tl-row"><b>{{ s.lbl }}</b>
                  @if (at(s.k); as a) { <time [attr.datetime]="a">{{ a | dt }}</time> } @else { <time class="pend">{{ i === n() + 1 ? 'Up next' : 'Pending' }}</time> }</div>
                  <span>{{ at(s.k) ? (extra(s.k) || s.note) : s.note }}</span></div>
              </div>
            }
          </div>
          <div class="sec-title">Order Items</div>
          <div class="card os-lines">
            @for (p of o.products ?? []; track p.productId) {
              <div><b>{{ p.icon }} {{ p.name }}@if (p.freeQty) { <span class="chip xs c-amber">🎁 +{{ p.freeQty }} free</span> }</b><span>{{ p.qty }} pcs · {{ p.colors.join(', ') }}</span><em>{{ p.amount | inr }}</em></div>
            }
          </div>
          <div class="card p mt12">
            <div class="between"><span class="muted">Subtotal</span><b>{{ o.subTotal | inr }}</b></div>
            <div class="between mt8"><span class="muted">Tax</span><span>{{ o.taxAmount | inr }}</span></div>
            <div class="between mt8"><span class="muted">Delivery</span><span>{{ o.transport.mode }} · {{ o.transport.transporter }} · {{ o.transport.deliveryDate }}</span></div>
            @if (o.instructions) { <div class="tiny mt8">Note: {{ o.instructions }}</div> }
            @if (o.signatureUrl) { <img [src]="o.signatureUrl" alt="Customer signature" style="max-width:180px;margin-top:10px;border:1px solid var(--brd);border-radius:8px"> }
          </div>
          @if (auth.isManager() && n() < stages.length - 1) {
            <button class="btn primary mt12" type="button" [disabled]="busy()" (click)="advance()">{{ n() === 0 ? (o.creditHold ? 'Approve (override credit hold)' : 'Approve order') : 'Move to “' + stages[n() + 1].lbl + '”' }} →</button>
          }
        }
      </app-state>
    </div>`,
})
export class OrderDetailPage {
  id = input.required<string>();
  auth = inject(AuthService);
  private api = inject(Api);
  private ui = inject(Ui);
  private badges = inject(Badges);
  stages = ORDER_STAGES;
  o = signal<Order | null>(null);
  err = signal<string | null>(null);
  busy = signal(false);
  st = computed(() => stage(this.o()?.status ?? 'RECEIVED'));
  n = computed(() => stageIdx(this.o()?.status ?? 'RECEIVED'));
  pct = computed(() => (this.n() / (ORDER_STAGES.length - 1)).toFixed(3));
  at = (k: OrderStatus) => this.o()?.log.find(l => l.status === k)?.at ?? null;
  extra = (k: OrderStatus) => {
    const o = this.o()!;
    return ({ INVOICED: o.invoiceNo ? `Invoice ${o.invoiceNo}` : '', DISPATCHED: o.lrNo ? `${o.transport.transporter} · ${o.lrNo}` : '', DELIVERED: o.receivedBy ? `Received by ${o.receivedBy}` : '' } as Record<string, string>)[k] ?? '';
  };
  constructor() { queueMicrotask(() => this.load()); }
  async load() {
    this.err.set(null);
    try { this.o.set(await this.api.get<Order>(`/orders/${this.id()}`)); } catch (e) { this.err.set(errorMessage(e)); }
  }
  async advance() {
    const next = ORDER_STAGES[this.n() + 1];
    if (!(await this.ui.confirm({ title: `Move ${this.o()!.orderNo} to “${next.lbl}”?`, message: 'The executive is notified and the time is stamped on the timeline.', confirmText: 'Confirm' }))) return;
    this.busy.set(true);
    try {
      this.o.set(await this.api.post<Order>(`/orders/${this.id()}/advance`));
      this.ui.success(`${next.ic} ${this.o()!.orderNo} → ${next.lbl}`);
      this.badges.refresh(true);
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
