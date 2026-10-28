import { Injectable, signal } from '@angular/core';

export interface Coords { lat: number; lng: number; accuracy?: number }

/** Device location with a timeout; resolves null when unavailable or denied. */
@Injectable({ providedIn: 'root' })
export class Geo {
  readonly last = signal<Coords | null>(null);
  readonly denied = signal(false);

  current(timeoutMs = 8000): Promise<Coords | null> {
    if (!('geolocation' in navigator)) return Promise.resolve(null);
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        p => {
          const c = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: p.coords.accuracy };
          this.last.set(c);
          this.denied.set(false);
          resolve(c);
        },
        err => { if (err.code === err.PERMISSION_DENIED) this.denied.set(true); resolve(this.last()); },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
      );
    });
  }

  static distanceM(a: Coords, b: Coords) {
    const R = 6371000, r = (x: number) => (x * Math.PI) / 180;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
}
