import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorCode, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Geo } from '../../core/geo.service';
import { Ui } from '../../core/ui.service';
import { AttendanceToday, ExecDashboard } from '../../core/models';
import { fmtTime } from '../../core/format';
import { AppBar, Sheet } from '../../shared/ui.components';
import { LeaveSheet } from '../../shared/leave-sheet';
import { SelfieCamera, SelfieCapture } from '../../shared/selfie-camera';

type FaceState = 'idle' | 'opening' | 'verifying' | 'verified' | 'failed';
const TRAVEL = [['OWN_VEHICLE', '🏍️ Own Vehicle'], ['BUS', '🚌 Bus'], ['CAB', '🚗 Cab'], ['WALK', '🚶 Walk']] as const;

@Component({
  selector: 'app-start-day',
  imports: [FormsModule, AppBar, Sheet, LeaveSheet, SelfieCamera],
  host: { class: 'sc' },
  template: `
    <app-bar title="Start Your Day" sub="Attendance check-in" [back]="false">
      <button class="bico" type="button" (click)="logout()" aria-label="Sign out" title="Sign out">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg></button>
    </app-bar>
    <div class="body pad"><div class="auth-wrap">
      <div class="card p center">
        <div class="sec-title" style="margin:0 0 10px">Selfie Attendance Punch</div>
        <button type="button" class="photo-box" [class.done]="face() === 'verified'" [disabled]="face() === 'verifying' || face() === 'opening'"
                (click)="openCamera()" [attr.aria-label]="preview() ? 'Retake attendance selfie' : 'Open camera for attendance selfie'"
                style="width:150px;height:150px;border-radius:50%;margin:0 auto 12px;font-size:44px;padding:0"
                [style.border-color]="face() === 'failed' ? 'var(--r)' : null">
          @if (preview()) { <img [src]="preview()" alt="Your attendance selfie"> } @else { 📷 }
        </button>
        <div class="muted">@switch (face()) {
          @case ('opening') { Opening camera… }
          @case ('verifying') { <b>Verifying Employee…</b> please wait }
          @case ('verified') { <b style="color:var(--g)">Face Verified Successfully</b> — tap to retake }
          @case ('failed') { <b style="color:var(--r)">Face Verification Failed</b> — tap to retake }
          @default { Tap to open the camera and capture your selfie }
        }</div>
        @if (face() === 'failed' && faceMsg()) { <div class="err-box mt12" role="alert" style="justify-content:center">{{ faceMsg() }}</div> }
        @if (profileMissing()) {
          <div class="err-box mt12" role="alert" style="justify-content:center">⚠ Your profile photo is not registered in the Employee Master. Contact your administrator to add it before marking attendance.</div>
        }
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
      <div class="card p mt14" aria-live="polite">
        <div class="sec-title" style="margin:0 0 8px">Before you start</div>
        <ul class="chk-list">
          <li [class.ok]="!!preview()">Attendance selfie (live camera)</li>
          <li [class.ok]="face() === 'verified'">Face verified</li>
          <li [class.ok]="!!mode()">Travel type</li>
          @if (mode() === 'OWN_VEHICLE') { <li [class.ok]="odoValid()">Starting odometer</li> }
          <li [class.ok]="!!geo.last()" class="optional">Location (optional)</li>
        </ul>
      </div>
      <div class="tiny center mt12">📍 {{ geo.last() ? 'Location captured' : geo.denied() ? 'Location permission denied — attendance is recorded without GPS' : 'Capturing location…' }}</div>
      <div class="row mt14" style="justify-content:center">
        <button type="button" class="pillbtn" (click)="leaveOpen.set(true)">📝 Apply Leave / Permission</button>
      </div>
    </div></div>
    <div class="bbar"><button class="btnp" type="button" [disabled]="busy() || !ready()" (click)="confirm()">Sign In &amp; Start Day →</button></div>
    @if (camera(); as dir) { <app-selfie-camera [direction]="dir" (captured)="onCaptured($event)" (closed)="cameraClosed()" /> }

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
  preview = signal<string | null>(null);
  face = signal<FaceState>('idle');
  faceMsg = signal('');
  profileMissing = signal(false);
  /** Head-turn direction of the active server challenge while the camera is open. */
  camera = signal<'LEFT' | 'RIGHT' | null>(null);
  private challengeId: number | null = null;
  private verificationId: number | null = null;
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
  odoValid = () => /^\d{1,7}$/.test(this.odoStart.trim());
  /** Every required step done; the server re-checks all of it (the verification id is single-use and server-issued). */
  ready = () => !!this.auth.user() && this.face() === 'verified' && !!this.verificationId && !!this.mode()
    && (this.mode() !== 'OWN_VEHICLE' || this.odoValid());

  /** Gets a one-time challenge for the signed-in employee, then opens the live camera. */
  async openCamera() {
    if (this.face() === 'opening' || this.face() === 'verifying') return;
    this.face.set('opening');
    this.verificationId = null;
    try {
      const c = await this.api.post<{ challengeId: number; direction: 'LEFT' | 'RIGHT' }>('/attendance/face/challenge');
      this.profileMissing.set(false);
      this.challengeId = c.challengeId;
      this.camera.set(c.direction);
    } catch (e) {
      if (errorCode(e) === 'PROFILE_PHOTO_MISSING') this.profileMissing.set(true);
      else this.ui.error(errorMessage(e));
      this.face.set(this.preview() ? 'failed' : 'idle');
      this.faceMsg.set('');
      if ((e as { status?: number })?.status === 409 && !errorCode(e)) this.router.navigateByUrl('/home'); // day already started
    }
  }
  cameraClosed() { this.camera.set(null); this.face.set(this.preview() ? 'failed' : 'idle'); this.faceMsg.set(''); }

  async onCaptured(s: SelfieCapture) {
    this.camera.set(null);
    this.setPreview(s.preview);
    this.face.set('verifying');
    try {
      const fd = new FormData();
      fd.append('challengeId', String(this.challengeId));
      fd.append('front', s.front, 'front.jpg');
      fd.append('turned', s.turned, 'turned.jpg');
      const r = await this.api.upload<{ verificationId: number; verified: boolean; message: string }>('/attendance/face/verify', fd);
      this.verificationId = r.verified ? r.verificationId : null;
      this.face.set(r.verified ? 'verified' : 'failed');
      this.faceMsg.set(r.verified ? '' : r.message);
      if (r.verified) this.ui.success('✅ Face Verified Successfully');
    } catch (e) {
      if (errorCode(e) === 'PROFILE_PHOTO_MISSING') this.profileMissing.set(true);
      this.face.set('failed');
      this.faceMsg.set(errorMessage(e));
    } finally { this.challengeId = null; }
  }
  private setPreview(url: string | null) { const old = this.preview(); if (old && old !== url) URL.revokeObjectURL(old); this.preview.set(url); }

  async confirm() {
    if (this.face() !== 'verified' || !this.verificationId) { this.ui.error('📷 Capture your selfie and complete face verification'); return; }
    if (!this.mode()) { this.ui.error('🚗 Please select travel type'); return; }
    if (this.mode() === 'OWN_VEHICLE' && !this.odoValid()) { this.ui.error('Enter the starting odometer reading'); return; }
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const pos = await this.geo.current(5000);
      const t = await this.api.post<AttendanceToday>('/attendance/start-day', {
        verificationId: this.verificationId, travelMode: this.mode(),
        odoStart: this.mode() === 'OWN_VEHICLE' ? this.odoStart.trim() : undefined,
        lat: pos?.lat, lng: pos?.lng,
      });
      this.verificationId = null;
      const dash = await this.api.get<ExecDashboard>('/dashboard/exec').catch(() => null);
      this.beatName.set(dash?.todayBeat?.name ?? '');
      this.checkIn.set(fmtTime(t.day?.startedAt));
      this.late.set(!!t.day?.isLate);
      this.doneOpen.set(true);
    } catch (e) {
      if (errorCode(e) === 'FACE_NOT_VERIFIED') {
        this.verificationId = null;
        this.face.set('failed');
        this.faceMsg.set('Your face verification has expired — tap the photo to retake your selfie.');
      }
      this.ui.error(errorMessage(e));
    }
    finally { this.busy.set(false); }
  }
  goHome() { this.doneOpen.set(false); this.router.navigateByUrl('/home'); }
  logout() { this.auth.logout(); }
}
