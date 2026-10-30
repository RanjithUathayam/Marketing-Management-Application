import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthResponse, Role, User } from './models';

const KEY = 'mma.session';
interface Session { accessToken: string; refreshToken: string; user: User }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private session = signal<Session | null>(this.restore());
  private refreshing: Promise<string | null> | null = null;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly isLoggedIn = computed(() => !!this.session());
  readonly role = computed<Role | null>(() => this.session()?.user.role ?? null);
  readonly isManager = computed(() => this.role() === 'MANAGER' || this.role() === 'ADMIN');

  /** Object URL of the signed-in user's profile photo (null → show initials). */
  readonly photoUrl = signal<string | null>(null);
  private photoKey: string | null = null;

  constructor() {
    effect(() => {
      const u = this.user();
      const key = u?.hasPhoto ? `${u.id}@${u.photoUpdatedAt}` : null;
      untracked(() => this.loadPhoto(key));
    });
  }

  get accessToken() { return this.session()?.accessToken ?? null; }

  /** The photo is not a public file, so it is fetched with the user's token; refetched only when it changes. */
  private async loadPhoto(key: string | null) {
    if (key === this.photoKey) return;
    this.photoKey = key;
    const old = this.photoUrl();
    if (old) URL.revokeObjectURL(old);
    this.photoUrl.set(null);
    if (!key) return;
    try {
      const b = await firstValueFrom(this.http.get(`${environment.apiUrl}/auth/me/photo`, { responseType: 'blob' }));
      if (this.photoKey === key) this.photoUrl.set(URL.createObjectURL(b));
    } catch { /* initials instead */ }
  }

  private restore(): Session | null {
    // Ignore anything that isn't a complete session (old format, tampered or half-written storage).
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      return s?.accessToken && s?.refreshToken && s?.user?.id && s?.user?.role ? s : null;
    } catch { return null; }
  }
  private store(s: Session | null) {
    this.session.set(s);
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
  }

  requestOtp(mobile: string) {
    return firstValueFrom(this.http.post<{ sent: boolean; channels: string[]; devOtp?: string; expiresInSeconds: number }>(
      `${environment.apiUrl}/auth/otp/request`, { mobile }));
  }
  async verifyOtp(mobile: string, otp: string) {
    const r = await firstValueFrom(this.http.post<AuthResponse>(`${environment.apiUrl}/auth/otp/verify`, { mobile, otp }));
    if (!r?.accessToken || !r?.user?.role) throw new Error('Sign-in failed — please try again');
    this.store(r);
    return r.user;
  }
  async reloadProfile() {
    const u = await firstValueFrom(this.http.get<User>(`${environment.apiUrl}/auth/me`));
    const s = this.session();
    if (s) this.store({ ...s, user: u });
  }

  /** Single-flight refresh: concurrent 401s share one refresh request. */
  refresh(): Promise<string | null> {
    const s = this.session();
    if (!s) return Promise.resolve(null);
    this.refreshing ??= firstValueFrom(this.http.post<AuthResponse>(`${environment.apiUrl}/auth/refresh`, { refreshToken: s.refreshToken }))
      .then(r => { this.store(r); return r.accessToken; })
      .catch(() => { this.store(null); return null; })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async logout(navigate = true) {
    const s = this.session();
    this.store(null);
    if (s) await firstValueFrom(this.http.post(`${environment.apiUrl}/auth/logout`, { refreshToken: s.refreshToken })).catch(() => {});
    if (navigate) this.router.navigateByUrl('/login');
  }

  /** Landing route for the signed-in role. */
  home() { return this.isManager() ? '/manager' : '/home'; }
}
