import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { TeamMember, TrackingToday } from '../../core/models';
import { InrPipe, TimePipe, initials, todayIso } from '../../core/format';
import { AppBar, StateView } from '../../shared/ui.components';
import { RouteMap } from '../../shared/route-map';
import { TeamMemberSheet } from './team-member-sheet';

/* ── Team ranking + today's attendance ── */
@Component({
  selector: 'app-manager-team',
  imports: [AppBar, StateView, InrPipe, TeamMemberSheet],
  host: { class: 'sc' },
  template: `
    <app-bar title="Team" sub="Executive-wise performance" [back]="false" />
    <div class="body pad">
      <app-state [loading]="!d() && !err()" [error]="err()" (retry)="load()">
        @if (d(); as d) {
          <div class="sec-title">Ranking</div>
          <div class="card">
            @for (t of d.members; track t.id; let i = $index) {
              <button type="button" class="lrow" (click)="member.set(t)">
                <div class="av" [style.background]="i === 0 ? '#f59e0b' : '#0d6e50'">#{{ i + 1 }}</div>
                <div class="lr-main"><b>{{ t.name }}</b><span>{{ t.territory }} · {{ t.sales | inr }} · {{ att[t.attendance ?? 'absent'] }}</span></div>
                <div style="text-align:right"><b style="font-size:14px;color:var(--g)">{{ t.achievedPct }}%</b><div class="tiny">of {{ t.target | inr }}</div></div>
              </button>
            } @empty { <div class="empty">No executives in your team.</div> }
          </div>
          <div class="sec-title">Attendance Summary (today)</div>
          <div class="metrics" style="grid-template-columns:repeat(4,1fr)"><div><b>{{ d.attendanceToday.present }}</b><span>Present</span></div><div><b>{{ d.attendanceToday.late }}</b><span>Late</span></div><div><b>{{ d.attendanceToday.leave }}</b><span>Leave</span></div><div><b>{{ d.attendanceToday.absent }}</b><span>Absent</span></div></div>
        }
      </app-state>
    </div>
    <app-team-member-sheet [member]="member()" (closed)="member.set(null); load()" />`,
})
export class ManagerTeamPage {
  private api = inject(Api);
  d = signal<{ members: TeamMember[]; attendanceToday: { present: number; late: number; leave: number; absent: number } } | null>(null);
  err = signal<string | null>(null);
  member = signal<TeamMember | null>(null);
  att: Record<string, string> = { present: '🟢 Present', late: '🟠 Late', leave: '🔴 Leave', absent: '⚪ Not checked in' };
  constructor() { this.load(); }
  async load() {
    this.err.set(null);
    try { this.d.set(await this.api.get('/team')); } catch (e) { this.err.set(errorMessage(e)); }
  }
}

/* ── Live team tracking ── */
interface TeamPos { id: number; name: string; empCode: string; territory: string; lat: number | null; lng: number | null; lastSeenAt: string | null; lastLabel: string | null; status: 'active' | 'idle'; idleMinutes: number | null }

