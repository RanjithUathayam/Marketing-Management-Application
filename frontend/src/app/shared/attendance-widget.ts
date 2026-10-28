import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { Ui } from '../core/ui.service';
import { AttendanceToday } from '../core/models';
import { duration, fmtTime } from '../core/format';

/** Header Check-In / live timer / Check-Out control. Check-in before Start Day goes to the Start Day screen. */
@Component({
  selector: 'app-attendance-widget',
  template: `
    <div class="hatt">
      @if (state(); as s) {
        @if (s.openSession) {
          <div class="hatt-info" [title]="'Checked in at ' + time(s.openSession.CheckInAt)">
            <span>In {{ time(s.openSession.CheckInAt) }}</span><b class="live">{{ elapsed() }}</b></div>
          <button class="hatt-btn out" type="button" [disabled]="busy()" (click)="checkOut()">Check-Out</button>
        } @else {
          @if (lastOut(); as lo) { <div class="hatt-info"><span>Last out</span><b>{{ lo }}</b></div> }
          <button class="hatt-btn in" type="button" [disabled]="busy()" (click)="checkIn()">Check-In</button>
        }
      }
    </div>`,
})
export class AttendanceWidget implements OnInit, OnDestroy {
  private api = inject(Api);
  private ui = inject(Ui);
  private router = inject(Router);
  state = signal<AttendanceToday | null>(null);
  elapsed = signal('00:00:00');
  lastOut = signal<string | null>(null);
  busy = signal(false);
  private tick?: ReturnType<typeof setInterval>;
  time = fmtTime;

  async ngOnInit() {
    try { this.apply(await this.api.get<AttendanceToday>('/attendance/today')); } catch { /* shown elsewhere */ }
  }
  ngOnDestroy() { clearInterval(this.tick); }

  private apply(s: AttendanceToday) {
    this.state.set(s);
    clearInterval(this.tick);
    const closed = s.sessions.filter(x => x.CheckOutAt);
    this.lastOut.set(closed.length ? fmtTime(closed[closed.length - 1].CheckOutAt) : null);
    if (s.openSession) {
      const start = new Date(s.openSession.CheckInAt).getTime();
      const upd = () => this.elapsed.set(duration(Date.now() - start));
      upd();
      this.tick = setInterval(upd, 1000);
    }
  }
  async checkIn() {
    if (!this.state()?.dayStarted) { this.router.navigateByUrl('/start-day'); return; }
    this.busy.set(true);
    try { this.apply(await this.api.post<AttendanceToday>('/attendance/check-in')); this.ui.success('✅ Checked in at ' + fmtTime(new Date().toISOString())); }
    catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  async checkOut() {
    this.busy.set(true);
    try {
      const open = this.state()?.openSession;
      this.apply(await this.api.post<AttendanceToday>('/attendance/check-out'));
      this.ui.toast(`🏁 Checked out · ${open ? duration(Date.now() - new Date(open.CheckInAt).getTime(), false) : ''}`);
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
