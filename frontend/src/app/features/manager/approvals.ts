import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { Badges } from '../../core/badges.service';
import { BeatChange, Expense, LeaveRequest, Order, OrderList, Outlet, Plan, Regularization } from '../../core/models';
import { DPipe, DtPipe, InrPipe, initials } from '../../core/format';
import { AppBar, InsightStripView, Sheet, StateView } from '../../shared/ui.components';
import { BeatCard, BeatList } from '../../shared/beat-list';
import { PlanCalendar } from '../../shared/plan-calendar';

type Kind = 'beatChange' | 'expense' | 'outlet' | 'leave' | 'regularization';
interface Recent { kind: string; id: number; userName: string; title: string; status: string; actionedAt: string }

@Component({
  selector: 'app-approvals',
  imports: [FormsModule, AppBar, Sheet, StateView, InsightStripView, BeatCard, InrPipe, DPipe, DtPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Approvals" [sub]="total() + ' pending your action'" [back]="false" />
    <div class="body pad">
      <app-state [loading]="loading()" [error]="err()" (retry)="load()">
        <div class="sec-title">Pending</div>
        <div class="card">
          @for (p of plans(); track p.id) {
            <button type="button" class="lrow" (click)="router.navigate(['/manager/plans', p.id])">
              <div class="av" style="background:#2540d9">{{ ini(p.userName) }}</div>
              <div class="lr-main"><b>{{ p.userName }} · {{ monthName(p.month) }} plan</b><span>Journey plan · {{ p.stats.days }} days · {{ p.stats.beats }} beats · submitted {{ p.submittedAt | dt }}</span>
                @if (p.insights) { <app-insight-strip [s]="p.insights" /> }</div>
              <span class="chip xs c-amber"><span class="d"></span>Plan</span></button>
          }
          @for (b of beatChanges(); track b.id) {
            <button type="button" class="lrow" (click)="open('beatChange', b)">
              <div class="av" style="background:#d97706">{{ ini(b.userName) }}</div>
              <div class="lr-main"><b>{{ b.userName }} · Beat change</b><span>{{ b.fromBeat }} → {{ b.toBeat }} · {{ b.forDate | d }} · "{{ b.remarks }}"</span>
                @if (b.insights) { <app-insight-strip [s]="b.insights" /> }</div>
              <span class="chip xs c-blue"><span class="d"></span>Beat</span></button>
          }
          @for (o of creditOrders(); track o.id) {
            <button type="button" class="lrow" (click)="router.navigate(['/orders', o.id])">
              <div class="av" style="background:#991b1b">{{ ini(o.execName) }}</div>
              <div class="lr-main"><b>{{ o.execName }} · Order {{ o.totalAmount | inr }}</b><span>{{ o.orderNo }} · {{ o.outletName }} · credit limit exceeded</span></div>
              <span class="chip xs c-red"><span class="d"></span>Credit</span></button>
          }
          @for (e of expenses(); track e.id) {
            <button type="button" class="lrow" (click)="open('expense', e)">
              <div class="av" style="background:#dc2626">{{ ini(e.userName) }}</div>
              <div class="lr-main"><b>{{ e.userName }} · Expense {{ e.amount | inr }}</b><span>{{ e.type }} · {{ e.date | d }}@if (e.overLimit) { · exceeds {{ e.limit | inr }} limit }</span></div>
              <span class="chip xs c-red"><span class="d"></span>Expense</span></button>
          }
          @for (o of outlets(); track o.id) {
            <button type="button" class="lrow" (click)="open('outlet', o)">
              <div class="av" style="background:#0d9488">{{ ini(o.createdBy || '?') }}</div>
              <div class="lr-main"><b>{{ o.createdBy }} · New outlet</b><span>"{{ o.name }}" · {{ o.beatName }} · with GPS</span></div>
              <span class="chip xs c-purple"><span class="d"></span>Outlet</span></button>
          }
          @for (l of leaves(); track l.id) {
            <button type="button" class="lrow" (click)="open('leave', l)">
              <div class="av" style="background:#7c3aed">{{ ini(l.userName || '?') }}</div>
              <div class="lr-main"><b>{{ l.userName }} · {{ l.kind === 'LEAVE' ? 'Leave' : 'Permission' }}</b><span>{{ l.leaveType }} · {{ l.fromDate | d }}{{ l.toDate !== l.fromDate ? ' – ' + (l.toDate | d) : '' }}</span></div>
              <span class="chip xs c-grey"><span class="d"></span>Leave</span></button>
          }
          @for (r of regs(); track r.id) {
            <button type="button" class="lrow" (click)="open('regularization', r)">
              <div class="av" style="background:#475569">{{ ini(r.userName || '?') }}</div>
              <div class="lr-main"><b>{{ r.userName }} · Regularization</b><span>{{ r.date | d }} · {{ r.reason }}</span></div>
              <span class="chip xs c-grey"><span class="d"></span>Attendance</span></button>
          }
          @if (!total()) { <div class="empty">Nothing waiting for you. 🎉</div> }
        </div>
        <div class="sec-title">Recently actioned</div>
        <div class="card">
          @for (r of recent(); track r.kind + r.id) {
            <div class="lrow static"><div class="av" [style.background]="r.status === 'APPROVED' ? '#0d6e50' : '#d97706'">{{ ini(r.userName) }}</div>
              <div class="lr-main"><b>{{ r.userName }} · {{ r.title }}</b><span>{{ r.actionedAt | dt }}</span></div>
              <span class="chip xs" [class.c-green]="r.status === 'APPROVED'" [class.c-red]="r.status !== 'APPROVED'"><span class="d"></span>{{ r.status === 'SENTBACK' ? 'Sent back' : r.status.toLowerCase() }}</span></div>
          } @empty { <div class="empty">No recent actions.</div> }
        </div>
      </app-state>
    </div>

    <app-sheet [open]="!!cur()" (openChange)="!$event && cur.set(null)" [heading]="heading()" [subheading]="subheading()">
      @if (cur(); as c) {
        @switch (c.kind) {
          @case ('beatChange') {
            <div class="sec-title" style="margin-top:0">From beat</div>
            @if (asBc(c.item).from; as f) { <div class="card mb12"><app-beat-card [b]="f" [open]="true" /></div> }
            <div class="sec-title" style="margin-top:0">To beat</div>
            @if (asBc(c.item).to; as t) { <div class="card mb12"><app-beat-card [b]="t" [open]="true" /></div> }
          }
          @case ('expense') {
            @if (asExp(c.item); as e) {
              <div class="card p mb12"><div class="between"><span class="muted">Amount</span><b>{{ e.amount | inr }}</b></div><div class="between mt8"><span class="muted">Eligible limit</span><b [style.color]="e.overLimit ? 'var(--r)' : ''">{{ e.limit | inr }}</b></div>
                @if (e.notes) { <div class="muted mt8">{{ e.notes }}</div> }
                @if (e.billUrl) { <a class="btn ghost sm mt12" style="width:100%" [href]="e.billUrl" target="_blank" rel="noopener">🧾 View bill</a> } @else { <div class="tiny mt8">No bill attached</div> }</div>
            }
          }
          @case ('outlet') {
            @if (asOutlet(c.item); as o) {
              <div class="card p mb12"><div class="muted">{{ o.owner }} · {{ o.mobile }} · {{ o.type }}</div><div class="muted">{{ o.address.line }}, {{ o.address.city }} {{ o.address.postalCode }}</div>
                @if (o.gstin) { <div class="tiny mt8">GSTIN {{ o.gstin }} · PAN {{ o.pan }}</div> }
                <div class="tiny">📍 {{ o.lat }}, {{ o.lng }}</div>
                <div class="kyc-grid mt12">@for (d of o.documents ?? []; track d.url) { <a class="kyc-th" [href]="d.url" target="_blank" rel="noopener"><img [src]="d.url" [alt]="d.type"><em>{{ d.type }}</em></a> }</div></div>
              <div class="no-2col"><div class="fld"><label for="oc">Outlet class</label><select id="oc" [(ngModel)]="outletClass"><option>A</option><option>B</option><option>C</option></select></div>
                <div class="fld"><label for="ocl">Credit limit (₹)</label><input id="ocl" type="number" min="0" [(ngModel)]="creditLimit"></div></div>
            }
          }
          @case ('leave') { @if (asLeave(c.item); as l) { <div class="card p mb12"><div class="muted">Reason: {{ l.reason }}</div>@if (l.hours) { <div class="tiny">{{ l.hours }} hours</div> }</div> } }
          @case ('regularization') { @if (asReg(c.item); as r) { <div class="card p mb12"><div class="muted">{{ r.reason }}</div></div> } }
        }
        <div class="fld"><label for="ar">Remarks <span class="tiny">(required to reject)</span></label><textarea id="ar" [(ngModel)]="remark" maxlength="300" placeholder="Optional note…"></textarea></div>
        <div class="btn-row"><button class="btn danger-ghost" type="button" [disabled]="busy()" (click)="act(false)">Reject / Send back</button><button class="btn teal" type="button" [disabled]="busy()" (click)="act(true)">Approve</button></div>
      }
    </app-sheet>`,
})
export class ApprovalsPage {
  router = inject(Router);
  private api = inject(Api);
  private ui = inject(Ui);
  private badges = inject(Badges);
  loading = signal(true);
  err = signal<string | null>(null);
  busy = signal(false);
  plans = signal<Plan[]>([]);
  beatChanges = signal<BeatChange[]>([]);
  expenses = signal<Expense[]>([]);
  outlets = signal<Outlet[]>([]);
  leaves = signal<LeaveRequest[]>([]);
  regs = signal<Regularization[]>([]);
  creditOrders = signal<Order[]>([]);
  recent = signal<Recent[]>([]);
  cur = signal<{ kind: Kind; item: unknown } | null>(null);
  remark = '';
  outletClass = 'C';
  creditLimit = 50000;
  ini = initials;
  total = computed(() => this.plans().length + this.beatChanges().length + this.expenses().length + this.outlets().length + this.leaves().length + this.regs().length + this.creditOrders().length);
  monthName = (m: number) => new Date(2000, m - 1).toLocaleString('en-IN', { month: 'long' });
  asBc = (x: unknown) => x as BeatChange;
  asExp = (x: unknown) => x as Expense;
  asOutlet = (x: unknown) => x as Outlet;
  asLeave = (x: unknown) => x as LeaveRequest;
  asReg = (x: unknown) => x as Regularization;
  heading = computed(() => {
    const c = this.cur(); if (!c) return '';
    return ({ beatChange: 'Beat Change', expense: 'Expense', outlet: 'New Outlet', leave: 'Leave Request', regularization: 'Regularization' } as Record<Kind, string>)[c.kind];
  });
  subheading = computed(() => {
    const c = this.cur(); if (!c) return '';
    const i = c.item as { userName?: string; createdBy?: string; fromBeat?: string; toBeat?: string; name?: string };
    return c.kind === 'beatChange' ? `${i.userName} · ${i.fromBeat} → ${i.toBeat}` : c.kind === 'outlet' ? `${i.name} · by ${i.createdBy}` : i.userName ?? '';
  });

  constructor() { this.load(); }
  async load() {
    this.err.set(null);
    try {
      const [plans, bc, exp, outlets, leaves, regs, orders, recent] = await Promise.all([
        this.api.get<Plan[]>('/plans/pending'), this.api.get<BeatChange[]>('/beat-changes', { status: 'PENDING', withInsights: true }),
        this.api.get<Expense[]>('/expenses', { status: 'PENDING' }), this.api.get<Outlet[]>('/outlets/pending'),
        this.api.get<LeaveRequest[]>('/leaves'), this.api.get<Regularization[]>('/regularizations'),
        this.api.get<OrderList>('/orders', { status: 'RECEIVED', creditHold: true, pageSize: 100 }), this.api.get<Recent[]>('/approvals/recent'),
      ]);
      this.plans.set(plans); this.beatChanges.set(bc); this.expenses.set(exp); this.outlets.set(outlets);
      this.leaves.set(leaves); this.regs.set(regs); this.creditOrders.set(orders.items.filter(o => o.creditHold)); this.recent.set(recent);
    } catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  open(kind: Kind, item: unknown) {
    this.remark = '';
    if (kind === 'outlet') { const o = item as Outlet; this.outletClass = o.outletClass; this.creditLimit = o.creditLimit || 50000; }
    this.cur.set({ kind, item });
  }
  async act(approve: boolean) {
    const c = this.cur(); if (!c) return;
    if (!approve && !this.remark.trim()) { this.ui.error('Remarks are required when rejecting'); return; }
    const id = (c.item as { id: number }).id;
    const path = { beatChange: 'beat-changes', expense: 'expenses', outlet: 'outlets', leave: 'leaves', regularization: 'regularizations' }[c.kind];
    const body: Record<string, unknown> = { remark: this.remark.trim() || undefined };
    if (c.kind === 'outlet' && approve) { body['outletClass'] = this.outletClass; body['creditLimit'] = Number(this.creditLimit) || 0; }
    this.busy.set(true);
    try {
      await this.api.post(`/${path}/${id}/${approve ? 'approve' : 'reject'}`, body);
      this.ui.success(approve ? '✅ Approved' : '↩ Sent back');
      this.cur.set(null);
      this.badges.refresh(true);
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}

/* ── Manager review of an executive's journey plan ── */
@Component({
  selector: 'app-plan-review',
  imports: [FormsModule, AppBar, StateView, InsightStripView, BeatList, PlanCalendar, DtPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Review Plan" [sub]="(p()?.userName ?? '') + ' · ' + monthLabel()" fallback="/manager/approvals" />
    <div class="body pad">
      <app-state [loading]="!p() && !err()" [error]="err()" (retry)="load()">
        @if (p(); as p) {
          <div class="card p"><div class="row"><div class="av" style="background:#2540d9">{{ ini(p.userName) }}</div>
            <div class="lr-main"><b>{{ p.userName }}</b><span>{{ p.empCode }} · submitted {{ p.submittedAt | dt }}</span></div>
            <span class="chip xs" [class.c-amber]="p.status === 'PENDING'" [class.c-green]="p.status === 'APPROVED'" [class.c-red]="p.status === 'SENTBACK'"><span class="d"></span>{{ p.status }}</span></div>
            <div class="metrics mt12"><div><b>{{ p.stats.days }}</b><span>Days</span></div><div><b>{{ p.stats.beats }}</b><span>Beats</span></div><div><b>{{ p.stats.outlets }}</b><span>Outlets</span></div></div></div>
          <div class="sec-title">Planned month</div>
          <div class="card p"><app-plan-calendar [year]="p.year" [month]="p.month" [days]="p.days" [codes]="codes()" /></div>
          <div class="sec-title">Beat Insights</div>
          <div class="card p">
            <div class="metrics"><div><b>{{ aClass() }}<small style="font-size:11px;color:var(--t3)">/{{ p.stats.outlets ? outletTotal() : 0 }}</small></b><span>A-class outlets</span></div>
              <div><b [class.t-low]="avgPc() < 40" [class.t-mid]="avgPc() >= 40 && avgPc() < 70" [class.t-hi]="avgPc() >= 70">{{ avgPc() }}%</b><span>Avg productive calls</span></div>
              <div><b>{{ attention() }}</b><span>Need attention</span></div></div>
            @if (p.insights) { <div class="center"><app-insight-strip [s]="p.insights" /></div> }
          </div>
          @if (p.beats?.length) { <app-beat-list [beats]="p.beats!" heading="Beats in this plan" /> }
          @if (p.status === 'PENDING') {
            <div class="sec-title">Remarks <span style="text-transform:none;font-weight:500;color:var(--t3)">(required if sending back)</span></div>
            <div class="fld"><textarea [(ngModel)]="note" rows="3" maxlength="500" [placeholder]="'Add a note for ' + p.userName.split(' ')[0] + '…'" aria-label="Remarks"></textarea></div>
            <div class="btn-row"><button class="btn danger-ghost" type="button" [disabled]="busy()" (click)="act(false)">Send back</button><button class="btn teal" type="button" [disabled]="busy()" (click)="act(true)">Approve plan</button></div>
          } @else if (p.managerNote) { <div class="card p mt12"><div class="muted">Manager note: "{{ p.managerNote }}"</div></div> }
        }
      </app-state>
    </div>`,
})
export class PlanReviewPage {
  id = input.required<string>();
  private api = inject(Api);
  private ui = inject(Ui);
  private router = inject(Router);
  private badges = inject(Badges);
  p = signal<Plan | null>(null);
  err = signal<string | null>(null);
  busy = signal(false);
  note = '';
  ini = initials;
  codes = computed(() => new Map((this.p()?.beats ?? []).map(b => [b.id, b.code])));
  monthLabel = computed(() => { const p = this.p(); return p ? new Date(p.year, p.month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : ''; });
  aClass = computed(() => (this.p()?.beats ?? []).reduce((s, b) => s + b.mix.a, 0));
  outletTotal = computed(() => (this.p()?.beats ?? []).reduce((s, b) => s + b.outlets, 0));
  avgPc = computed(() => {
    const lv = (this.p()?.beats ?? []).map(b => b.lastVisit).filter(Boolean);
    const v = lv.reduce((s, x) => s + x!.visited, 0);
    return v ? Math.round((lv.reduce((s, x) => s + x!.ordered, 0) / v) * 100) : 0;
  });
  attention = computed(() => (this.p()?.beats ?? []).filter(b => b.priority.group !== 'ok').length);
  constructor() { queueMicrotask(() => this.load()); }
  async load() {
    this.err.set(null);
    try { this.p.set(await this.api.get<Plan>(`/plans/${this.id()}`)); } catch (e) { this.err.set(errorMessage(e)); }
  }
  async act(approve: boolean) {
    if (!approve && !this.note.trim()) { this.ui.error('Remarks required to send back'); return; }
    this.busy.set(true);
    try {
      await this.api.post(`/plans/${this.id()}/${approve ? 'approve' : 'send-back'}`, { note: this.note.trim() || undefined });
      this.ui.success(approve ? '✅ Plan approved' : '↩ Plan sent back');
      this.badges.refresh(true);
      this.router.navigateByUrl('/manager/approvals');
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
