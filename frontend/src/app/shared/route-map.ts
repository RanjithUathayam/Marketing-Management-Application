import { Component, computed, input } from '@angular/core';

export interface MapPoint { lat: number; lng: number; label?: string | null; deviation?: boolean; tone?: string }

/** Projects GPS points into a small SVG "map" (equirectangular, auto-fitted). */
@Component({
  selector: 'app-route-map',
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h()" width="100%" [attr.height]="h()" role="img" [attr.aria-label]="label()">
      @if (path() && line()) { <path [attr.d]="path()" fill="none" stroke="#0d6e50" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round" /> }
      @for (p of proj(); track $index; let last = $last) {
        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="7" [attr.fill]="p.tone || (p.deviation ? '#dc2626' : last && line() ? '#2563eb' : '#0d6e50')" />
        @if (p.label) { <text [attr.x]="p.x" [attr.y]="p.y - 11" font-size="9" font-weight="800" fill="#0f172a" text-anchor="middle">{{ p.label }}</text> }
      }
      @if (!proj().length) { <text [attr.x]="w / 2" [attr.y]="h() / 2" font-size="11" fill="#94a3b8" text-anchor="middle">No GPS points yet today</text> }
    </svg>`,
})
export class RouteMap {
  points = input<MapPoint[]>([]);
  line = input(true);
  h = input(180);
  label = input('Route map');
  w = 320;
  proj = computed(() => {
    const pts = this.points();
    if (!pts.length) return [];
    const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng), pad = 24;
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const sx = (this.w - 2 * pad) / Math.max(maxLng - minLng, 1e-4), sy = (this.h() - 2 * pad) / Math.max(maxLat - minLat, 1e-4), s = Math.min(sx, sy);
    return pts.map(p => ({ ...p, x: pad + (p.lng - minLng) * s, y: this.h() - pad - (p.lat - minLat) * s }));
  });
  path = computed(() => this.proj().map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
}
