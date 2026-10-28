import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ExecDashboard } from '../../core/models';
import { DtPipe, InrPipe, initials } from '../../core/format';
import { StateView, StatusPill } from '../../shared/ui.components';
import { AttendanceWidget } from '../../shared/attendance-widget';

@Component({
  selector: 'app-home',
  imports: [RouterLink, InrPipe, DtPipe, StateView, StatusPill, AttendanceWidget],
  host: { class: 'sc' },
  template: `
    <header class="bar grad" style="padding-bottom:16px">
      <div class="av" style="background:rgba(255,255,255,.2)">{{ init() }}</div>
      <div class="btitle" style="margin-left:2px">Hi, {{ firstName() }} 👋<small>{{ auth.user()?.empCode }} · {{ auth.user()?.region }}</small></div>
      <app-attendance-widget />
      <button class="bico" type="button" routerLink="/notifications" aria-label="Notifications">🔔@if (d()?.unreadNotifications) {<span class="notif-dot"></span>}</button>
    </header>
    <div class="body pad">
      <app-state [loading]="!d() && !err()" [error]="err()" (retry)="load()">
        @if (d(); as d) {
          @if (d.todayBeat; as tb) {
            <div class="card p" style="background:linear-gradient(135deg,#0d6e50,#10a070);color:#fff;border:none;margin-bottom:14px">
              <div class="between">
                <div><div style="font-size:11px;opacity:.85;font-weight:700">{{ tb.planned ? "TODAY'S BEAT" : 'YOUR BEAT' }}</div>
                  <div style="font-size:17px;font-weight:800;margin-top:3px">{{ tb.name }}</div>
                  <div style="font-size:11.5px;opacity:.85;margin-top:2px">{{ tb.outlets }} outlets · {{ tb.pending }} pending</div></div>
                <button class="bar-preview" type="button" [routerLink]="['/outlets']" [queryParams]="{ beatId: tb.id }">Start →</button>
              </div>
            </div>
          } @else {
            <div class="card p mb12"><div class="muted">No beat assigned yet. Contact your manager.</div></div>
          }
          @if (d.samplePads.pending) {
            <button type="button" class="spx-alert" routerLink="/sample-pads">
              <div class="ic">🗂️<em>{{ d.samplePads.pending }}</em></div>
              <div class="tx"><b>{{ d.samplePads.pending }} sample pad{{ d.samplePads.pending > 1 ? 's' : '' }} pending</b>
                <span>{{ d.samplePads.dcs }} delivery challan{{ d.samplePads.dcs > 1 ? 's' : '' }} · scan QR on receipt</span></div>
              <div class="go">Acknowledge</div>
            </button>
          }
          <div class="kpi-grid">
            <div class="kpi" [class.up]="(d.salesVsAvgPct ?? 0) >= 0" [class.down]="(d.salesVsAvgPct ?? 0) < 0"><div class="kico">📦</div><div class="kv">{{ d.todaySales | inr }}</div><div class="kl">Today's Sales</div>
              <div class="ktrend">@if (d.salesVsAvgPct !== null) { {{ d.salesVsAvgPct >= 0 ? '▲' : '▼' }} {{ abs(d.salesVsAvgPct) }}% vs avg } @else { — }</div></div>
            <div class="kpi up"><div class="kico">✅</div><div class="kv">{{ d.todayBeat?.visited ?? 0 }}/{{ d.todayBeat?.outlets ?? 0 }}</div><div class="kl">Outlets Visited</div>
              <div class="ktrend">{{ coverage(d) }}% coverage</div></div>
            <div class="kpi"><div class="kico">🧾</div><div class="kv">{{ d.outstanding | inr }}</div><div class="kl">Outstanding</div>
              <div class="ktrend" [style.color]="d.highOutstandingOutlets ? 'var(--r)' : ''">{{ d.highOutstandingOutlets }} outlet{{ d.highOutstandingOutlets === 1 ? '' : 's' }} high</div></div>
            <div class="kpi up"><div class="kico">📈</div><div class="kv">{{ d.target.pct }}%</div><div class="kl">Monthly Target</div><div class="ktrend">MTD achieved</div></div>
          </div>

          <div class="sec-title">Target vs Achievement</div>
          <button type="button" class="card p" style="width:100%;text-align:left;cursor:pointer" routerLink="/targets">
            <div class="between" style="margin-bottom:8px"><span class="muted">{{ d.target.achieved | inr }} of {{ d.target.monthly | inr }}</span><b style="color:var(--g)">{{ d.target.pct }}%</b></div>
            <div class="prog" [class.amber]="d.target.pct < 70"><div [style.width.%]="min(d.target.pct, 100)"></div></div>
            <div class="between mt8"><span class="tiny">Balance {{ d.target.balance | inr }}</span><span class="tiny">{{ d.target.daysLeft }} days left</span></div>
          </button>

          <div class="sec-title">Quick Actions</div>
          <div class="card p"><div class="qa-grid">
            @for (q of quick; track q.lbl) {
              <button type="button" class="qa" (click)="router.navigateByUrl(q.go)"><div class="qaic" [style.background]="q.bg">{{ q.ic }}</div><div class="qal">{{ q.lbl }}</div></button>
            }
          </div></div>

          <div class="sec-title">Recent Orders</div>
          <div class="card">
            @for (o of d.recentOrders; track o.id) {
              <button type="button" class="lrow" [routerLink]="['/orders', o.id]">
                <div class="av">📦</div>
                <div class="lr-main"><b>{{ o.outletName }}</b><span>{{ o.orderNo }} · {{ o.items }} items · {{ o.orderedAt | dt: false }}</span></div>
                <div style="text-align:right"><b style="font-size:13px">{{ o.totalAmount | inr }}</b><div style="margin-top:3px"><app-status-pill [status]="o.status" [sm]="true" /></div></div>
              </button>
            } @empty { <div class="empty">No orders yet — start your beat to take one.</div> }
            <button type="button" class="lrow" style="justify-content:center;color:var(--g);font-weight:800;font-size:12px" routerLink="/orders">View all in Order Status →</button>
          </div>
        }
      </app-state>
    </div>`,
})
export class HomePage {
  auth = inject(AuthService);
  router = inject(Router);
  private api = inject(Api);
  d = signal<ExecDashboard | null>(null);
  err = signal<string | null>(null);
  abs = Math.abs;
  min = Math.min;
  quick = [
    { ic: '🧭', bg: '#e0f7f1', lbl: 'Route Plan', go: '/route' },
    { ic: '🏪', bg: '#dbeafe', lbl: 'Visit / Order', go: '/work' },
    { ic: '📦', bg: '#fef3c7', lbl: 'Take Order', go: '/outlets' },
    { ic: '💰', bg: '#dcfce7', lbl: 'Payment', go: '/outlets?task=payment' },
    { ic: '📋', bg: '#ede9fe', lbl: 'Survey', go: '/outlets?task=survey' },
    { ic: '🧾', bg: '#fee2e2', lbl: 'Expenses', go: '/expenses' },
    { ic: '🎯', bg: '#ccfbf1', lbl: 'Targets', go: '/targets' },
    { ic: '📡', bg: '#e0e7ff', lbl: 'Live Track', go: '/tracking' },
  ];
  firstName = () => this.auth.user()?.name.split(' ')[0] ?? '';
  init = () => initials(this.auth.user()?.name ?? '');
  coverage = (d: ExecDashboard) => (d.todayBeat?.outlets ? Math.round((d.todayBeat.visited / d.todayBeat.outlets) * 100) : 0);

  constructor() { this.load(); }
  async load() {
    this.err.set(null);
    try { this.d.set(await this.api.get<ExecDashboard>('/dashboard/exec')); } catch (e) { this.err.set(errorMessage(e)); }
  }
}
