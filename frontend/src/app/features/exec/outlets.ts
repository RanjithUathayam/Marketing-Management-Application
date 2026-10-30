import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Geo } from '../../core/geo.service';
import { Ui } from '../../core/ui.service';
import { Beat, Outlet, Paged } from '../../core/models';
import { InrPipe, PERF } from '../../core/format';
import { AppBar, Sheet, StateView } from '../../shared/ui.components';
import { OrderStore } from '../order/order.store';

const REASONS = ['Outlet Closed', 'Owner Absent', 'Competitor Demand', 'Stock Full', 'Credit Hold', 'Order next visit'];

@Component({
  selector: 'app-outlets',
  imports: [FormsModule, RouterLink, AppBar, Sheet, StateView, InrPipe],
  host: { class: 'sc' },
  template: `
    <app-bar [title]="beat()?.name || 'Outlets'" sub="Assigned outlets · nearest first" fallback="/work">
      <button class="bico" type="button" routerLink="/outlets/new" aria-label="New outlet">＋</button>
    </app-bar>
    <div class="loc-bar" [class.green]="!!geo.last()" [class.grey]="!geo.last()">
      <span>📍</span><span class="loc-txt">{{ geo.last() ? 'Location active · sorted by distance' : geo.denied() ? 'Location permission denied — sorted by name' : 'Getting your location…' }}</span><span class="loc-dot"></span>
    </div>
    <div class="srch">
      <div class="sbox"><span>🔍</span><input [(ngModel)]="search" (ngModelChange)="debounced()" placeholder="Search outlets…" aria-label="Search outlets"></div>
      @if (beats().length > 1) {
        <div class="tabs" style="padding:8px 0 0;border:0">
          <button type="button" class="tab" [class.on]="!beatSel()" (click)="pickBeat(null)">All beats</button>
          @for (b of beats(); track b.id) { <button type="button" class="tab" [class.on]="beatSel() === b.id" (click)="pickBeat(b.id)">{{ b.code }}</button> }
        </div>
      }
    </div>
    <div class="wrap" style="padding:9px 12px;background:#fff;border-bottom:1px solid var(--brd);font-size:9.5px">
      <span><span class="pin" style="background:#ea580c"></span>No order</span><span><span class="pin" style="background:#991b1b"></span>High o/s</span>
      <span><span class="pin" style="background:#ca8a04"></span>Recent</span><span><span class="pin" style="background:#16a34a"></span>On track</span>
    </div>
    <div class="body pad">
      @if (task()) { <div class="pc-good">👉 <span>Choose an outlet for <b>{{ task() === 'payment' ? 'payment collection' : 'market survey' }}</b>.</span></div> }
      @if (outlets().length && !task()) {
        <div class="card p mb12">
          <div class="between"><b style="font-size:13px">{{ visitedCount() }} of {{ outlets().length }} visited today</b>
            <button type="button" class="pillbtn" [class.on]="hideDone()" [attr.aria-pressed]="hideDone()" (click)="hideDone.set(!hideDone())">{{ hideDone() ? 'Show all' : 'Hide visited' }}</button></div>
          <div class="prog mt8" role="progressbar" [attr.aria-valuenow]="visitedCount()" aria-valuemin="0" [attr.aria-valuemax]="outlets().length"><div [style.width.%]="(visitedCount() / outlets().length) * 100"></div></div>
        </div>
      }
      <app-state [loading]="loading()" [error]="err()" (retry)="load()"><div class="card-grid">
        @for (o of shown(); track o.id) {
          <button type="button" class="card p" style="margin-bottom:10px;cursor:pointer;width:100%;text-align:left" [style.border-left]="'4px solid ' + perf(o).hex" (click)="openOutlet(o)">
            <div class="between">
              <div style="min-width:0;flex:1">
                <div class="row" style="gap:7px;flex-wrap:wrap"><b style="font-size:14px">{{ o.name }}</b><span class="stars" [attr.aria-label]="o.grade + ' star'">{{ stars(o.grade) }}</span>
                  <span class="chip xs c-grey">{{ o.outletClass }}-Class</span>
                  @if (o.visitedToday) { <span class="chip xs c-green"><span class="d"></span>Done</span> }</div>
                <div class="tiny" style="margin-top:3px;font-weight:800" [style.color]="perf(o).hex">● {{ perf(o).label }}@if (o.distanceKm !== null) { · {{ o.distanceKm }} km }</div>
                <div class="wrap" style="margin-top:7px;gap:5px">
                  <span class="chip xs c-grey">O/S {{ o.outstanding | inr }}</span><span class="chip xs c-blue">Limit {{ o.creditLimit | inr }}</span><span class="chip xs c-purple">LM {{ o.lastMonthSales | inr }}</span>
                </div>
              </div><div class="lr-go">›</div>
            </div>
          </button>
        } @empty { <div class="empty">{{ hideDone() && outlets().length ? '🎉 Every outlet here is visited today.' : 'No outlets found.' }}</div> }
      </div></app-state>
    </div>

    <app-sheet [(open)]="sheetOpen" [heading]="cur()?.name ?? ''" [subheading]="(cur()?.owner ?? '') + ' · ' + (cur()?.mobile ?? '')">
      @if (cur(); as o) {
        <div class="card p mb12">
          <div class="between"><span class="stars" style="font-size:14px">{{ stars(o.grade) }}</span>@if (o.lat) { <span class="tiny">📍 {{ o.lat }}, {{ o.lng }}</span> }</div>
          <div class="metrics mt12">
            <div><b style="font-size:14px" [style.color]="o.outstanding > o.creditLimit * 0.8 ? 'var(--r)' : ''">{{ o.outstanding | inr }}</b><span>Outstanding</span></div>
            <div><b style="font-size:14px">{{ o.creditLimit | inr }}</b><span>Credit Limit</span></div>
            <div><b style="font-size:14px">{{ o.lastMonthSales | inr }}</b><span>Last Month</span></div>
          </div>
          <div class="tiny mt8">{{ o.address.line }}, {{ o.address.city }} {{ o.address.postalCode }}</div>
        </div>
        <div class="sec-title" style="margin-top:0">Choose Task</div>
        <div class="qa-grid">
          <button type="button" class="qa" (click)="order(o)"><div class="qaic" style="background:var(--g2)">📦</div><div class="qal">Order Taking</div></button>
          <button type="button" class="qa" (click)="go('/survey', o)"><div class="qaic" style="background:var(--g2)">📋</div><div class="qal">Market Survey</div></button>
          <button type="button" class="qa" (click)="go('/payment', o)"><div class="qaic" style="background:var(--g2)">💰</div><div class="qal">Payment Collection</div></button>
          <a class="qa" [href]="'tel:' + o.mobile"><div class="qaic" style="background:var(--g2)">📞</div><div class="qal">Call Owner</div></a>
        </div>
        <button class="btn ghost sm mt14" style="width:100%" type="button" (click)="remarkOpen.set(true); sheetOpen.set(false)">✕ No order — add remark</button>
      }
    </app-sheet>

    <app-sheet [(open)]="remarkOpen" heading="Visit Remark" subheading="Reason for no order">
      <div class="wrap mb12" role="radiogroup">
        @for (r of reasons; track r) { <button type="button" class="pillbtn" role="radio" [attr.aria-checked]="reason() === r" [class.on]="reason() === r" (click)="reason.set(r)">{{ r }}</button> }
      </div>
      <div class="fld"><label for="rn">Notes</label><textarea id="rn" [(ngModel)]="notes" placeholder="Optional notes…" maxlength="500"></textarea></div>
      <button class="btn primary" type="button" [disabled]="busy()" (click)="saveRemark()">Save Remark</button>
    </app-sheet>`,
})
export class OutletsPage {
  beatId = input<string>();
  task = input<string>();
  geo = inject(Geo);
  private api = inject(Api);
  private ui = inject(Ui);
  private router = inject(Router);
  private orders = inject(OrderStore);
  outlets = signal<Outlet[]>([]);
  beats = signal<Beat[]>([]);
  beatSel = signal<number | null>(null);
  beat = computed(() => this.beats().find(b => b.id === this.beatSel()) ?? null);
  hideDone = signal(false);
  visitedCount = computed(() => this.outlets().filter(o => o.visitedToday).length);
  shown = computed(() => (this.hideDone() ? this.outlets().filter(o => !o.visitedToday) : this.outlets()));
  loading = signal(true);
  err = signal<string | null>(null);
  search = '';
  sheetOpen = signal(false);
  remarkOpen = signal(false);
  cur = signal<Outlet | null>(null);
  reasons = REASONS;
  reason = signal<string | null>(null);
  notes = '';
  busy = signal(false);
  private t?: ReturnType<typeof setTimeout>;
  perf = (o: Outlet) => PERF[o.performance];
  stars = (g: number) => '★'.repeat(g) + '☆'.repeat(5 - g);

