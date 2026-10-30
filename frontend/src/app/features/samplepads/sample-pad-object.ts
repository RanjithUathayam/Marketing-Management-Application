import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { Paged, SamplePad, TeamMember } from '../../core/models';
import { DPipe, DtPipe, todayIso } from '../../core/format';
import { AppBar, Sheet, StateView } from '../../shared/ui.components';

interface Records extends Paged<SamplePad> { kpis: { issued: number; acknowledged: number; pending: number; deliveryChallans: number } }

/** Manager / admin console over the Salesforce "Sample Pad" object. */
@Component({
  selector: 'app-sample-pad-object',
  imports: [FormsModule, AppBar, Sheet, StateView, DPipe, DtPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Sample Pad Issuances" sub="Salesforce · Sample Pad object" fallback="/manager" />
    <div class="sf">
      <div class="sf-nav"><span>Home</span><span>Accounts</span><span>Orders</span><span>Delivery Challans</span><span class="on">Sample Pad</span></div>
      <div class="sf-body">
        <div class="sf-hd">
          <div class="sf-ico">🗂️</div>
          <div><p>Sample Pad</p><h2>Sample Pad Issuances</h2><p>{{ data()?.total ?? 0 }} item{{ data()?.total === 1 ? '' : 's' }} · updated {{ updated() }}</p></div>
          <div class="sf-tools">
            <input [(ngModel)]="search" (ngModelChange)="debounced()" placeholder="Search pad, DC, employee…" aria-label="Search sample pads">
            <select [(ngModel)]="userId" (ngModelChange)="load()" aria-label="Filter by employee"><option [ngValue]="null">All employees</option>@for (m of team(); track m.id) { <option [ngValue]="m.id">{{ m.empCode }} · {{ m.name }}</option> }</select>
            <select [(ngModel)]="status" (ngModelChange)="load()" aria-label="Filter by status"><option [ngValue]="null">All statuses</option><option value="ack">Acknowledged</option><option value="pen">Pending</option></select>
            <button type="button" (click)="issueOpen.set(true)">＋ Issue on DC</button>
            @if (pendingIds().length) { <button type="button" style="color:#b45309;border-color:#fde68a;background:#fffbeb" (click)="remind(pendingIds())">🔔 Remind pending ({{ pendingIds().length }})</button> }
          </div>
        </div>
        <div class="sf-kpis">
          <div class="sf-kpi"><b>{{ data()?.kpis?.issued ?? 0 }}</b><span>Pads issued</span></div>
          <div class="sf-kpi g"><b>{{ data()?.kpis?.acknowledged ?? 0 }}</b><span>Acknowledged</span></div>
          <div class="sf-kpi y"><b>{{ data()?.kpis?.pending ?? 0 }}</b><span>Pending acknowledgement</span></div>
          <div class="sf-kpi"><b>{{ data()?.kpis?.deliveryChallans ?? 0 }}</b><span>Delivery challans</span></div>
        </div>
        <app-state [loading]="!data() && !err()" [error]="err()" (retry)="load()">
          <div class="sf-tbl-wrap"><table class="sf-tbl">
            <thead><tr><th>Employee</th><th>DC Number</th><th>DC Date</th><th>Product Name</th><th>Status</th><th>Acknowledged On</th><th>Remarks</th><th></th></tr></thead>
            <tbody>
              @for (r of data()?.items ?? []; track r.id) {
                <tr>
                  <td><div class="sf-link">{{ r.employee }}</div><div class="sf-sub">{{ r.empCode }} · {{ r.recordNo }}</div></td>
                  <td>{{ r.dcNo }}</td><td>{{ r.dcDate | d: true }}</td>
                  <td><b>{{ r.name }}</b><div class="sf-sub">{{ r.subgroup }} · Qty {{ r.qty }}</div></td>
                  <td>@if (r.ackAt) { <span class="sf-pill ack">Acknowledged</span> } @else { <span class="sf-pill pen">Pending</span>@if (r.remindedAt) { <div class="sf-sub">Reminded {{ r.remindedAt | dt }}</div> } }</td>
                  <td>@if (r.ackAt) { {{ r.ackAt | dt }}<div class="sf-sub">{{ r.ackVia === 'PHOTO_SCAN' ? 'Photo scan' : 'QR scan' }}</div> } @else { <span class="sf-sub">—</span> }</td>
                  <td><input class="sf-rem" [ngModel]="r.remarks" (change)="saveRemark(r, $any($event.target).value)" placeholder="Add remark…" [attr.aria-label]="'Remarks for ' + r.name">
                    @if (saved() === r.id) { <span class="sf-sub" style="color:#2e844a;font-weight:700">Saved</span> }</td>
                  <td>@if (!r.ackAt) { <button type="button" class="spx-remind" (click)="remind([r.id])">🔔 Remind</button> }</td>
                </tr>
              } @empty { <tr><td colspan="8" style="text-align:center;color:#706e6b;padding:24px">No records match this view.</td></tr> }
            </tbody>
          </table></div>
          <!-- phone layout: one card per record instead of a wide table -->
          <div class="card sf-cards">
            @for (r of data()?.items ?? []; track r.id) {
              <div class="spx-rec">
                <div class="between" style="align-items:flex-start"><b style="font-size:12.5px">{{ r.name }}</b>
                  @if (r.ackAt) { <span class="sf-pill ack">Acknowledged</span> } @else { <span class="sf-pill pen">Pending</span> }</div>
                <div class="tiny" style="margin-top:3px;font-weight:600">{{ r.employee }} · {{ r.empCode }} · {{ r.recordNo }}</div>
                <div class="tiny" style="font-weight:600">{{ r.dcNo }} · {{ r.dcDate | d: true }} · {{ r.subgroup }} · Qty {{ r.qty }}</div>
                @if (r.ackAt) { <div class="tiny" style="color:#15803d;font-weight:700;margin-top:4px">✓ {{ r.ackAt | dt }} · {{ r.ackVia === 'PHOTO_SCAN' ? 'Photo scan' : 'QR scan' }}</div> }
                @else { <div class="row" style="margin-top:5px"><span class="tiny" style="color:#b45309;font-weight:700">⏳ Pending@if (r.remindedAt) { · reminded {{ r.remindedAt | dt }} }</span><button type="button" class="spx-remind" (click)="remind([r.id])">🔔 Remind</button></div> }
                <input class="spx-rem" [ngModel]="r.remarks" (change)="saveRemark(r, $any($event.target).value)" placeholder="Add remark…" [attr.aria-label]="'Remarks for ' + r.name">
              </div>
            } @empty { <div class="empty">No records match this view.</div> }
          </div>
          @if ((data()?.total ?? 0) > (data()?.items?.length ?? 0)) { <button class="btn ghost" type="button" (click)="more()">Load more</button> }
        </app-state>
      </div>
    </div>

    <app-sheet [(open)]="issueOpen" heading="Issue Sample Pads on DC" subheading="Pads start as Pending until the executive scans the QR">
      <div class="no-2col">
        <div class="fld"><label for="dn">DC Number</label><input id="dn" [(ngModel)]="dc.dcNo" maxlength="30" placeholder="DC/26-27/0950"></div>
        <div class="fld"><label for="dd">DC Date</label><input id="dd" type="date" [(ngModel)]="dc.dcDate" [max]="today"></div>
      </div>
      <div class="fld"><label for="de">Issued to (Employee ID)</label><select id="de" [(ngModel)]="dc.userId"><option [ngValue]="null">Select executive…</option>@for (m of team(); track m.id) { <option [ngValue]="m.id">{{ m.empCode }} · {{ m.name }}</option> }</select></div>
      @for (it of dc.items; track $index; let i = $index) {
        <div class="card p mb12">
          <div class="no-2col"><div class="fld"><label [for]="'ic' + i">Item code</label><input [id]="'ic' + i" [(ngModel)]="it.itemCode" maxlength="20"></div>
            <div class="fld"><label [for]="'iq' + i">Qty</label><input [id]="'iq' + i" type="number" min="1" [(ngModel)]="it.qty"></div></div>
          <div class="fld"><label [for]="'in' + i">Pad name</label><input [id]="'in' + i" [(ngModel)]="it.name" maxlength="120"></div>
          <div class="fld" style="margin-bottom:0"><label [for]="'is' + i">Subgroup</label><input [id]="'is' + i" [(ngModel)]="it.subgroup" maxlength="40"></div>
          @if (dc.items.length > 1) { <button type="button" class="pillbtn mt8" (click)="dc.items.splice(i, 1)">Remove item</button> }
        </div>
      }
      <button class="btn ghost sm mb12" style="width:100%" type="button" (click)="addItem()">＋ Add another pad</button>
      <button class="btn indigo" type="button" [disabled]="busy()" (click)="issue()">Issue {{ dc.items.length }} pad{{ dc.items.length > 1 ? 's' : '' }}</button>
    </app-sheet>`,
})
export class SamplePadObjectPage {
  userIdParam = input<string>(undefined, { alias: 'userId' });
  private api = inject(Api);
  private ui = inject(Ui);
  data = signal<Records | null>(null);
  team = signal<TeamMember[]>([]);
  err = signal<string | null>(null);
  saved = signal<number | null>(null);
  issueOpen = signal(false);
  busy = signal(false);
  updated = signal('just now');
  today = todayIso();
  userId: number | null = null;
  status: string | null = null;
  search = '';
  size = 50;
  dc = { dcNo: '', dcDate: todayIso(), userId: null as number | null, items: [{ itemCode: '', name: '', subgroup: 'Subgroup 7', qty: 1 }] };
  private t?: ReturnType<typeof setTimeout>;
  pendingIds = computed(() => (this.data()?.items ?? []).filter(r => !r.ackAt).map(r => r.id));

  constructor() {
    queueMicrotask(() => { this.userId = Number(this.userIdParam()) || null; this.load(); });
    this.api.get<{ members: TeamMember[] }>('/team').then(t => this.team.set(t.members)).catch(() => {});
  }
  debounced() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 300); }
  async more() {
    const d = this.data(); if (!d) return;
    try {
      const r = await this.api.get<Records>('/sample-pads/records', { userId: this.userId, status: this.status, search: this.search.trim(), pageSize: this.size, page: d.page + 1 });
      this.data.set({ ...r, items: [...d.items, ...r.items] });
    } catch (e) { this.err.set(errorMessage(e)); }
  }
  async load() {
    this.err.set(null);
    try {
      this.data.set(await this.api.get<Records>('/sample-pads/records', { userId: this.userId, status: this.status, search: this.search.trim(), pageSize: this.size, page: 1 }));
      this.updated.set(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) { this.err.set(errorMessage(e)); }
  }
  async saveRemark(r: SamplePad, v: string) {
    try {
      await this.api.put(`/sample-pads/${r.id}/remarks`, { remarks: v });
      this.saved.set(r.id); setTimeout(() => this.saved.set(null), 1400);
      this.ui.toast('💬 Remark saved to Salesforce');
    } catch (e) { this.ui.error(errorMessage(e)); }
  }
  async remind(ids: number[]) {
    try {
      const r = await this.api.post<{ reminded: number; employees: string[] }>('/sample-pads/remind', { ids });
      this.ui.success(r.reminded ? `🔔 Reminder sent to ${r.employees.join(', ')}` : 'Nothing pending to remind');
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
  }
  addItem() { this.dc.items.push({ itemCode: '', name: '', subgroup: 'Subgroup 7', qty: 1 }); }
  async issue() {
    const d = this.dc;
    if (!d.dcNo.trim() || !d.userId) { this.ui.error('Enter the DC number and choose an executive'); return; }
    if (d.items.some(i => !i.itemCode.trim() || i.name.trim().length < 2 || !(i.qty > 0))) { this.ui.error('Complete every pad (code, name, qty)'); return; }
    this.busy.set(true);
    try {
      await this.api.post('/sample-pads/challans', { dcNo: d.dcNo.trim(), dcDate: d.dcDate, userId: d.userId,
        items: d.items.map(i => ({ itemCode: i.itemCode.trim(), name: i.name.trim(), subgroup: i.subgroup.trim(), qty: Number(i.qty) })) });
      this.ui.success(`🗂️ ${d.items.length} pad(s) issued on ${d.dcNo}`);
      this.issueOpen.set(false);
      this.dc = { dcNo: '', dcDate: todayIso(), userId: null, items: [{ itemCode: '', name: '', subgroup: 'Subgroup 7', qty: 1 }] };
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
