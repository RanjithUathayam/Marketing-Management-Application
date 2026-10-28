import { Component, ElementRef, effect, input, model, output, viewChild, inject, computed, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import QRCode from 'qrcode';
import { InsightStrip, Order, VisitIndicator } from '../core/models';
import { ORDER_STAGES, stage, stageIdx } from '../core/format';

/** Green top app bar with optional back button and right-side content. */
@Component({
  selector: 'app-bar',
  template: `
    <header class="bar" [class.grad]="grad()">
      @if (back()) { <button class="bk" type="button" (click)="goBack()" aria-label="Back">←</button> }
      <div class="btitle">{{ title() }} @if (sub()) { <small>{{ sub() }}</small> }</div>
      <ng-content />
    </header>`,
})
export class AppBar {
  title = input.required<string>();
  sub = input<string | null | undefined>('');
  back = input(true);
  grad = input(false);
  fallback = input('/');
  private location = inject(Location);
  private router = inject(Router);
  goBack() { history.length > 1 ? this.location.back() : this.router.navigateByUrl(this.fallback()); }
}

/** Bottom sheet with mask. Two-way bind [(open)]. */
@Component({
  selector: 'app-sheet',
  template: `
    <div class="mask" [class.show]="open()" (click)="close()"></div>
    <section class="sheet" [class.show]="open()" role="dialog" aria-modal="true" [attr.aria-hidden]="!open()">
      <div class="sheet-grip"></div>
      @if (heading()) { <div class="sheet-head"><b>{{ heading() }}</b>@if (subheading()) {<span>{{ subheading() }}</span>}</div> }
      @if (open()) { <ng-content /> }
    </section>`,
})
export class Sheet {
  open = model(false);
  heading = input<string>('');
  subheading = input<string>('');
  closed = output<void>();
  close() { this.open.set(false); this.closed.emit(); }
}

/** Loading spinner / error with retry / content. */
@Component({
  selector: 'app-state',
  template: `
    @if (error()) {
      <div class="err-box" role="alert"><span>⚠ {{ error() }}</span><button class="btn sm ghost" type="button" (click)="retry.emit()">Retry</button></div>
    } @else if (loading()) { <div class="spin" aria-label="Loading"></div> }
    @else { <ng-content /> }`,
})
export class StateView {
  loading = input(false);
  error = input<string | null>(null);
  retry = output<void>();
}

@Component({
  selector: 'app-visit-badge',
  template: `<em class="vind {{ ind().tone }} {{ size() }}" [title]="ind().label + ' this month'">{{ ind().code }}</em>`,
})
export class VisitBadge {
  ind = input.required<VisitIndicator>();
  size = input<'' | 'sm' | 'lg'>('');
}

@Component({
  selector: 'app-insight-strip',
  template: `
    <div class="ins-strip">
      <em class="vind nv sm">NV</em><b>{{ s().nv }}</b><em class="vind v1 sm">MV</em><b>{{ s().mv }}</b><em class="vind v3 sm">Vs</em><b>{{ s().vs }}</b>
      @if (s().mustVisit) { <span class="ins-flag must">⚑ {{ s().mustVisit }} must visit</span> }
      @if (s().lowCalls) { <span class="ins-flag low">⚠ {{ s().lowCalls }} low calls</span> }
    </div>`,
})
export class InsightStripView { s = input.required<InsightStrip>(); }

@Component({
  selector: 'app-status-pill',
  template: `<span class="os-pill" [class.sm]="sm()" [class.live]="status() !== 'COMPLETED'" [style.--c]="st().c" [style.--c2]="st().c2"><i></i>{{ st().short }}</span>`,
})
export class StatusPill {
  status = input.required<Order['status']>();
  sm = input(false);
  st = computed(() => stage(this.status()));
}

@Component({
  selector: 'app-mini-track',
  template: `<div class="os-mini">@for (s of stages; track s.k; let i = $index) {<i [class.done]="i < n()" [class.cur]="i === n()" [style.--c]="c()"></i>}</div>`,
})
export class MiniTrack {
  status = input.required<Order['status']>();
  stages = ORDER_STAGES;
  n = computed(() => stageIdx(this.status()));
  c = computed(() => stage(this.status()).c);
}

/** Renders text as a QR code image. */
@Component({
  selector: 'app-qr',
  template: `@if (src()) { <img [src]="src()" [width]="size()" [height]="size()" [alt]="'QR code ' + text()"> }`,
})
export class QrImage {
  text = input.required<string>();
  size = input(150);
  dark = input('#1e1b4b');
  src = signal('');
  constructor() {
    effect(() => {
      QRCode.toDataURL(this.text(), { width: this.size(), margin: 1, errorCorrectionLevel: 'M', color: { dark: this.dark(), light: '#ffffff' } })
        .then(u => this.src.set(u)).catch(() => this.src.set(''));
    });
  }
}

/** Canvas signature pad. Emits a PNG data URL on every stroke end; empty string when cleared. */
@Component({
  selector: 'app-signature',
  template: `
    <canvas #cv width="640" height="220" style="width:100%;height:110px;background:var(--bg);border-radius:10px;border:1.5px dashed var(--brd2);touch-action:none"
      (pointerdown)="start($event)" (pointermove)="move($event)" (pointerup)="end()" (pointerleave)="end()" aria-label="Customer signature"></canvas>
    <button class="pillbtn mt8" type="button" (click)="clear()">Clear</button>`,
})
export class SignaturePad {
  changed = output<string>();
  private cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private drawing = false;
  private last: [number, number] = [0, 0];
  private dirty = false;
  private ctx() {
    const c = this.cv().nativeElement.getContext('2d')!;
    c.strokeStyle = '#0f172a'; c.lineWidth = 3.5; c.lineCap = 'round'; c.lineJoin = 'round';
    return c;
  }
  private pos(e: PointerEvent): [number, number] {
    const el = this.cv().nativeElement, r = el.getBoundingClientRect();
    return [((e.clientX - r.left) * el.width) / r.width, ((e.clientY - r.top) * el.height) / r.height];
  }
  start(e: PointerEvent) { this.drawing = true; this.last = this.pos(e); this.cv().nativeElement.setPointerCapture(e.pointerId); }
  move(e: PointerEvent) {
    if (!this.drawing) return;
    const p = this.pos(e), c = this.ctx();
    c.beginPath(); c.moveTo(...this.last); c.lineTo(...p); c.stroke();
    this.last = p; this.dirty = true;
  }
  end() {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.dirty) this.changed.emit(this.cv().nativeElement.toDataURL('image/png'));
  }
  clear() {
    const el = this.cv().nativeElement;
    el.getContext('2d')!.clearRect(0, 0, el.width, el.height);
    this.dirty = false;
    this.changed.emit('');
  }
}
