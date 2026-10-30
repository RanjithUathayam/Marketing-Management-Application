import { Component, ElementRef, OnDestroy, OnInit, input, output, signal, viewChild } from '@angular/core';

export interface SelfieCapture { front: Blob; turned: Blob; preview: string }
type Phase = 'starting' | 'front' | 'turn' | 'review' | 'error';
const TURN_SECONDS = 3;

/** Full-screen live front-camera capture for the attendance selfie. There is deliberately no file / gallery
 *  input: frames come only from the camera stream. Two frames are taken — one facing the camera and one with
 *  the head turned to `direction` — so the server can check liveness as well as identity. With `single`, one
 *  front-facing frame is taken (e.g. an admin capturing a profile photo) and emitted as both frames. */
@Component({
  selector: 'app-selfie-camera',
  template: `
    <div class="scan" role="dialog" aria-modal="true" [attr.aria-label]="heading()">
      <div class="scan-hd"><div style="font-size:18px">🤳</div><b>{{ heading() }}<small>{{ sub() }}</small></b>
        <button class="scan-x" type="button" (click)="close()" aria-label="Close camera">✕</button></div>
      <div class="scan-vp">
        <video #video autoplay playsinline muted class="selfie-video" [hidden]="phase() === 'review'"></video>
        @if (phase() === 'front' || phase() === 'turn') {
          <div class="selfie-oval" [class.turn]="phase() === 'turn'" aria-hidden="true">
            @for (n of countdown() ? [countdown()] : []; track n) { <span class="selfie-count">{{ n }}</span> }
          </div>
        }
        @if (phase() === 'turn') {
          <!-- Animated guide: the face slides towards the side to turn to (as seen in the mirrored preview). -->
          <div class="selfie-guide" [class.right]="direction() === 'RIGHT'" aria-hidden="true">
            @if (direction() === 'LEFT') { <span class="selfie-guide-arrow">⟵</span> }
            <svg class="selfie-head" viewBox="0 0 48 56"><ellipse cx="24" cy="28" rx="18" ry="22"/>
              <g class="selfie-face"><circle cx="17" cy="24" r="2.6"/><circle cx="31" cy="24" r="2.6"/><path d="M24 27v8h-3"/><path d="M18 42q6 4 12 0"/></g></svg>
            @if (direction() === 'RIGHT') { <span class="selfie-guide-arrow">⟶</span> }
          </div>
        }
        @if (phase() === 'review' && preview()) { <img class="selfie-review" [src]="preview()" alt="Captured selfie"> }
        <div class="scan-status" aria-live="polite">{{ status() }}</div>
        @if (phase() === 'error') { <div class="scan-nocam" role="alert"><div style="font-size:38px">📷</div><b>{{ error() }}</b><p>{{ hint() }}</p></div> }
      </div>
      <div class="scan-ft">
        @switch (phase()) {
          @case ('review') {
            <div class="row2">
              <button type="button" (click)="retake()">↺ Retake</button>
              <button type="button" class="selfie-ok" (click)="confirm()">✓ Confirm</button>
            </div>
          }
          @case ('error') {
            <div class="row2"><button type="button" (click)="start()">Try again</button><button type="button" (click)="close()">Close</button></div>
          }
          @default {
            <button type="button" class="selfie-ok" [disabled]="phase() === 'starting'" (click)="capture()">{{ phase() === 'turn' ? '📸 Capture now' : '📸 Capture' }}</button>
            <button type="button" (click)="close()">Cancel</button>
          }
        }
      </div>
    </div>`,
})
export class SelfieCamera implements OnInit, OnDestroy {
  /** The side the employee must turn their head to (their own left / right), from the server challenge. */
  direction = input<'LEFT' | 'RIGHT'>('LEFT');
  /** Take just the front-facing frame — no head-turn step. */
  single = input(false);
  heading = input('Selfie Attendance Punch');
  captured = output<SelfieCapture>();
  closed = output<void>();

  phase = signal<Phase>('starting');
  status = signal('Starting camera…');
  error = signal('');
  hint = signal('');
  preview = signal<string | null>(null);
  /** Seconds left before the head-turn frame is taken automatically (0 = not counting). */
  countdown = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private front: Blob | null = null;
  private turned: Blob | null = null;

