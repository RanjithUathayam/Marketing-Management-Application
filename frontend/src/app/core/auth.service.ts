import { Injectable, computed, inject, signal } from '@angular/core';
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

  get accessToken() { return this.session()?.accessToken ?? null; }

  private restore(): Session | null {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
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
