import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { AttendanceCalendar } from '../../core/models';
import { DPipe, MONTHS_LONG, todayIso } from '../../core/format';
import { AppBar, Sheet, StateView } from '../../shared/ui.components';
import { LeaveSheet } from '../../shared/leave-sheet';

@Component({
  selector: 'app-attendance',
  imports: [FormsModule, AppBar, Sheet, StateView, LeaveSheet, DPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Attendance" [sub]="monthLabel()" fallback="/profile" />
    <div class="body pad">
      <app-state [loading]="!cal() && !err()" [error]="err()" (retry)="load()">
        @if (cal(); as c) {
          <div class="metrics mb12"><div><b>{{ c.summary.present }}</b><span>Present</span></div><div><b>{{ c.summary.late }}</b><span>Late</span></div><div><b>{{ c.summary.leave }}</b><span>Leave</span></div></div>
          <div class="card p">
            <div class="cal-bar"><button type="button" (click)="shift(-1)" aria-label="Previous month">‹</button><b>{{ monthLabel() }}</b><button type="button" (click)="shift(1)" aria-label="Next month">›</button></div>
            <div class="dows"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span class="off">S</span></div>
            <div class="days">
              @for (x of lead(); track $index) { <div class="day off"></div> }
              @for (d of c.days; track d.day) {
                <div class="day" [class.off]="d.status === 'off'" [class.today]="d.date === today" [attr.aria-label]="d.date + ' ' + (d.status || '')">{{ d.day }}
                  @if (dot(d.status); as cls) { <span class="dd {{ cls }}"></span> }</div>
              }
            </div>
            <div class="wrap mt12" style="font-size:10px">
              <span><span class="pin" style="background:#16a34a"></span>Present</span><span><span class="pin" style="background:var(--amber)"></span>Late check-in</span>
              <span><span class="pin" style="background:var(--r)"></span>Leave</span><span><span class="pin" style="background:var(--t3)"></span>Absent</span>
            </div>
          </div>

          <div class="sec-title">Regularization</div>
          <div class="card p">
            @for (r of c.regularizations.slice(0, 3); track r.id) {
              <div class="between" style="padding:6px 0"><div><b style="font-size:13px">{{ r.date | d: true }}</b><div class="tiny">{{ r.reason }}</div>
                @if (r.managerRemark) { <div class="tiny">Manager: {{ r.managerRemark }}</div> }</div>
                <span class="chip xs {{ tone(r.status) }}"><span class="d"></span>{{ r.status }}</span></div>
            } @empty { <div class="muted">No regularization requests.</div> }
            <button class="btn ghost sm mt12" style="width:100%" type="button" (click)="regOpen.set(true)">Apply Regularization</button>
          </div>

          <div class="sec-title">Leave Status</div>
          <div class="card p">
            <div class="between" style="margin-bottom:9px"><span class="muted">Approved</span><b style="color:#16a34a">{{ c.leaveStatus.approved }}</b></div>
            <div class="between" style="margin-bottom:9px"><span class="muted">Pending</span><b style="color:var(--amber)">{{ c.leaveStatus.pending }}</b></div>
            <div class="between"><span class="muted">Rejected</span><b style="color:var(--r)">{{ c.leaveStatus.rejected }}</b></div>
            <div class="divider"></div>
            @for (l of c.leaves.slice(0, 5); track l.id) {
              <div class="between" style="padding:7px 0;border-bottom:1px solid var(--brd)"><div><b style="font-size:13px">{{ l.leaveType }}</b>
                <div class="tiny">{{ l.fromDate | d }}{{ l.toDate !== l.fromDate ? ' – ' + (l.toDate | d) : '' }} · {{ l.reason }}</div></div>
                <span class="chip xs {{ tone(l.status) }}"><span class="d"></span>{{ l.status }}</span></div>
            }
            <button class="btn ghost sm mt12" style="width:100%" type="button" (click)="leaveOpen.set(true)">Apply Leave / Permission</button>
          </div>
        }
      </app-state>
    </div>

    <app-sheet [(open)]="regOpen" heading="Apply Regularization" subheading="Missed punch or late check-in">
      <div class="fld"><label for="rd">Date</label><input id="rd" type="date" [max]="today" [(ngModel)]="regDate"></div>
      <div class="fld"><label for="rr">Reason</label><textarea id="rr" [(ngModel)]="regReason" maxlength="400" placeholder="e.g. Late check-in — vehicle breakdown"></textarea></div>
      <button class="btn primary" type="button" [disabled]="busy()" (click)="submitReg()">Send to Manager</button>
    </app-sheet>
    <app-leave-sheet [(open)]="leaveOpen" (submitted)="load()" />`,
})
export class AttendancePage {
  private api = inject(Api);
  private ui = inject(Ui);
  today = todayIso();
  year = signal(new Date().getFullYear());
  month = signal(new Date().getMonth() + 1);
  cal = signal<AttendanceCalendar | null>(null);
  err = signal<string | null>(null);
  regOpen = signal(false);
  leaveOpen = signal(false);
  busy = signal(false);
  regDate = this.today;
  regReason = '';
  monthLabel = computed(() => `${MONTHS_LONG[this.month() - 1]} ${this.year()}`);
  /** Monday-first leading blanks */
  lead = computed(() => Array((new Date(this.year(), this.month() - 1, 1).getDay() + 6) % 7));

  constructor() { this.load(); }
  async load() {
    this.err.set(null);
    try { this.cal.set(await this.api.get<AttendanceCalendar>('/attendance/calendar', { year: this.year(), month: this.month() })); }
    catch (e) { this.err.set(errorMessage(e)); }
  }
  shift(n: number) {
    let m = this.month() + n, y = this.year();
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    this.month.set(m); this.year.set(y); this.cal.set(null); this.load();
  }
  dot(s: string | null) { return s === 'present' ? 'green' : s === 'late' ? 'amber' : s === 'leave' ? 'red' : s === 'absent' ? 'grey' : ''; }
  tone(s: string) { return s === 'APPROVED' ? 'c-green' : s === 'REJECTED' ? 'c-red' : 'c-amber'; }
  async submitReg() {
    if (this.regReason.trim().length < 3) { this.ui.error('Enter a reason'); return; }
    this.busy.set(true);
    try {
      await this.api.post('/attendance/regularizations', { date: this.regDate, reason: this.regReason.trim() });
      this.ui.success('📤 Regularization request sent to your manager');
      this.regOpen.set(false); this.regReason = '';
      this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
