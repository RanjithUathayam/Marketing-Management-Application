import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Geo } from '../../core/geo.service';
import { Ui } from '../../core/ui.service';
import { AttendanceToday, ExecDashboard } from '../../core/models';
import { fmtTime } from '../../core/format';
import { AppBar, Sheet } from '../../shared/ui.components';
import { LeaveSheet } from '../../shared/leave-sheet';

const TRAVEL = [['OWN_VEHICLE', '🏍️ Own Vehicle'], ['BUS', '🚌 Bus'], ['CAB', '🚗 Cab'], ['WALK', '🚶 Walk']] as const;

@Component({
  selector: 'app-start-day',
  imports: [FormsModule, AppBar, Sheet, LeaveSheet],
  host: { class: 'sc' },
  template: `
    <app-bar title="Start Your Day" sub="Attendance check-in" [back]="false">
      <button class="bico" type="button" (click)="logout()" aria-label="Sign out" title="Sign out">⎋</button>
    </app-bar>
    <div class="body pad">
      <div class="card p center">
        <div class="sec-title" style="margin:0 0 10px">Selfie Attendance Punch</div>
        <label class="photo-box" [class.done]="!!preview()" style="width:150px;height:150px;border-radius:50%;margin:0 auto 12px;font-size:44px">
          @if (preview()) { <img [src]="preview()" alt="Your attendance photo"> } @else { 📷 }
          <input type="file" accept="image/*" capture="user" hidden (change)="onPhoto($event)">
        </label>
        <div class="muted">@if (preview()) { <b style="color:var(--g)">Photo captured</b> — tap to retake } @else { Tap to capture your photo }</div>
      </div>

      <div class="sec-title">Travel Type</div>
      <div class="card p">
        <div class="wrap" role="radiogroup" aria-label="Travel type">
          @for (t of travel; track t[0]) {
            <button type="button" class="pillbtn" role="radio" [attr.aria-checked]="mode() === t[0]" [class.on]="mode() === t[0]" (click)="mode.set(t[0])">{{ t[1] }}</button>
          }
        </div>
        @if (mode() === 'OWN_VEHICLE') {
          <div class="fld mt12" style="margin-bottom:0"><label for="odo">Starting Odometer (km)</label>
            <input id="odo" inputmode="numeric" [(ngModel)]="odoStart" placeholder="e.g. 24680"></div>
          <div class="tiny mt8">Ending reading is captured at day-end to calculate distance travelled.</div>
        }
      </div>
      <div class="tiny center mt12">📍 {{ geo.last() ? 'Location captured' : geo.denied() ? 'Location permission denied — attendance is recorded without GPS' : 'Capturing location…' }}</div>
      <div class="row mt14" style="justify-content:center">
        <button type="button" class="pillbtn" (click)="leaveOpen.set(true)">📝 Apply Leave / Permission</button>
      </div>
    </div>
    <div class="bbar"><button class="btnp" type="button" [disabled]="busy()" (click)="confirm()">Sign In &amp; Start Day →</button></div>

    <app-sheet [(open)]="doneOpen" heading="✅ Checked In" subheading="Attendance recorded successfully" (closed)="goHome()">
      <div class="card p mb12">
        <div class="between" style="margin-bottom:8px"><span class="muted">Name</span><b>{{ auth.user()?.name }}</b></div>
        <div class="between" style="margin-bottom:8px"><span class="muted">Emp ID</span><b>{{ auth.user()?.empCode }}</b></div>
        <div class="between" style="margin-bottom:8px"><span class="muted">Beat</span><b>{{ beatName() || '—' }}</b></div>
        <div class="between"><span class="muted">Check-in Time</span><b>{{ checkIn() }}@if (late()) { <span class="chip c-amber xs" style="margin-left:6px">Late</span> }</b></div>
      </div>
      <button class="btn primary" type="button" (click)="goHome()">Go to Dashboard →</button>
    </app-sheet>
    <app-leave-sheet [(open)]="leaveOpen" />`,
})
export class StartDayPage implements OnDestroy {
  auth = inject(AuthService);
  geo = inject(Geo);
  private api = inject(Api);
  private ui = inject(Ui);
  private router = inject(Router);
  travel = TRAVEL;
  mode = signal<string | null>(null);
  odoStart = '';
  photo: File | null = null;
  preview = signal<string | null>(null);
  busy = signal(false);
  doneOpen = signal(false);
  leaveOpen = signal(false);
  beatName = signal('');
  checkIn = signal('');
  late = signal(false);

  constructor() {
    this.geo.current();
    this.api.get<AttendanceToday>('/attendance/today').then(t => { if (t.dayStarted) this.router.navigateByUrl('/home'); }).catch(() => {});
  }
  ngOnDestroy() { const p = this.preview(); if (p) URL.revokeObjectURL(p); }

  onPhoto(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { this.ui.error('Please capture a photo'); return; }
    const old = this.preview(); if (old) URL.revokeObjectURL(old);
    this.photo = f;
    this.preview.set(URL.createObjectURL(f));
  }

  async confirm() {
    if (!this.photo) { this.ui.error('📷 Please capture your attendance photo'); return; }
    if (!this.mode()) { this.ui.error('🚗 Please select travel type'); return; }
    if (this.mode() === 'OWN_VEHICLE' && !/^\d{1,7}$/.test(this.odoStart.trim())) { this.ui.error('Enter the starting odometer reading'); return; }
    this.busy.set(true);
    try {
      const pos = await this.geo.current(5000);
      const fd = new FormData();
      fd.append('selfie', this.photo);
      fd.append('travelMode', this.mode()!);
      if (this.mode() === 'OWN_VEHICLE') fd.append('odoStart', this.odoStart.trim());
      if (pos) { fd.append('lat', String(pos.lat)); fd.append('lng', String(pos.lng)); }
      const t = await this.api.upload<AttendanceToday>('/attendance/start-day', fd);
      const dash = await this.api.get<ExecDashboard>('/dashboard/exec').catch(() => null);
      this.beatName.set(dash?.todayBeat?.name ?? '');
      this.checkIn.set(fmtTime(t.day?.startedAt));
      this.late.set(!!t.day?.isLate);
      this.doneOpen.set(true);
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  goHome() { this.doneOpen.set(false); this.router.navigateByUrl('/home'); }
  logout() { this.auth.logout(); }
}
