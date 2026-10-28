import { Component, inject, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../core/api.service';
import { Ui } from '../core/ui.service';
import { todayIso } from '../core/format';
import { Sheet } from './ui.components';

/** Apply Leave / Permission — present and future dates only. */
@Component({
  selector: 'app-leave-sheet',
  imports: [FormsModule, Sheet],
  template: `
    <app-sheet [(open)]="open" heading="Apply Request" subheading="Present & future dates only">
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
  submitted = output<void>();
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
    if (this.reason.trim().length < 3) { this.ui.error('Enter a reason'); return; }
    const permission = this.kind() === 'PERMISSION';
    this.busy.set(true);
    try {
      await this.api.post('/attendance/leaves', {
        kind: this.kind(), leaveType: permission ? 'Permission' : this.leaveType,
        fromDate: this.from, toDate: permission ? this.from : this.to, hours: permission ? this.hours : undefined, reason: this.reason.trim(),
      });
      this.ui.success('📤 Request submitted for approval');
      this.reason = '';
      this.open.set(false);
      this.submitted.emit();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
