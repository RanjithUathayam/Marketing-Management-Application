import { Component, OnDestroy, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { Expense, Outlet } from '../../core/models';
import { DPipe, DtPipe, InrPipe, MONTHS_LONG, todayIso } from '../../core/format';
import { AppBar, Sheet, StateView } from '../../shared/ui.components';

/* ── Market survey ── */
@Component({
  selector: 'app-survey',
  imports: [FormsModule, AppBar, StateView],
  host: { class: 'sc' },
  template: `
    <app-bar title="Market Survey" [sub]="outlet()?.name" fallback="/outlets" />
    <div class="body pad">
      <app-state [loading]="!sections().length && !err()" [error]="err()" (retry)="load()">
        @for (s of sections(); track s.code) {
          <div class="card p" style="margin-bottom:9px">
            <label [for]="'sv-' + s.code" style="font-size:13px;font-weight:800">{{ s.title }}</label>
            <div class="muted" style="margin:5px 0 9px">{{ s.hint }}</div>
            <div class="fld" style="margin:0"><textarea [id]="'sv-' + s.code" [(ngModel)]="answers[s.code]" maxlength="2000" placeholder="Record observation…"></textarea></div>
          </div>
        }
      </app-state>
    </div>
    <div class="bbar"><button class="btnp" type="button" [disabled]="busy()" (click)="submit()">Submit Survey →</button></div>`,
})
export class SurveyPage {
  outletId = input.required<string>();
  private api = inject(Api);
  private ui = inject(Ui);
  private location = inject(Location);
  outlet = signal<Outlet | null>(null);
  sections = signal<{ code: string; title: string; hint: string }[]>([]);
  answers: Record<string, string> = {};
  err = signal<string | null>(null);
  busy = signal(false);
  constructor() { queueMicrotask(() => this.load()); }
  async load() {
    this.err.set(null);
    try {
      const [o, s] = await Promise.all([this.api.get<Outlet>(`/outlets/${this.outletId()}`), this.api.get<{ code: string; title: string; hint: string }[]>('/surveys/sections')]);
      this.outlet.set(o); this.sections.set(s);
    } catch (e) { this.err.set(errorMessage(e)); }
  }
  async submit() {
    if (!Object.values(this.answers).some(v => v?.trim())) { this.ui.error('Record at least one observation'); return; }
    this.busy.set(true);
    try {
      await this.api.post('/surveys', { outletId: Number(this.outletId()), answers: this.answers });
      this.ui.success('✅ Survey submitted');
      this.location.back();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}

/* ── Payment collection ── */
interface PaySummary { totalDue: number; collected: number; balance: number; history: { receiptNo: string; amount: number; method: string; reference: string | null; collectedAt: string; collectedBy: string }[] }

@Component({
  selector: 'app-payment',
  imports: [FormsModule, AppBar, StateView, Sheet, InrPipe, DtPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Payment Collection" [sub]="outlet()?.name" fallback="/outlets" />
    <div class="body pad">
      <app-state [loading]="!s() && !err()" [error]="err()" (retry)="load()">
        @if (s(); as s) {
          <div class="card p"><div class="metrics">
            <div><b style="font-size:14px">{{ s.totalDue | inr }}</b><span>Total Due</span></div>
            <div><b style="font-size:14px;color:var(--g)">{{ s.collected | inr }}</b><span>Collected</span></div>
            <div><b style="font-size:14px;color:var(--r)">{{ s.balance | inr }}</b><span>Balance</span></div></div></div>
          <div class="sec-title">Collect Payment</div>
          <div class="card p">
            <div class="fld"><label for="pa">Amount</label><input id="pa" type="number" inputmode="decimal" min="1" [max]="s.balance" [(ngModel)]="amount" placeholder="₹ Enter amount"></div>
            <div class="fld"><label>Payment Method</label><div class="seg">@for (m of methods; track m) { <button type="button" [class.on]="method() === m" (click)="method.set(m)">{{ m === 'UPI' ? 'UPI' : m[0] + m.slice(1).toLowerCase() }}</button> }</div></div>
            @if (method() !== 'CASH') { <div class="fld" style="margin-bottom:0"><label for="pr">{{ method() === 'UPI' ? 'UPI Transaction ID' : 'Cheque Number' }}</label><input id="pr" [(ngModel)]="reference" maxlength="60"></div> }
            <div class="tiny mt8">Status after collection: <b>{{ statusAfter() }}</b></div>
          </div>
          <button class="btn primary mt14" type="button" [disabled]="busy() || s.balance <= 0" (click)="collect()">Collect &amp; Generate Receipt</button>
          <div class="sec-title">Collection History</div>
          <div class="card">
            @for (h of s.history; track h.receiptNo) {
              <div class="lrow static"><div class="av" style="background:var(--g1)">₹</div><div class="lr-main"><b>{{ h.amount | inr }}</b><span>{{ h.collectedAt | dt }} · {{ h.method }} · {{ h.receiptNo }}</span></div><span class="chip xs c-green"><span class="d"></span>Paid</span></div>
            } @empty { <div class="empty">No collections yet.</div> }
          </div>
          @if (s.balance > 0) { <div class="card p mt12" style="border-left:3px solid var(--amber)"><b style="font-size:12px;color:var(--amber)">⏰ Reminder</b><div class="muted" style="margin-top:3px">{{ outlet()?.name }} has {{ s.balance | inr }} outstanding — follow up this week.</div></div> }
        }
      </app-state>
    </div>
    <app-sheet [(open)]="receiptOpen" heading="🧾 Receipt generated" [subheading]="receipt()?.receiptNo ?? ''">
      @if (receipt(); as r) {
        <div class="card p mb12">
          <div class="between" style="margin-bottom:8px"><span class="muted">Outlet</span><b>{{ outlet()?.name }}</b></div>
          <div class="between" style="margin-bottom:8px"><span class="muted">Amount</span><b>{{ r.amount | inr }}</b></div>
          <div class="between" style="margin-bottom:8px"><span class="muted">Method</span><b>{{ r.method }}</b></div>
          <div class="between"><span class="muted">Balance</span><b>{{ r.balance | inr }} · {{ r.status === 'PAID' ? 'Paid' : 'Partially paid' }}</b></div>
        </div>
        <a class="btn ghost" [href]="shareLink(r)" target="_blank" rel="noopener">📲 Share receipt on WhatsApp</a>
      }
    </app-sheet>`,
})
export class PaymentPage {
  outletId = input.required<string>();
  private api = inject(Api);
  private ui = inject(Ui);
  outlet = signal<Outlet | null>(null);
  s = signal<PaySummary | null>(null);
  err = signal<string | null>(null);
  busy = signal(false);
  methods = ['CASH', 'UPI', 'CHEQUE'] as const;
  method = signal<'CASH' | 'UPI' | 'CHEQUE'>('CASH');
  amount: number | null = null;
  reference = '';
  receiptOpen = signal(false);
  receipt = signal<{ receiptNo: string; amount: number; method: string; balance: number; status: string } | null>(null);
  statusAfter = () => { const b = this.s()?.balance ?? 0, a = Number(this.amount) || 0; return !a ? 'Pending' : a >= b ? 'Paid' : 'Partially Paid'; };
  constructor() { queueMicrotask(() => this.load()); }
  async load() {
    this.err.set(null);
    try {
      const [o, s] = await Promise.all([this.api.get<Outlet>(`/outlets/${this.outletId()}`), this.api.get<PaySummary>(`/outlets/${this.outletId()}/payments`)]);
      this.outlet.set(o); this.s.set(s);
      if (this.amount === null) this.amount = s.balance > 0 ? s.balance : null;
    } catch (e) { this.err.set(errorMessage(e)); }
  }
  async collect() {
    const amt = Number(this.amount);
    if (!(amt > 0)) { this.ui.error('Enter an amount'); return; }
    if (amt > (this.s()?.balance ?? 0)) { this.ui.error('Amount exceeds the outstanding balance'); return; }
    if (this.method() !== 'CASH' && !this.reference.trim()) { this.ui.error(this.method() === 'UPI' ? 'Enter the UPI transaction ID' : 'Enter the cheque number'); return; }
    if (!(await this.ui.confirm({ title: `Collect ₹${amt.toLocaleString('en-IN')} by ${this.method()}?`, confirmText: 'Collect' }))) return;
    this.busy.set(true);
    try {
      const r = await this.api.post<{ receiptNo: string; amount: number; method: string; balance: number; status: string }>('/payments',
        { outletId: Number(this.outletId()), amount: amt, method: this.method(), reference: this.reference.trim() || undefined });
      this.receipt.set(r); this.receiptOpen.set(true);
      this.amount = null; this.reference = '';
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  shareLink(r: { receiptNo: string; amount: number; balance: number }) {
    const o = this.outlet();
    const text = `Receipt ${r.receiptNo}: received ₹${r.amount.toLocaleString('en-IN')} from ${o?.name}. Balance ₹${r.balance.toLocaleString('en-IN')}.`;
    return `https://wa.me/${o?.mobile ? '91' + o.mobile : ''}?text=${encodeURIComponent(text)}`;
  }
}

/* ── Expenses ── */
@Component({
  selector: 'app-expenses',
  imports: [FormsModule, AppBar, StateView, Sheet, InrPipe, DPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Expenses" [sub]="monthLabel" fallback="/reports">
      <button class="bico" type="button" (click)="openForm()" aria-label="Add expense">＋</button>
    </app-bar>
    <div class="body pad">
      <app-state [loading]="!data() && !err()" [error]="err()" (retry)="load()">
        @if (data(); as d) {
          <div class="metrics mb12"><div><b>{{ d.total | inr }}</b><span>This Month</span></div><div><b style="color:var(--g)">{{ d.approved }}</b><span>Approved</span></div><div><b style="color:var(--amber)">{{ d.pending }}</b><span>Pending</span></div></div>
          <div class="sec-title">Expense History</div>
          <div class="card">
            @for (e of d.items; track e.id) {
              <div class="lrow static">
                <div class="av" [style.background]="e.overLimit ? 'var(--r)' : 'var(--g)'">{{ e.type[0] }}</div>
                <div class="lr-main"><b>{{ typeLabel(e.type) }} · {{ e.amount | inr }}</b>
                  <span>{{ e.date | d }} · limit {{ e.limit | inr }}@if (e.overLimit) { · ⚠ over }@if (e.managerRemark) { · {{ e.managerRemark }} }</span>
                  @if (e.billUrl) { <a class="tiny" [href]="e.billUrl" target="_blank" rel="noopener" style="color:var(--g);font-weight:700">View bill</a> }</div>
                <span class="chip xs" [class.c-green]="e.status === 'APPROVED'" [class.c-red]="e.status === 'REJECTED'" [class.c-amber]="e.status === 'PENDING'"><span class="d"></span>{{ e.status.toLowerCase() }}</span>
              </div>
            } @empty { <div class="empty">No expenses this month.</div> }
          </div>
          <button class="btn primary mt14" type="button" (click)="openForm()">+ Add New Expense</button>
          <div class="tiny center mt8">Expenses above the eligible limit are flagged for manager review.</div>
        }
      </app-state>
    </div>
    <app-sheet [(open)]="formOpen" heading="Add Expense" subheading="Attach bill as proof">
      <div class="fld"><label for="ed">Date</label><input id="ed" type="date" [max]="today" [(ngModel)]="date"></div>
      <div class="fld"><label for="et">Expense Type</label><select id="et" [(ngModel)]="type">@for (t of types(); track t.type) { <option [value]="t.type">{{ typeLabel(t.type) }}</option> }</select></div>
      <div class="fld"><label for="ea">Amount</label><input id="ea" type="number" inputmode="decimal" min="1" [(ngModel)]="amount" placeholder="₹"></div>
      <div class="tiny" style="margin:-6px 0 12px">@if (over()) { <span style="color:var(--r);font-weight:800">⚠ Exceeds eligible limit {{ limit() | inr }}</span> } @else { Eligible limit: {{ limit() | inr }} }</div>
      <div class="fld"><label for="en">Notes</label><input id="en" [(ngModel)]="notes" maxlength="300" placeholder="Optional"></div>
      <label class="photo-box" style="height:80px;margin-bottom:14px" [class.done]="!!bill()">
        @if (bill(); as b) { @if (b.url) { <img [src]="b.url" alt="Bill"> } @else { <b style="color:var(--g)">✅ {{ b.file.name }}</b> } } @else { <span class="muted">📷 Capture / upload bill</span> }
        <input type="file" accept="image/*,application/pdf" hidden (change)="onBill($event)">
      </label>
      <button class="btn primary" type="button" [disabled]="busy()" (click)="save()">Submit for Approval</button>
    </app-sheet>`,
})
export class ExpensePage implements OnDestroy {
  private api = inject(Api);
  private ui = inject(Ui);
  today = todayIso();
  monthLabel = `${MONTHS_LONG[new Date().getMonth()]} ${new Date().getFullYear()}`;
  data = signal<{ items: Expense[]; total: number; approved: number; pending: number } | null>(null);
  types = signal<{ type: string; limit: number }[]>([]);
  err = signal<string | null>(null);
  formOpen = signal(false);
  busy = signal(false);
  bill = signal<{ file: File; url: string | null } | null>(null);
  date = this.today;
  type = 'FUEL';
  amount: number | null = null;
  notes = '';
  limit = () => this.types().find(t => t.type === this.type)?.limit ?? 0;
  over = () => this.limit() > 0 && (Number(this.amount) || 0) > this.limit();
  typeLabel = (t: string) => t[0] + t.slice(1).toLowerCase();

  constructor() {
    this.load();
    this.api.get<{ type: string; limit: number }[]>('/expenses/types').then(t => this.types.set(t)).catch(() => {});
  }
  ngOnDestroy() { const b = this.bill(); if (b?.url) URL.revokeObjectURL(b.url); }
  async load() {
    this.err.set(null);
    try { this.data.set(await this.api.get('/expenses')); } catch (e) { this.err.set(errorMessage(e)); }
  }
  openForm() { this.formOpen.set(true); }
  onBill(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const old = this.bill(); if (old?.url) URL.revokeObjectURL(old.url);
    this.bill.set({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null });
  }
  async save() {
    const amt = Number(this.amount);
    if (!(amt > 0)) { this.ui.error('Enter amount'); return; }
    if (!this.bill()) { this.ui.error('Attach the bill as proof'); return; }
    const fd = new FormData();
    fd.append('date', this.date); fd.append('type', this.type); fd.append('amount', String(amt));
    if (this.notes.trim()) fd.append('notes', this.notes.trim());
    fd.append('bill', this.bill()!.file);
    this.busy.set(true);
    try {
      const e = await this.api.upload<Expense>('/expenses', fd);
      this.ui.toast(e.overLimit ? '⚠ Flagged (over limit) & submitted' : '📤 Expense submitted');
      this.formOpen.set(false); this.amount = null; this.notes = ''; this.bill.set(null);
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
