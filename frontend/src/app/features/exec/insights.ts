import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Geo } from '../../core/geo.service';
import { Ui } from '../../core/ui.service';
import { TargetSummary, TrackingToday, VisitIndicator } from '../../core/models';
import { InrPipe, TimePipe, compactInr, todayIso } from '../../core/format';
import { AppBar, StateView, VisitBadge } from '../../shared/ui.components';
import { RouteMap } from '../../shared/route-map';

/* ── Live tracking ── */
@Component({
  selector: 'app-tracking',
  imports: [AppBar, StateView, RouteMap, TimePipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Live Tracking" sub="GPS · Today" fallback="/reports">
      <button class="bico" type="button" [disabled]="busy()" (click)="ping()" aria-label="Share current location">📍</button>
    </app-bar>
    <div class="body pad">
      <app-state [loading]="!t() && !err()" [error]="err()" (retry)="load()">
        @if (t(); as t) {
          <div class="dash-cols"><div>
          <div class="card" style="overflow:hidden">
            <div style="background:linear-gradient(135deg,#e0f2fe,#dbeafe);position:relative">
              <app-route-map [points]="mapPts()" />
              <div style="position:absolute;bottom:8px;left:8px" class="chip" [class.c-green]="t.gpsActive" [class.c-grey]="!t.gpsActive"><span class="d"></span>{{ t.gpsActive ? 'GPS active' : 'Checked out' }}</div>
            </div>
            <div class="p"><div class="metrics" style="border:none"><div><b>{{ t.visits }}</b><span>Visits</span></div><div><b>{{ t.distanceKm }} km</b><span>Distance</span></div><div><b>{{ hm(t.activeMinutes) }}</b><span>Active</span></div></div></div>
          </div>
          </div><div>
          <div class="sec-title">Route History</div>
          <div class="card p"><div class="timeline">
            @for (p of t.points; track $index; let last = $last) {
              <div class="tl-item" [class.done]="!last" [class.active]="last" [class.bad]="p.deviation"><b>{{ p.label || 'Location update' }}@if (p.deviation) { · ⚠ outside geofence }</b><span>{{ p.at | time }}</span></div>
            } @empty { <div class="muted">No GPS points recorded today.</div> }
          </div></div>
          <div class="sec-title">Geofence &amp; Alerts</div>
          <div class="card p">
            <div class="between" style="margin-bottom:9px"><span class="muted">Geo-fencing radius</span><b>50 m</b></div>
            <div class="between"><span class="muted">Outlets pending in today's beat</span><span class="chip xs" [class.c-amber]="t.outletsPending" [class.c-green]="!t.outletsPending"><span class="d"></span>{{ t.outletsPending }} pending</span></div>
            @if (t.deviations) { <div class="card p mt12" style="background:#fff5f5;border-left:3px solid var(--r)"><b style="font-size:11px;color:var(--r)">⚠ Deviation alert</b><div class="tiny" style="margin-top:2px">{{ t.deviations }} check-in(s) were outside the outlet radius.</div></div> }
          </div>
          </div></div>
        }
      </app-state>
    </div>`,
})
export class TrackingPage {
  private api = inject(Api);
  private geo = inject(Geo);
  private ui = inject(Ui);
  t = signal<TrackingToday | null>(null);
  err = signal<string | null>(null);
  busy = signal(false);
  mapPts = computed(() => (this.t()?.points ?? []).map((p, i, a) => ({ ...p, label: i === a.length - 1 ? 'Now' : i === 0 ? 'Start' : 'V' + i })));
  hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  constructor() { this.load(); }
  async load() {
    this.err.set(null);
    try { this.t.set(await this.api.get<TrackingToday>('/tracking/today')); } catch (e) { this.err.set(errorMessage(e)); }
  }
  async ping() {
    this.busy.set(true);
    try {
      const p = await this.geo.current();
      if (!p) { this.ui.error('Location unavailable — allow location access'); return; }
      await this.api.post('/tracking/points', { lat: p.lat, lng: p.lng, label: 'Location update' });
      await this.load();
      this.ui.success('📍 Location shared');
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}

/* ── Targets & incentives ── */
@Component({
  selector: 'app-targets',
  imports: [AppBar, StateView, InrPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Targets & Incentives" sub="Real-time dashboard" fallback="/reports" />
    <div class="body pad">
      <app-state [loading]="!t() && !err()" [error]="err()" (retry)="load()">
        @if (t(); as t) {
          @if (!t.hasTarget) { <div class="pc-alert">ℹ <span>No target has been set for this month yet. Ask your manager.</span></div> }
          <div class="card p center" style="background:linear-gradient(135deg,#0d6e50,#10a070);color:#fff;border:none">
            <div style="font-size:11px;opacity:.85;font-weight:700">MONTHLY ACHIEVEMENT</div>
            <div class="hero-num" style="margin:6px 0">{{ t.achievedPct }}%</div>
            <div style="font-size:12px;opacity:.9">{{ t.achieved | inr }} of {{ t.monthlyTarget | inr }}</div>
            <div class="prog" style="margin-top:12px;background:rgba(255,255,255,.25)"><div [style.width.%]="min(t.achievedPct, 100)" style="background:#fff"></div></div>
            <div class="between mt8" style="font-size:11px;opacity:.9"><span>Balance {{ t.balance | inr }}</span><span>{{ t.daysLeft }} working days left</span></div>
          </div>
          <div class="sec-title">Period Breakdown</div>
          <div class="kpi-grid">
            <div class="kpi"><div class="kico">📅</div><div class="kv">{{ t.daily.pct }}%</div><div class="kl">Daily · {{ t.daily.achieved | inr }}/{{ t.daily.target | inr }}</div></div>
            <div class="kpi"><div class="kico">🗓️</div><div class="kv">{{ t.weekly.pct }}%</div><div class="kl">Weekly · {{ t.weekly.achieved | inr }}</div></div>
            <div class="kpi up"><div class="kico">📈</div><div class="kv">{{ t.achievedPct }}%</div><div class="kl">Monthly (MTD)</div></div>
            <div class="kpi"><div class="kico">📊</div><div class="kv">{{ t.quarterly.pct }}%</div><div class="kl">Quarterly · {{ t.quarterly.achieved | inr }}</div></div>
          </div>
          <div class="sec-title">Incentive Earnings Tracker</div>
          <div class="card p">
            <div class="between" style="margin-bottom:4px"><b style="font-size:15px;color:var(--g)">{{ t.incentive.earned | inr }}</b>
              @if (t.incentive.slab; as s) { <span class="chip" [class.c-green]="s.ratePct" [class.c-red]="!s.ratePct"><span class="d"></span>{{ s.label }} · {{ s.ratePct }}%</span> }</div>
            <div class="muted mb12">Earned this month at the current slab · based on billed orders (net of tax)</div>
            @for (s of t.incentive.slabs; track s.uptoPct) {
              <div class="between" style="padding:7px 0"><div class="row" style="gap:8px">
                <span style="width:9px;height:9px;border-radius:50%" [style.background]="t.achievedPct > s.uptoPct ? '#16a34a' : s.uptoPct === t.incentive.slab?.uptoPct ? '#ca8a04' : '#cbd5e1'"></span>
                <span style="font-size:12px" [style.font-weight]="s.uptoPct === t.incentive.slab?.uptoPct ? 800 : 600">{{ s.label }}</span></div><span class="tiny">{{ s.ratePct }}% incentive</span></div>
            }
          </div>
          @if (t.incentive.nextSlab; as n) {
            <div class="sec-title">Alerts</div>
            <div class="card p"><div class="muted">🎯 You're {{ gapToNext(t) }}% away from the next slab. Cross it to unlock {{ n.ratePct }}% incentive.</div></div>
          }
        }
      </app-state>
    </div>`,
})
export class TargetsPage {
  private api = inject(Api);
  t = signal<TargetSummary | null>(null);
  err = signal<string | null>(null);
  min = Math.min;
  gapToNext = (t: TargetSummary) => Math.max(0, (t.incentive.slab?.uptoPct ?? 0) - t.achievedPct + 1);
  constructor() { this.load(); }
  async load() {
    this.err.set(null);
    try { this.t.set(await this.api.get<TargetSummary>('/targets')); } catch (e) { this.err.set(errorMessage(e)); }
  }
}

/* ── Reports hub ── */
interface Trend { days: { date: string; amount: number }[]; total: number; changePct: number | null }
interface Coverage { beatId: number; code: string; name: string; outlets: number; visited: number; pct: number; indicator: VisitIndicator }

@Component({
  selector: 'app-reports',
  imports: [FormsModule, AppBar, StateView, VisitBadge, InrPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Reports & Dashboards" [back]="false" />
    <div class="body pad">
      <div class="sec-title">Performance</div>
      <div class="card p mb12">
        <app-state [loading]="!trend()">
          @if (trend(); as tr) {
            <div class="between" style="margin-bottom:10px"><b style="font-size:13px">Sales — last 6 days · {{ tr.total | inr }}</b>
              @if (tr.changePct !== null) { <span class="chip xs" [class.c-green]="tr.changePct >= 0" [class.c-red]="tr.changePct < 0"><span class="d"></span>{{ tr.changePct >= 0 ? '▲' : '▼' }} {{ abs(tr.changePct) }}%</span> }</div>
            <div class="bars">@for (d of tr.days; track d.date) { <div [title]="d.date + ': ₹' + d.amount"><b class="bar-v">{{ compact(d.amount) }}</b><i [style.height.%]="barH(d.amount)"></i><span class="tiny">{{ dow(d.date) }}</span></div> }</div>
          }
        </app-state>
      </div>
      <div class="qa-grid" style="grid-template-columns:repeat(3,1fr)">
        @for (r of links; track r[1]) { <button type="button" class="qa" (click)="router.navigateByUrl(r[2])"><div class="qaic" style="background:var(--g2)">{{ r[0] }}</div><div class="qal">{{ r[1] }}</div></button> }
      </div>
      <div class="sec-title">Beat Coverage (this month)</div>
      <div class="card p">
        @for (b of coverage(); track b.beatId) {
          <div style="margin-bottom:11px"><div class="between" style="margin-bottom:5px"><span style="font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px">{{ b.name }}<app-visit-badge [ind]="b.indicator" size="sm" /></span><span class="tiny">{{ b.visited }}/{{ b.outlets }} · {{ b.pct }}%</span></div>
            <div class="prog" [class.red]="b.pct < 50" [class.amber]="b.pct >= 50 && b.pct < 70"><div [style.width.%]="b.pct"></div></div></div>
        } @empty { <div class="muted">No beats assigned.</div> }
      </div>
      <div class="sec-title">Export</div>
      <div class="card p">
        <div class="no-2col"><div class="fld"><label for="rf">From</label><input id="rf" type="date" [(ngModel)]="from" [max]="today"></div><div class="fld"><label for="rt">To</label><input id="rt" type="date" [(ngModel)]="to" [max]="today"></div></div>
        <div class="fld"><label for="rty">Report</label><select id="rty" [(ngModel)]="type"><option value="orders">Orders</option><option value="expenses">Expenses</option><option value="attendance">Attendance</option></select></div>
        <button class="btn ghost" type="button" [disabled]="busy()" (click)="export()">📥 Export Report (Excel CSV)</button>
      </div>
    </div>`,
})
export class ReportsPage {
  router = inject(Router);
  private api = inject(Api);
  private ui = inject(Ui);
  trend = signal<Trend | null>(null);
  coverage = signal<Coverage[]>([]);
  busy = signal(false);
  today = todayIso();
  from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  to = this.today;
  type = 'orders';
  abs = Math.abs;
  compact = compactInr;
  links:[string, string, string][] = [['📊', 'Sales', '/targets'], ['🧾', 'Expenses', '/expenses'], ['📡', 'GPS', '/tracking'], ['🎯', 'Targets', '/targets'], ['📦', 'Orders', '/orders'], ['🏪', 'Outlets', '/customers']];
  barH = (a: number) => { const m = Math.max(...(this.trend()?.days.map(d => d.amount) ?? [1]), 1); return Math.max(2, (a / m) * 100); };
  dow = (iso: string) => 'SMTWTFS'[new Date(iso + 'T00:00:00').getDay()];
  constructor() {
    this.api.get<Trend>('/reports/sales-trend', { days: 6 }).then(t => this.trend.set(t)).catch(e => this.ui.error(errorMessage(e)));
    this.api.get<Coverage[]>('/reports/beat-coverage').then(c => this.coverage.set(c)).catch(() => {});
  }
  async export() {
    if (this.from > this.to) { this.ui.error('"From" must be before "To"'); return; }
    this.busy.set(true);
    try { await this.api.download('/reports/export', { type: this.type, from: this.from, to: this.to }, `${this.type}-${this.from}-to-${this.to}.csv`); this.ui.success('📥 Report exported'); }
    catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
