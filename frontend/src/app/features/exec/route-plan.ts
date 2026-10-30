import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Ui } from '../../core/ui.service';
import { Beat, PlanStatus } from '../../core/models';
import { BEAT_COLOR, DtPipe, todayIso } from '../../core/format';
import { AppBar, Sheet, StateView, VisitBadge } from '../../shared/ui.components';
import { BeatList } from '../../shared/beat-list';
import { BeatChangeSheet } from '../../shared/beat-change-sheet';
import { PlanCalendar } from '../../shared/plan-calendar';
import { PlanStore } from './plan.store';

const STATUS: Record<PlanStatus, [string, string]> = {
  DRAFT: ['c-grey', 'Draft'], PENDING: ['c-amber', 'Pending'], APPROVED: ['c-green', 'Approved'], SENTBACK: ['c-red', 'Sent back'],
};

/* ── My Journey Plan ── */
@Component({
  selector: 'app-route-plan',
  imports: [FormsModule, RouterLink, AppBar, Sheet, StateView, BeatList, PlanCalendar, BeatChangeSheet],
  host: { class: 'sc' },
  template: `
    <app-bar title="My Journey Plan" [sub]="monthSub()" [back]="false">
      @if (store.plan(); as p) { <span class="chip {{ chip()[0] }}"><span class="d"></span>{{ chip()[1] }}</span> }
    </app-bar>
    <div class="body pad">
      <app-state [loading]="loading()" [error]="err()" (retry)="load()">
        @if (store.plan(); as p) {
          <div class="dash-cols"><div>
          <div class="card p">
            <b style="font-size:15px">Monthly Beat Plan</b><div class="muted">{{ auth.user()?.name }} · {{ auth.user()?.empCode }}</div>
            <div class="metrics mt12"><div><b>{{ p.stats.days }}</b><span>Working Days</span></div><div><b>{{ p.stats.beats }}</b><span>Beats Used</span></div><div><b>{{ p.stats.outlets }}</b><span>Outlets</span></div></div>
          </div>
          <div class="sec-title">This month at a glance</div>
          <div class="card p"><app-plan-calendar [year]="p.year" [month]="p.month" [days]="p.days" [codes]="codes()" /></div>
          @if (p.status === 'SENTBACK') {
            <div class="card p mt12" style="border-left:3px solid var(--r)"><b style="font-size:12px;color:var(--r)">↩ Sent back by {{ p.actionedBy || 'your manager' }}</b>
              <div class="muted" style="margin-top:4px">"{{ p.managerNote }}"</div></div>
          }
          <div class="btn-row mt14">
            @if (p.status === 'PENDING') { <button class="btn ghost" type="button" routerLink="/route/status">View Approval Status →</button> }
            @else {
              <button class="btn ghost" type="button" routerLink="/route/build">✎ Edit Plan</button>
              @if (p.status !== 'APPROVED') { <button class="btn primary" type="button" routerLink="/route/review">Review &amp; Submit →</button> }
              @else { <button class="btn primary" type="button" routerLink="/route/status">Approval Status →</button> }
            }
          </div>
          </div><div>
          @if (store.beats().length) {
            <app-beat-list [beats]="store.beats()" heading="Assigned Beats" [actions]="true" (logVisit)="openLog($event)" (beatChange)="openChange($event)" />
          }
          <div class="tiny center mt12">Tap a beat to expand its details · ⇄ Beat change inside</div>
          </div></div>
        }
      </app-state>
    </div>

    <app-sheet [(open)]="logOpen" heading="Log Beat Visit" [subheading]="logBeat()?.name + ' · today'">
      <div class="fld"><label for="lvv">Dealers visited</label><input id="lvv" type="number" min="1" [max]="logBeat()?.outlets ?? 99" [(ngModel)]="logV"></div>
      <div class="fld"><label for="lvo">Dealers who placed an order</label><input id="lvo" type="number" min="0" [(ngModel)]="logO"></div>
      <button class="btn primary" type="button" [disabled]="busy()" (click)="saveLog()">Save Visit</button>
    </app-sheet>

    <app-beat-change-sheet [(open)]="bcOpen" [from]="bcFrom()" />`,
})
export class RoutePlanPage {
  store = inject(PlanStore);
  auth = inject(AuthService);
  private api = inject(Api);
  private ui = inject(Ui);
  loading = signal(true);
  err = signal<string | null>(null);
  busy = signal(false);
  codes = computed(() => new Map(this.store.beats().map(b => [b.id, b.code])));
  chip = computed(() => STATUS[this.store.plan()?.status ?? 'DRAFT']);
  monthSub = computed(() => { const p = this.store.plan(); return p ? new Date(p.year, p.month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : ''; });
  color = (b: Beat) => BEAT_COLOR[b.colorTag];

  logOpen = signal(false); logBeat = signal<Beat | null>(null); logV = 1; logO = 0;
  bcOpen = signal(false); bcFrom = signal<Beat | null>(null);

  constructor() { this.load(); }
  async load() {
    this.loading.set(true); this.err.set(null);
    try { await this.store.load(); } catch (e) { this.err.set(errorMessage(e)); } finally { this.loading.set(false); }
  }
  openLog(b: Beat) { this.logBeat.set(b); this.logV = b.outlets; this.logO = Math.round(b.outlets * 0.6); this.logOpen.set(true); }
  async saveLog() {
    const v = Math.max(1, Math.floor(Number(this.logV) || 0)), o = Math.floor(Number(this.logO) || 0);
    if (o < 0 || o > v) { this.ui.error('Ordered dealers must be between 0 and dealers visited'); return; }
    this.busy.set(true);
    try {
      const before = this.logBeat()!.visitCount;
      const b = await this.api.post<Beat>(`/beats/${this.logBeat()!.id}/visits`, { visited: v, ordered: o });
      this.ui.success(b.visitCount === before ? `✅ Today's visit updated · ${b.indicator.code}` : `✅ Visit recorded · ${b.name} → ${b.indicator.code}`);
      this.logOpen.set(false);
      await this.store.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  openChange(b: Beat) { this.bcFrom.set(b); this.bcOpen.set(true); }
}

/* ── Build plan: tap dates, assign a beat ── */
@Component({
  selector: 'app-route-build',
  imports: [AppBar, Sheet, StateView, PlanCalendar, VisitBadge],
  host: { class: 'sc' },
  template: `
    <app-bar title="Build Plan" sub="Tap dates, then assign a beat" fallback="/route" />
    <div class="body pad">
      <app-state [loading]="!store.plan()">
        @if (store.plan(); as p) {
          @if (p.status === 'PENDING') { <div class="pc-alert">🔒 <span>The plan is locked until your manager reviews it.</span></div> }
          @if (selected().size) {
            <div class="card p mb12" style="background:var(--g2);border-color:var(--g3)"><div class="between"><b style="color:var(--g);font-size:13px">{{ selected().size }} date(s) selected</b>
              <div class="row" style="gap:6px"><button class="pillbtn" type="button" (click)="clearDays()">Clear days</button><button class="pillbtn on" type="button" (click)="assignOpen.set(true)">Assign Beat →</button></div></div></div>
          }
          @if (p.status !== 'PENDING') {
            <div class="wrap mb12">
              <button type="button" class="pillbtn" (click)="selectRemaining(false)">＋ Select remaining working days</button>
              <button type="button" class="pillbtn" (click)="selectRemaining(true)">＋ Select unplanned days only</button>
            </div>
          }
          <div class="card p"><app-plan-calendar [year]="p.year" [month]="p.month" [days]="draft()" [codes]="codes()" [selected]="selected()" [build]="p.status !== 'PENDING'" [lockPast]="true" (toggle)="toggle($event)" /></div>
          @if (legend().length) {
            <div class="card p mt12"><div class="tiny" style="font-weight:800;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Beat key</div>
              <div class="wrap">@for (b of legend(); track b.id) { <span class="chip c-green" style="font-weight:700"><b>{{ b.code.replace('BT-', '') }}</b> {{ b.name }} · {{ b.days }}d</span> }</div></div>
          }
          <div class="tiny center mt12" style="line-height:1.5">One beat per working day · Sundays are week-off · past days are locked.<br>Selected days already carrying a beat will be reassigned.</div>
        }
      </app-state>
    </div>
    <div class="bbar"><button class="btns" type="button" [disabled]="busy()" (click)="save('/route')">Save</button><button class="btnp" type="button" [disabled]="busy()" (click)="save('/route/review')">Review Plan →</button></div>

    <app-sheet [(open)]="assignOpen" heading="Choose a beat" [subheading]="'for ' + selected().size + ' selected date(s)'">
      @for (b of store.beats(); track b.id) {
        <button type="button" class="lrow" (click)="assign(b.id)">
          <div class="av" [style.background]="color(b)">{{ b.code.replace('BT-', '') }}</div>
          <div class="lr-main"><div class="bname-row"><b>{{ b.name }}</b><app-visit-badge [ind]="b.indicator" /></div><span>{{ b.code }} · {{ b.outlets }} outlets · {{ b.indicator.label }} this month</span></div>
          <div class="lr-go">›</div>
        </button>
      }
    </app-sheet>`,
})
export class RouteBuildPage {
  store = inject(PlanStore);
  private ui = inject(Ui);
  private router = inject(Router);
  selected = signal(new Set<number>());
  draft = signal<{ day: number; beatId: number }[]>([]);
  assignOpen = signal(false);
  busy = signal(false);
  codes = computed(() => new Map(this.store.beats().map(b => [b.id, b.code])));
  color = (b: Beat) => BEAT_COLOR[b.colorTag];

  constructor() {
    (this.store.plan() ? Promise.resolve(this.store.plan()) : this.store.load())
      .then(p => this.draft.set([...(p?.days ?? [])])).catch(e => this.ui.error(errorMessage(e)));
  }
  toggle(day: number) {
    const s = new Set(this.selected());
    s.has(day) ? s.delete(day) : s.add(day);
    this.selected.set(s);
  }
  assign(beatId: number) {
    const sel = this.selected();
    this.draft.set([...this.draft().filter(d => !sel.has(d.day)), ...[...sel].map(day => ({ day, beatId }))].sort((a, b) => a.day - b.day));
    this.selected.set(new Set());
    this.assignOpen.set(false);
    this.ui.toast('✅ Beat assigned — save to keep changes');
  }
  /** Selects every working day from today to month end (optionally only days without a beat). */
  selectRemaining(unplannedOnly: boolean) {
    const p = this.store.plan(); if (!p) return;
    const dim = new Date(p.year, p.month, 0).getDate(), today = todayIso(), planned = new Set(this.draft().map(d => d.day));
    const s = new Set<number>();
    for (let d = 1; d <= dim; d++) {
      const iso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso < today || new Date(p.year, p.month - 1, d).getDay() === 0 || (unplannedOnly && planned.has(d))) continue;
      s.add(d);
    }
    this.selected.set(s);
    if (!s.size) this.ui.toast('No days left to select this month');
  }
  legend = computed(() => {
    const counts = new Map<number, number>();
    this.draft().forEach(d => counts.set(d.beatId, (counts.get(d.beatId) ?? 0) + 1));
    return this.store.beats().filter(b => counts.has(b.id)).map(b => ({ id: b.id, code: b.code, name: b.name, days: counts.get(b.id)! }));
  });
  clearDays() {
    const sel = this.selected();
    this.draft.set(this.draft().filter(d => !sel.has(d.day)));
    this.selected.set(new Set());
  }
  async save(next: string) {
    if (this.store.plan()?.status === 'PENDING') { this.router.navigateByUrl(next); return; }
    this.busy.set(true);
    try { await this.store.saveDays(this.draft()); this.router.navigateByUrl(next); }
    catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}

/* ── Review & submit ── */
@Component({
  selector: 'app-route-review',
  imports: [AppBar, StateView],
  host: { class: 'sc' },
  template: `
    <app-bar title="Review & Submit" sub="Before you submit" fallback="/route" />
    <div class="body pad">
      <app-state [loading]="!store.plan()">
        @if (store.plan(); as p) {
          <div class="card p"><div class="metrics"><div><b>{{ p.stats.days }}</b><span>Days</span></div><div><b>{{ p.stats.beats }}</b><span>Beats</span></div><div><b>{{ p.stats.outlets }}</b><span>Outlets</span></div></div></div>
          <div class="sec-title">Beats in this plan</div>
          <div class="card">
            @for (b of planBeats(); track b.id) {
              <div class="lrow static"><div class="av" [style.background]="color(b.colorTag)">{{ b.code.replace('BT-', '') }}</div>
                <div class="lr-main"><b>{{ b.name }}</b><span>{{ dayCount(b.id) }} day(s) · {{ b.outlets }} outlets</span></div></div>
            } @empty { <div class="empty">No beat days yet — build your plan first.</div> }
          </div>
          <div class="sec-title">Approval</div>
          <div class="card p"><div class="row"><div class="av" style="background:#7c3aed">{{ mgrInit() }}</div>
            <div class="lr-main"><b>{{ auth.user()?.manager?.name || 'Your manager' }}</b><span>{{ auth.user()?.manager?.designation }} · your approver</span></div></div>
            <div class="muted mt8">Once submitted, the plan is locked until your manager approves it or sends it back with remarks.</div></div>
        }
      </app-state>
    </div>
    <div class="bbar"><button class="btnp" type="button" [disabled]="busy() || !store.plan()?.stats?.days || store.plan()?.status === 'PENDING'" (click)="submit()">Submit for Approval →</button></div>`,
})
export class RouteReviewPage {
  store = inject(PlanStore);
  auth = inject(AuthService);
  private ui = inject(Ui);
  private router = inject(Router);
  busy = signal(false);
  color = (t: string) => BEAT_COLOR[t];
  planBeats = computed(() => { const ids = new Set(this.store.plan()?.days.map(d => d.beatId)); return this.store.beats().filter(b => ids.has(b.id)); });
  dayCount = (id: number) => this.store.plan()?.days.filter(d => d.beatId === id).length ?? 0;
  mgrInit = () => (this.auth.user()?.manager?.name ?? 'M').split(' ').map(w => w[0]).join('').slice(0, 2);
  constructor() { if (!this.store.plan()) this.store.load().catch(e => this.ui.error(errorMessage(e))); }
  async submit() {
    this.busy.set(true);
    try { await this.store.submit(); this.ui.success('📤 Plan submitted to ' + (this.auth.user()?.manager?.name ?? 'your manager')); this.router.navigateByUrl('/route/status'); }
    catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}

/* ── Approval status timeline ── */
@Component({
  selector: 'app-route-status',
  imports: [RouterLink, AppBar, StateView, DtPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Approval Status" sub="This month's plan" fallback="/route" />
    <div class="body pad">
      <app-state [loading]="!store.plan()">
        @if (store.plan(); as p) {
          <div class="card p center"><span class="chip {{ chip()[0] }}"><span class="d"></span>{{ chip()[1] }}</span>
            <div class="muted mt8">{{ p.status === 'PENDING' ? 'Your plan is waiting for manager approval.' : p.status === 'APPROVED' ? 'Your plan is approved and active.' : p.status === 'SENTBACK' ? 'Your manager sent the plan back with remarks.' : 'Your plan has not been submitted yet.' }}</div></div>
          <div class="sec-title">Approval timeline</div>
          <div class="card p"><div class="timeline">
            <div class="tl-item done"><b>Plan created</b><span>{{ p.createdAt | dt }}</span></div>
            <div class="tl-item" [class.done]="!!p.submittedAt"><b>Submitted for approval</b><span>{{ p.submittedAt ? (p.submittedAt | dt) : 'Not submitted' }}</span></div>
            @if (p.status === 'APPROVED') { <div class="tl-item done"><b>Approved by {{ p.actionedBy }}</b><span>{{ p.actionedAt | dt }} · Plan is now active</span></div> }
            @else if (p.status === 'SENTBACK') { <div class="tl-item bad"><b>Sent back by {{ p.actionedBy }}</b><span>"{{ p.managerNote }}"</span></div> }
            @else if (p.status === 'PENDING') { <div class="tl-item active"><b>Awaiting {{ auth.user()?.manager?.name || 'manager' }}</b><span>Pending review</span></div> }
          </div></div>
          @if (p.status === 'SENTBACK' || p.status === 'DRAFT') { <button class="btn primary mt14" type="button" routerLink="/route/build">{{ p.status === 'DRAFT' ? 'Build Plan →' : 'Revise Plan →' }}</button> }
        }
      </app-state>
    </div>`,
})
export class RouteStatusPage {
  store = inject(PlanStore);
  auth = inject(AuthService);
  chip = computed(() => STATUS[this.store.plan()?.status ?? 'DRAFT']);
  constructor() { this.store.load().catch(() => {}); }
}
