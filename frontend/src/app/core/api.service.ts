import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

type Query = Record<string, string | number | boolean | null | undefined>;

/** Thin promise-based wrapper over HttpClient for the REST API. */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  readonly base = environment.apiUrl;

  private params(q?: Query) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return p;
  }
  get<T>(url: string, q?: Query) { return firstValueFrom(this.http.get<T>(this.base + url, { params: this.params(q) })); }
  post<T>(url: string, body: unknown = {}) { return firstValueFrom(this.http.post<T>(this.base + url, body)); }
  put<T>(url: string, body: unknown = {}) { return firstValueFrom(this.http.put<T>(this.base + url, body)); }
  /** multipart/form-data — the browser sets the boundary header. */
  upload<T>(url: string, form: FormData) { return firstValueFrom(this.http.post<T>(this.base + url, form)); }
  /** Authenticated binary GET (e.g. protected images that cannot be loaded by a plain <img src>). */
  blob(url: string) { return firstValueFrom(this.http.get(this.base + url, { responseType: 'blob' })); }
  async download(url: string, q: Query, filename: string) {
    const blob = await firstValueFrom(this.http.get(this.base + url, { params: this.params(q), responseType: 'blob' }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

/** Extracts a user-facing message from an HttpErrorResponse (or anything thrown). */
export function errorMessage(e: unknown): string {
  const err = e as { status?: number; error?: { error?: string }; message?: string };
  if (err?.status === 0) return 'Cannot reach the server. Check your connection.';
  return err?.error?.error || err?.message || 'Something went wrong';
}

/** Machine-readable `details.code` the API attaches to some errors (e.g. PROFILE_PHOTO_MISSING). */
export function errorCode(e: unknown): string | null {
  return (e as { error?: { details?: { code?: string } } })?.error?.details?.code ?? null;
}