@Component({
  selector: 'app-manager-track',
  imports: [AppBar, StateView, RouteMap, TimePipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Live Team Tracking" [sub]="sel() ? sel()!.name + ' · today' : 'Real-time GPS'" [back]="false">
      <button class="bico" type="button" (click)="refresh()" aria-label="Refresh">⟳</button>
    </app-bar>
    <div class="body pad">
      <app-state [loading]="!team() && !err()" [error]="err()" (retry)="refresh()">
        <div class="card mb12" style="overflow:hidden">
          <div style="background:linear-gradient(135deg,#e0f2fe,#dbeafe);position:relative">
            @if (sel() && trail()) { <app-route-map [points]="trailPts()" [h]="200" /> } @else { <app-route-map [points]="teamPts()" [line]="false" [h]="200" /> }
            <div style="position:absolute;bottom:8px;left:8px" class="chip c-green"><span class="d"></span>{{ activeCount() }} active · {{ (team()?.length ?? 0) - activeCount() }} idle</div>
            @if (sel()) { <button type="button" class="pillbtn" style="position:absolute;top:8px;right:8px" (click)="pick(null)">Show team</button> }
          </div>
          @if (sel() && trail(); as t) { <div class="p"><div class="metrics" style="border:none"><div><b>{{ t.visits }}</b><span>Visits</span></div><div><b>{{ t.distanceKm }} km</b><span>Distance</span></div><div><b>{{ t.deviations }}</b><span>Deviations</span></div></div></div> }
        </div>
        <div class="card">
          @for (t of team() ?? []; track t.id) {
            <button type="button" class="lrow" [style.background]="sel()?.id === t.id ? 'var(--g2)' : ''" (click)="pick(t)">
              <div class="av" [style.background]="t.status === 'active' ? '#0d6e50' : '#94a3b8'">{{ ini(t.name) }}</div>
              <div class="lr-main"><b>{{ t.name }}</b><span>{{ t.territory }} · @if (t.lastSeenAt) { {{ t.lastLabel || 'Location' }} at {{ t.lastSeenAt | time }} } @else { no GPS today }@if (t.status === 'idle' && t.idleMinutes !== null) { · idle {{ t.idleMinutes }}m }</span></div>
              <span class="chip xs" [class.c-green]="t.status === 'active'" [class.c-grey]="t.status !== 'active'"><span class="d"></span>{{ t.status }}</span>
            </button>
          } @empty { <div class="empty">No executives in your team.</div> }
        </div>
      </app-state>
    </div>`,
})
export class ManagerTrackPage {
  userId = input<string>();
  private api = inject(Api);
  private ui = inject(Ui);
  team = signal<TeamPos[] | null>(null);
  err = signal<string | null>(null);
  sel = signal<TeamPos | null>(null);
  trail = signal<TrackingToday | null>(null);
  ini = initials;
  activeCount = computed(() => (this.team() ?? []).filter(t => t.status === 'active').length);
  teamPts = computed(() => (this.team() ?? []).filter(t => t.lat !== null).map(t => ({ lat: t.lat!, lng: t.lng!, label: t.name.split(' ')[0], tone: t.status === 'active' ? '#0d6e50' : '#94a3b8' })));
  trailPts = computed(() => (this.trail()?.points ?? []).map((p, i, a) => ({ ...p, label: i === a.length - 1 ? 'Now' : i === 0 ? 'Start' : 'V' + i })));
  constructor() { queueMicrotask(() => this.refresh()); }
  async refresh() {
    this.err.set(null);
    try {
      const t = await this.api.get<TeamPos[]>('/tracking/team');
      this.team.set(t);
      const want = this.sel()?.id ?? Number(this.userId());
      if (want) { const m = t.find(x => x.id === want); if (m) await this.pick(m); }
    } catch (e) { this.err.set(errorMessage(e)); }
  }
  async pick(t: TeamPos | null) {
    this.sel.set(t); this.trail.set(null);
    if (!t) return;
    try { this.trail.set(await this.api.get<TrackingToday>('/tracking/today', { userId: t.id })); } catch (e) { this.ui.error(errorMessage(e)); }
  }
}

/* ── Team reports ── */
interface SalesTrend { days: { date: string; amount: number }[]; total: number; changePct: number | null }
interface TeamSummary { beatChanges: { current: number; previous: number; changePct: number | null; byExec: { name: string; changes: number }[] }; attendance: { presentPct: number; late: number; leave: number } }

@Component({
  selector: 'app-manager-reports',
  imports: [FormsModule, AppBar, StateView, InrPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Team Reports" [back]="false" />
    <div class="body pad">
      <div class="sec-title">Team Sales — 6 days</div>
      <div class="card p">
        <app-state [loading]="!trend()">
          @if (trend(); as t) {
            <div class="between mb12"><b style="font-size:13px">{{ t.total | inr }}</b>@if (t.changePct !== null) { <span class="chip xs" [class.c-green]="t.changePct >= 0" [class.c-red]="t.changePct < 0"><span class="d"></span>{{ t.changePct >= 0 ? '▲' : '▼' }} {{ abs(t.changePct) }}% vs previous 6 days</span> }</div>
            <div class="bars">@for (d of t.days; track d.date) { <div [title]="d.date + ': ₹' + d.amount"><i [style.height.%]="barH(d.amount)"></i><span class="tiny">{{ dow(d.date) }}</span></div> }</div>
          }
        </app-state>
      </div>
      @if (s(); as s) {
        <div class="sec-title">Beat-change trend analysis</div>
        <div class="card p">
          <div class="muted">This month: <b>{{ s.beatChanges.current }}</b> beat changes vs <b>{{ s.beatChanges.previous }}</b> by the same day last month@if (s.beatChanges.changePct !== null) { ({{ s.beatChanges.changePct >= 0 ? '▲' : '▼' }} {{ abs(s.beatChanges.changePct) }}%) }.</div>
          @for (e of s.beatChanges.byExec; track e.name) { <div class="between mt8"><span style="font-size:12px;font-weight:700">{{ e.name }}</span><span class="chip xs" [class.c-red]="e.changes >= 5" [class.c-grey]="e.changes < 5">{{ e.changes }}</span></div> }
        </div>
        <div class="sec-title">Attendance summary (month to date)</div>
        <div class="metrics mb12"><div><b>{{ s.attendance.presentPct }}%</b><span>Present</span></div><div><b>{{ s.attendance.late }}</b><span>Late</span></div><div><b>{{ s.attendance.leave }}</b><span>Leave</span></div></div>
      }
      <div class="sec-title">Export</div>
      <div class="card p">
        <div class="no-2col"><div class="fld"><label for="mf">From</label><input id="mf" type="date" [(ngModel)]="from" [max]="today"></div><div class="fld"><label for="mt">To</label><input id="mt" type="date" [(ngModel)]="to" [max]="today"></div></div>
        <div class="fld"><label for="mty">Report</label><select id="mty" [(ngModel)]="type"><option value="team">Team performance</option><option value="orders">Team orders</option><option value="expenses">Team expenses</option><option value="attendance">Team attendance</option></select></div>
        <button class="btn ghost" type="button" [disabled]="busy()" (click)="export()">📥 Export Team Report (Excel CSV)</button>
      </div>
    </div>`,
})
export class ManagerReportsPage {
  private api = inject(Api);
  private ui = inject(Ui);
  trend = signal<SalesTrend | null>(null);
  s = signal<TeamSummary | null>(null);
  busy = signal(false);
  today = todayIso();
  from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  to = this.today;
  type = 'team';
  abs = Math.abs;
  barH = (a: number) => { const m = Math.max(...(this.trend()?.days.map(d => d.amount) ?? [1]), 1); return Math.max(2, (a / m) * 100); };
  dow = (iso: string) => 'SMTWTFS'[new Date(iso + 'T00:00:00').getDay()];
  constructor() {
    this.api.get<SalesTrend>('/reports/sales-trend', { days: 6, scope: 'team' })
      .then(t => this.trend.set(t)).catch(e => this.ui.error(errorMessage(e)));
    this.api.get<TeamSummary>('/reports/team-summary').then(s => this.s.set(s)).catch(() => {});
  }
  async export() {
    if (this.from > this.to) { this.ui.error('"From" must be before "To"'); return; }
    this.busy.set(true);
    try { await this.api.download('/reports/export', { type: this.type, from: this.from, to: this.to }, `${this.type}-${this.from}-to-${this.to}.csv`); this.ui.success('📥 Team report exported'); }
    catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
