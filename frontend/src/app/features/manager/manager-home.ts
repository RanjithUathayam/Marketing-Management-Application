import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Beat, ManagerDashboard, TeamMember } from '../../core/models';
import { InrPipe, fmtD, initials } from '../../core/format';
import { StateView, VisitBadge } from '../../shared/ui.components';
import { Avatar } from '../../shared/avatar';
import { TeamMemberSheet } from './team-member-sheet';

@Component({
  selector: 'app-manager-home',
  imports: [RouterLink, StateView, VisitBadge, InrPipe, TeamMemberSheet, Avatar],
  host: { class: 'sc' },
  template: `
    <header class="bar grad" style="padding-bottom:16px">
      <app-avatar style="background:rgba(255,255,255,.2)" />
      <div class="btitle">{{ auth.user()?.name }}<small>{{ auth.user()?.designation }} · {{ auth.user()?.region }}</small></div>
      <button class="bico" type="button" routerLink="/notifications" aria-label="Notifications">🔔</button>
      <button class="bico" type="button" routerLink="/manager/approvals" aria-label="Approvals">📥@if (d()?.pendingApprovals) {<span class="notif-dot"></span>}</button>
    </header>
    <div class="body pad">
      <app-state [loading]="!d() && !err()" [error]="err()" (retry)="load()">
        @if (d(); as d) {
          <div class="kpi-grid">
            <div class="kpi" [class.up]="(d.salesTrendPct ?? 0) >= 0" [class.down]="(d.salesTrendPct ?? 0) < 0"><div class="kico">💰</div><div class="kv">{{ d.teamSalesMtd | inr }}</div><div class="kl">Team Sales (MTD)</div>
              <div class="ktrend">@if (d.salesTrendPct !== null) { {{ d.salesTrendPct >= 0 ? '▲' : '▼' }} {{ abs(d.salesTrendPct) }}% vs last month } @else { — }</div></div>
            <div class="kpi"><div class="kico">🎯</div><div class="kv">{{ d.teamTargetPct }}%</div><div class="kl">Team Target</div><div class="ktrend">Achievement MTD</div></div>
            <div class="kpi up"><div class="kico">👥</div><div class="kv">{{ d.activeNow }}/{{ d.teamSize }}</div><div class="kl">Active Now</div><div class="ktrend">{{ d.teamSize - d.activeNow }} idle</div></div>
            <button type="button" class="kpi" style="text-align:left;cursor:pointer" routerLink="/manager/approvals"><div class="kico">📥</div><div class="kv">{{ d.pendingApprovals }}</div><div class="kl">Pending Approvals</div>
              <div class="ktrend" style="color:var(--amber)">{{ d.pendingApprovals ? 'Action needed' : 'All clear' }}</div></button>
          </div>

          <div class="dash-cols"><div>
          <div class="sec-title">Beat Change Trend (this month)</div>
          <div class="card p">
            <div class="bars" style="height:80px">@for (b of d.beatChangeTrend; track b.userId) { <div [title]="b.name + ': ' + b.count"><i [class.warn]="b.unusual" [style.height.%]="bcH(b.count)"></i><span class="tiny">{{ b.name.split(' ')[0] }}</span></div> }</div>
            @for (b of unusual(); track b.userId) { <div class="tiny center mt8">⚠ {{ b.name }} has unusually high beat changes ({{ b.count }}) — review.</div> }
            @if (!unusual().length) { <div class="tiny center mt8">No unusual beat-change activity.</div> }
          </div>

          <div class="sec-title">Executive Performance</div>
          <div class="card">
            @for (t of d.team; track t.id) {
              <button type="button" class="lrow" (click)="member.set(t)">
                <div class="av" [style.background]="t.status === 'active' ? '#0d6e50' : '#94a3b8'">{{ ini2(t.name) }}</div>
                <div class="lr-main"><b>{{ t.name }}</b><span>{{ t.empCode }} · {{ t.territory }} · {{ t.sales | inr }}</span></div>
                <div style="text-align:right"><span class="chip xs {{ rank[t.rank][0] }}"><span class="d"></span>{{ rank[t.rank][1] }}</span><div class="tiny" style="margin-top:3px">{{ t.achievedPct }}%</div></div>
              </button>
            } @empty { <div class="empty">No executives report to you yet.</div> }
          </div>

          <div class="sec-title">Sample Pad Acknowledgement</div>
          <div class="card">
            @for (s of d.samplePads; track s.userId) {
              <button type="button" class="lrow" (click)="router.navigate(['/manager/sample-pads'], { queryParams: { userId: s.userId } })">
                <div class="av" [style.background]="s.pending ? 'var(--ix)' : '#0d6e50'">{{ ini2(s.name) }}</div>
                <div class="lr-main"><b>{{ s.name }}</b><span>{{ s.empCode }} · {{ s.acknowledged }}/{{ s.issued }} acknowledged@if (s.pending) { · <b style="display:inline;font-size:11px;color:#b45309">{{ s.pending }} pending</b> }</span>
                  <div class="spx-mini"><i [style.width.%]="s.issued ? (s.acknowledged / s.issued) * 100 : 0"></i></div></div><div class="lr-go">›</div>
              </button>
            }
            <button type="button" class="lrow" style="justify-content:center;color:var(--ix);font-weight:800;font-size:12px" routerLink="/manager/sample-pads">Open Sample Pad object · {{ padAck() }}/{{ padIssued() }} acknowledged →</button>
          </div>

          </div><div>
          <div class="sec-title">Beat Visit Status · {{ monthName }}</div>
          @if (nvBeats().length) { <div class="pc-alert nvb">🚫 <span><b>{{ nvBeats().length }} beat{{ nvBeats().length > 1 ? 's' : '' }} not visited this month (NV)</b> — {{ nvNames() }}</span></div> }
          <div class="card">
            @for (b of d.beats; track b.id; let i = $index) {
              @if (i === 0 || d.beats[i - 1].priority.group !== b.priority.group) { <div class="prio-head {{ b.priority.group }}"><span>{{ grp[b.priority.group] }}</span><em>{{ groupCount(b.priority.group) }}</em></div> }
              <div class="lrow static"><app-visit-badge [ind]="b.indicator" size="lg" />
                <div class="lr-main"><b>{{ b.name }}</b><span>{{ b.code }} · {{ b.indicator.label }} this month@if (b.lastVisit) { · last {{ fmtD(b.lastVisit.date) }} }</span>
                  @if (b.priority.group !== 'ok') { <div class="prio-why {{ b.priority.group }}">{{ b.priority.group === 'nv' ? 'Not visited this month' : 'Must visit' }}@for (r of b.priority.reasons; track r) { · {{ r }} }</div> }</div>
                @if (b.productiveCalls; as pc) { <div class="mpc {{ pc.level }}"><b>{{ b.lastVisit!.ordered }}/{{ b.lastVisit!.visited }}</b><span>{{ pc.pct }}% PC</span></div> }
              </div>
            }
          </div>
          <div class="vlegend"><span><em class="vind nv">NV</em>Not visited</span><span><em class="vind v1">MV</em>1</span><span><em class="vind v2">V2</em>2</span><span><em class="vind v3">V3</em>3</span><span><em class="vind v4">V4+</em>4+</span></div>
          </div></div>
        }
      </app-state>
    </div>
    <app-team-member-sheet [member]="member()" (closed)="member.set(null)" />`,
})
export class ManagerHomePage {
  auth = inject(AuthService);
  router = inject(Router);
  private api = inject(Api);
  d = signal<ManagerDashboard | null>(null);
  err = signal<string | null>(null);
  member = signal<TeamMember | null>(null);
  abs = Math.abs;
  fmtD = fmtD;
  monthName = new Date().toLocaleString('en-IN', { month: 'long' });
  rank: Record<string, [string, string]> = { top: ['c-green', 'Top'], avg: ['c-blue', 'Avg'], low: ['c-red', 'Low'] };
  grp: Record<string, string> = { nv: '🚫 Not Visited', must: '⚑ Must Visit', ok: '✓ On Track' };
  ini2 = initials;
  unusual = computed(() => this.d()?.beatChangeTrend.filter(b => b.unusual) ?? []);
  nvBeats = computed(() => this.d()?.beats.filter(b => b.group === 'nv') ?? []);
  nvNames = computed(() => this.nvBeats().map((b: Beat) => b.name).join(', '));
  padAck = computed(() => this.d()?.samplePads.reduce((s, x) => s + x.acknowledged, 0) ?? 0);
  padIssued = computed(() => this.d()?.samplePads.reduce((s, x) => s + x.issued, 0) ?? 0);
  bcH = (n: number) => { const m = Math.max(...(this.d()?.beatChangeTrend.map(b => b.count) ?? [1]), 1); return Math.max(3, (n / m) * 100); };
  groupCount = (g: string) => this.d()?.beats.filter(b => b.priority.group === g).length ?? 0;
  constructor() { this.load(); }
  async load() {
    this.err.set(null);
    try { this.d.set(await this.api.get<ManagerDashboard>('/dashboard/manager')); } catch (e) { this.err.set(errorMessage(e)); }
  }
}