  sub = () => this.phase() === 'turn' ? `Turn your head clearly to your ${this.direction().toLowerCase()}`
    : this.phase() === 'review' ? 'Check your selfie' : 'Look straight at the camera';

  ngOnInit() { this.start(); }
  ngOnDestroy() { this.stop(); this.revoke(); }

  async start() {
    this.phase.set('starting');
    this.status.set('Starting camera…');
    if (!window.isSecureContext) return this.fail('Camera needs a secure (HTTPS) connection', 'Open the app over HTTPS and try again.');
    if (!navigator.mediaDevices?.getUserMedia) return this.fail('Camera is not available on this device or browser', 'Use a device with a front camera and an up-to-date browser.');
    try {
      this.stop();
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
      } catch (e) {
        if ((e as DOMException)?.name !== 'OverconstrainedError') throw e;
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      const v = this.video().nativeElement;
      v.srcObject = this.stream;
      await v.play();
      this.front = this.turned = null;
      this.phase.set('front');
      this.status.set('Camera Ready — look straight at the camera and tap Capture');
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError')
        this.fail('Camera permission denied', 'Allow camera access for this app in your browser or phone settings, then tap Try again.');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError')
        this.fail('No camera found on this device', 'Selfie attendance needs a front-facing camera.');
      else if (name === 'NotReadableError' || name === 'AbortError')
        this.fail('Camera is in use or not responding', 'Close other apps using the camera, then tap Try again.');
      else this.fail('Camera unavailable', 'Check that the camera is connected and enabled, then tap Try again.');
    }
  }

  async capture() {
    this.clearCountdown();
    const blob = await this.grab();
    if (!blob) { this.status.set('Could not capture — hold still and try again'); return; }
    if (this.phase() === 'front' && !this.single()) {
      this.front = blob;
      this.phase.set('turn');
      this.startCountdown();
    } else {
      if (this.single()) this.front = blob;
      this.turned = blob;
      this.revoke();
      this.preview.set(URL.createObjectURL(this.front!));
      this.phase.set('review');
      this.status.set('Check your photo — Retake or Confirm');
    }
  }

  retake() {
    this.clearCountdown();
    this.revoke();
    this.front = this.turned = null;
    if (this.stream?.active) { this.phase.set('front'); this.status.set('Camera Ready — look straight at the camera and tap Capture'); }
    else this.start();
  }

  confirm() {
    if (!this.front || !this.turned) return;
    this.stop();
    // The parent owns the preview URL from here on.
    const preview = this.preview()!;
    this.preview.set(null);
    this.captured.emit({ front: this.front, turned: this.turned, preview });
  }

  close() { this.stop(); this.closed.emit(); }

  /** Current video frame as JPEG, as the camera sees it (the on-screen preview is only mirrored with CSS). */
  private grab(): Promise<Blob | null> {
    const v = this.video().nativeElement;
    if (!v.videoWidth) return Promise.resolve(null);
    const scale = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.9));
  }
  private fail(msg: string, hint: string) { this.stop(); this.phase.set('error'); this.error.set(msg); this.hint.set(hint); this.status.set(''); }
  /** Gives the employee time to turn their head, then takes the second frame on its own. */
  private startCountdown() {
    const turnMsg = () => `Turn your head clearly to your ${this.direction().toLowerCase()} — capturing in ${this.countdown()}s`;
    this.clearCountdown();
    this.countdown.set(TURN_SECONDS);
    this.status.set(turnMsg());
    this.timer = setInterval(() => {
      this.countdown.update(n => n - 1);
      if (this.countdown() > 0) this.status.set(turnMsg());
      else if (this.phase() === 'turn') this.capture();
      else this.clearCountdown();
    }, 1000);
  }
  private clearCountdown() { if (this.timer) clearInterval(this.timer); this.timer = null; this.countdown.set(0); }
  private stop() { this.clearCountdown(); this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
  private revoke() { const p = this.preview(); if (p) URL.revokeObjectURL(p); this.preview.set(null); }
}