  constructor() {
    queueMicrotask(() => this.beatSel.set(Number(this.beatId()) || null));
    this.api.get<Beat[]>('/beats').then(b => this.beats.set(b)).catch(() => {});
    this.geo.current().then(() => this.load());
  }
  debounced() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 300); }
  pickBeat(id: number | null) { this.beatSel.set(id); this.load(); }
  async load() {
    this.loading.set(true); this.err.set(null);
    const pos = this.geo.last();
    try {
      const r = await this.api.get<Paged<Outlet>>('/outlets', { beatId: this.beatSel(), search: this.search.trim(), lat: pos?.lat, lng: pos?.lng,
        sort: pos ? 'distance' : 'name', pageSize: 200 });
      this.outlets.set(r.items);
    } catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  openOutlet(o: Outlet) {
    if (this.task() === 'payment') return this.go('/payment', o);
    if (this.task() === 'survey') return this.go('/survey', o);
    this.cur.set(o); this.sheetOpen.set(true);
  }
  go(path: string, o: Outlet) { this.sheetOpen.set(false); this.router.navigate([path, o.id]); }
  order(o: Outlet) { this.sheetOpen.set(false); this.orders.start(o); this.router.navigateByUrl('/order'); }
  async saveRemark() {
    if (!this.reason()) { this.ui.error('Choose a reason'); return; }
    this.busy.set(true);
    try {
      const pos = await this.geo.current(4000);
      const r = await this.api.post<{ outsideGeofence: boolean; distanceM: number | null }>(`/outlets/${this.cur()!.id}/visits`,
        { reason: this.reason(), notes: this.notes.trim() || undefined, lat: pos?.lat, lng: pos?.lng });
      this.remarkOpen.set(false); this.reason.set(null); this.notes = '';
      this.ui.toast(r.outsideGeofence ? `✅ Remark saved · ⚠ ${r.distanceM} m from outlet` : '✅ Remark saved');
      this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
