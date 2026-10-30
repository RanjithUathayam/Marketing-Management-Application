import { Component, computed, input } from '@angular/core';

export interface MapPoint { lat: number; lng: number; label?: string | null; deviation?: boolean; tone?: string }
interface Marker extends MapPoint { x: number; y: number; count: number; title: string }

/** Projects GPS points into a small SVG "map" (equirectangular, auto-fitted and centred).
 *  Without a route line (team view), markers closer than ~18px are grouped so labels never overlap. */
@Component({
  selector: 'app-route-map',
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h()" width="100%" [attr.height]="h()" role="img" [attr.aria-label]="label()">
      @if (path() && line()) { <path [attr.d]="path()" fill="none" stroke="#0d6e50" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round" /> }
      @for (p of markers(); track $index; let last = $last) {
        <g><title>{{ p.title }}</title>
          <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="p.count > 1 ? 10 : 7" [attr.fill]="p.tone || (p.deviation ? '#dc2626' : last && line() ? '#2563eb' : '#0d6e50')" stroke="#fff" stroke-width="2" />
          @if (p.count > 1) { <text [attr.x]="p.x" [attr.y]="p.y + 3.5" font-size="10" font-weight="800" fill="#fff" text-anchor="middle">{{ p.count }}</text> }
          @if (p.label) { <text [attr.x]="p.x" [attr.y]="p.y - 13" font-size="9.5" font-weight="800" fill="#0f172a" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">{{ p.label }}</text> }
        </g>
      }
      @if (!markers().length) { <text [attr.x]="w / 2" [attr.y]="h() / 2" font-size="11" fill="#94a3b8" text-anchor="middle">No GPS points yet today</text> }
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
    const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng), pad = 28;
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const sx = (this.w - 2 * pad) / Math.max(maxLng - minLng, 1e-4), sy = (this.h() - 2 * pad) / Math.max(maxLat - minLat, 1e-4), s = Math.min(sx, sy);
    const ox = (this.w - 2 * pad - (maxLng - minLng) * s) / 2, oy = (this.h() - 2 * pad - (maxLat - minLat) * s) / 2;
    return pts.map(p => ({ ...p, x: pad + ox + (p.lng - minLng) * s, y: this.h() - pad - oy - (p.lat - minLat) * s }));
  });
  markers = computed<Marker[]>(() => {
    const pts = this.proj();
    if (this.line()) return pts.map(p => ({ ...p, count: 1, title: p.label ?? '' }));
    const groups: (typeof pts)[] = [];
    for (const p of pts) {
      const g = groups.find(g => Math.hypot(g[0].x - p.x, g[0].y - p.y) < 18);
      g ? g.push(p) : groups.push([p]);
    }
    return groups.map(g => ({
      ...g[0], count: g.length,
      label: g.length > 1 ? `${g[0].label} +${g.length - 1}` : g[0].label,
      title: g.map(p => p.label).join(', '),
      tone: g.some(p => p.tone === '#0d6e50') ? '#0d6e50' : g[0].tone,
    }));
  });
  path = computed(() => this.proj().map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
}
