import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../core/api.service';
import { Ui } from '../core/ui.service';
import { todayIso } from '../core/format';
import { Sheet } from './ui.components';

/** Result of a leave request filed without signing in (POST /auth/leave-request). */
export interface GuestLeaveResult { id: number; status: string; employeeName: string; approver: string | null }

/** Apply Leave / Permission — present and future dates only.
    guest: used on the login page without signing in — the employee enters their mobile + Employee ID. */
@Component({
  selector: 'app-leave-sheet',
  imports: [FormsModule, Sheet],
  template: `
    <app-sheet [(open)]="open" heading="Apply Request" [subheading]="guest() ? 'No sign-in needed · present & future dates only' : 'Present & future dates only'">
      @if (guest()) {
        <div class="no-2col">
          <div class="fld"><label for="lm">Mobile Number *</label>
            <input id="lm" [ngModel]="mobile()" (ngModelChange)="mobile.set($event.replace(nonDigit, ''))" inputmode="numeric" maxlength="10" autocomplete="tel-national" placeholder="10-digit mobile"></div>
          <div class="fld"><label for="le">Employee ID *</label>
            <input id="le" [(ngModel)]="empCode" maxlength="20" autocapitalize="characters" autocomplete="off" placeholder="e.g. FA-2231"></div>
        </div>
      }
      <div class="seg mb12" role="tablist">
        <button type="button" [class.on]="kind() === 'LEAVE'" (click)="setKind('LEAVE')">Leave</button>
        <button type="button" [class.on]="kind() === 'PERMISSION'" (click)="setKind('PERMISSION')">Permission</button>
      </div>
      @if (kind() === 'LEAVE') {
        <div class="fld"><label for="lt">Leave Type</label>
          <select id="lt" [(ngModel)]="leaveType"><option>Casual Leave</option><option>Sick Leave</option><option>Earned Leave</option></select></div>
        <div class="no-2col">
          <div class="fld"><label for="lf">From</label><input id="lf" type="date" [min]="today" [(ngModel)]="from" (change)="syncTo()"></div>
          <div class="fld"><label for="lto">To</label><input id="lto" type="date" [min]="from || today" [(ngModel)]="to"></div>
        </div>
      } @else {
        <div class="no-2col">
          <div class="fld"><label for="pd">Date</label><input id="pd" type="date" [min]="today" [(ngModel)]="from"></div>
          <div class="fld"><label for="ph">Hours (max 4)</label><input id="ph" type="number" min="0.5" max="4" step="0.5" [(ngModel)]="hours"></div>
        </div>
      }
      <div class="fld"><label for="lr">Reason</label><textarea id="lr" [(ngModel)]="reason" placeholder="Reason for request…" maxlength="400"></textarea></div>
      <button class="btn primary" type="button" [disabled]="busy()" (click)="submit()">Submit Request</button>
    </app-sheet>`,
})
export class LeaveSheet {
  open = model(false);
  submitted = output<GuestLeaveResult | void>();
  guest = input(false);
  mobile = model('');
  empCode = '';
  nonDigit = /\D/g;
  private api = inject(Api);
  private ui = inject(Ui);
  today = todayIso();
  kind = signal<'LEAVE' | 'PERMISSION'>('LEAVE');
  leaveType = 'Casual Leave';
  from = this.today;
  to = this.today;
  hours = 2;
  reason = '';
  busy = signal(false);

  setKind(k: 'LEAVE' | 'PERMISSION') { this.kind.set(k); }
  syncTo() { if (this.to < this.from) this.to = this.from; }

  async submit() {
    if (this.guest()) {
      if (!/^[6-9]\d{9}$/.test(this.mobile())) { this.ui.error('Enter your registered 10-digit mobile number'); return; }
      if (this.empCode.trim().length < 2) { this.ui.error('Enter your Employee ID'); return; }
    }
    if (this.reason.trim().length < 3) { this.ui.error('Enter a reason'); return; }
    const permission = this.kind() === 'PERMISSION';
    const body = {
      kind: this.kind(), leaveType: permission ? 'Permission' : this.leaveType,
      fromDate: this.from, toDate: permission ? this.from : this.to, hours: permission ? this.hours : undefined, reason: this.reason.trim(),
    };
    this.busy.set(true);
    try {
      const r = this.guest()
        ? await this.api.post<GuestLeaveResult>('/auth/leave-request', { ...body, mobile: this.mobile(), empCode: this.empCode.trim() })
        : await this.api.post('/attendance/leaves', body);
      this.ui.success('📤 Request submitted for approval');
      this.reason = '';
      this.open.set(false);
      this.submitted.emit(this.guest() ? r as GuestLeaveResult : undefined);
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
