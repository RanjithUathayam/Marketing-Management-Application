import { Component, ElementRef, OnDestroy, OnInit, input, output, signal, viewChild } from '@angular/core';
import jsQR from 'jsqr';
import { environment } from '../../environments/environment';

/** Full-screen camera QR scanner: BarcodeDetector when available, jsQR otherwise, plus "scan from photo".
 *  `check` decides whether a decoded value is acceptable; it returns an error message to keep scanning. */
@Component({
  selector: 'app-qr-scanner',
  template: `
    <div class="scan" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <div class="scan-hd"><div style="font-size:18px">📷</div><b>{{ title() }}<small>{{ sub() }}</small></b>
        <button class="scan-x" type="button" (click)="close()" aria-label="Close scanner">✕</button></div>
      <div class="scan-vp">
        <video #video autoplay playsinline muted></video>
        <div class="scan-frame"><i></i><i></i><i></i><i></i><div class="scan-laser"></div></div>
        @if (flash()) { <div class="scan-flash"><span>✓</span></div> }
        <div class="scan-status" [style.color]="statusColor()">{{ status() }}</div>
        @if (noCam()) { <div class="scan-nocam"><div style="font-size:38px">📷</div><b>{{ noCam() }}</b><p>Use “Scan from photo” below.</p></div> }
      </div>
      <div class="scan-ft">
        <div class="row2">
          <label>🖼️ Scan from photo<input type="file" accept="image/*" capture="environment" (change)="fromPhoto($event)"></label>
          @if (demo && simulateValue()) { <button type="button" style="background:var(--ix);border-color:var(--ix)" (click)="accept(simulateValue()!, 'QR_SCAN')">Simulate scan (demo)</button> }
        </div>
        <button type="button" (click)="close()">Cancel</button>
      </div>
    </div>`,
})
export class QrScanner implements OnInit, OnDestroy {
  title = input('Scan QR');
  sub = input('');
  check = input<(text: string) => string | null>(() => null);
  /** Shown only in non-production builds to demo the flow without a printed QR. */
  simulateValue = input<string | null>(null);
  scanned = output<{ text: string; via: 'QR_SCAN' | 'PHOTO_SCAN' }>();
  closed = output<void>();

  demo = !environment.production;
  status = signal('Starting camera…');
  statusColor = signal('rgba(255,255,255,.8)');
  noCam = signal<string | null>(null);
  flash = signal(false);
  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private running = false;
  private detector: { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> } | null = null;
  private canvas = document.createElement('canvas');

  async ngOnInit() {
    const BD = (window as unknown as { BarcodeDetector?: new (o: object) => QrScanner['detector'] }).BarcodeDetector;
    if (BD) try { this.detector = new BD({ formats: ['qr_code'] }); } catch { /* unsupported */ }
    if (!navigator.mediaDevices?.getUserMedia) { this.noCam.set('Camera unavailable on this device'); return; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      const v = this.video().nativeElement;
      v.srcObject = this.stream;
      await v.play();
      this.running = true;
      this.status.set('Point the camera at the QR code');
      this.loop();
    } catch (e) {
      this.noCam.set((e as DOMException)?.name === 'NotAllowedError' ? 'Camera permission denied' : 'Camera unavailable');
    }
  }
  ngOnDestroy() { this.stop(); }

  private stop() {
    this.running = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  private async loop() {
    if (!this.running) return;
    const v = this.video().nativeElement;
    let found: string | null = null;
    if (v.videoWidth) {
      if (this.detector) try { found = (await this.detector.detect(v))[0]?.rawValue ?? null; } catch { /* fall back */ }
      if (!found) found = this.decode(v, v.videoWidth, v.videoHeight, 'dontInvert');
    }
    if (found && this.accept(found.trim(), 'QR_SCAN')) return;
    setTimeout(() => requestAnimationFrame(() => this.loop()), 150);
  }

  private decode(src: CanvasImageSource, w: number, h: number, inversion: 'dontInvert' | 'attemptBoth') {
    this.canvas.width = w; this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    return jsQR(d.data, d.width, d.height, { inversionAttempts: inversion })?.data ?? null;
  }

  fromPhoto(ev: Event) {
    const inputEl = ev.target as HTMLInputElement, file = inputEl.files?.[0];
    if (!file) return;
    this.status.set('Reading QR…');
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      let text: string | null = null;
      for (const s of [1, 0.5, 0.75, 1.5]) {
        text = this.decode(img, Math.round(img.width * s), Math.round(img.height * s), 'attemptBoth');
        if (text) break;
      }
      URL.revokeObjectURL(url);
      inputEl.value = '';
      if (!text) this.setStatus('❌ QR not recognised — try better lighting', '#f87171');
      else this.accept(text.trim(), 'PHOTO_SCAN');
    };
    img.src = url;
  }

  accept(text: string, via: 'QR_SCAN' | 'PHOTO_SCAN'): boolean {
    const problem = this.check()(text);
    if (problem) { this.setStatus('⚠ ' + problem, '#fbbf24'); return false; }
    this.stop();
    this.flash.set(true);
    this.setStatus('✓ Verified', '#4ade80');
    setTimeout(() => this.scanned.emit({ text, via }), 550);
    return true;
  }
  private setStatus(t: string, c: string) { this.status.set(t); this.statusColor.set(c); }
  close() { this.stop(); this.closed.emit(); }
}
