import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from './core/auth.service';
import { Ui } from './core/ui.service';
import { Badges } from './core/badges.service';
import { Avatar } from './shared/avatar';

interface NavItem { id: string; route: string; lbl: string; ic: SafeHtml; badge?: () => number; group?: string }

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  map: '<path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z"/><circle cx="12" cy="10" r="3"/>',
  clip: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 13l2 2 4-4"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="12" y="6" width="3" height="12"/><rect x="17" y="13" width="3" height="5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0114 0v1"/>',
  team: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.9"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
  store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  pad: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
};

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Avatar],
  template: `
    <div class="app-frame" [class.wide]="wide()" [class.has-side]="showSide()">
      @if (showSide()) {
        <aside class="sidenav" aria-label="Main navigation">
          <div class="sn-brand"><span class="sn-logo" aria-hidden="true">🧭</span><span>Marketing<br>Management</span></div>
          <nav class="sn-list">
            @for (n of sideItems(); track n.id; let i = $index) {
              @if (n.group && n.group !== sideItems()[i - 1]?.group) { <div class="sn-group">{{ n.group }}</div> }
              <button type="button" class="sn-item" [class.on]="isActive(n)" [attr.aria-current]="isActive(n) ? 'page' : null" (click)="router.navigateByUrl(n.route)">
                <svg viewBox="0 0 24 24" [innerHTML]="n.ic" aria-hidden="true"></svg><span>{{ n.lbl }}</span>
                @if (n.badge && n.badge() > 0) { <em>{{ n.badge() }}</em> }
              </button>
            }
          </nav>
          <div class="sn-user">
            <app-avatar />
            <div class="sn-user-tx"><b>{{ user()?.name }}</b><span>{{ user()?.designation || user()?.role }} · {{ user()?.empCode }}</span></div>
            <button type="button" class="sn-out" (click)="logout()" title="Sign out" aria-label="Sign out">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg></button>
          </div>
        </aside>
      }
      <div class="main-col">
        @if (!online()) { <div class="offline-bar" role="alert">📶 You're offline — changes can't be saved until the connection is back.</div> }
        <main class="screen-stack"><router-outlet /></main>
        @if (nav(); as active) {
          <nav class="tabbar" aria-label="Main">
            @for (n of items(); track n.id) {
              <button type="button" class="nt" [class.on]="n.id === active" [attr.aria-current]="n.id === active ? 'page' : null" (click)="router.navigateByUrl(n.route)">
                @if (n.badge && n.badge() > 0) { <span class="nb">{{ n.badge() }}</span> }
                <svg viewBox="0 0 24 24" [innerHTML]="n.ic" aria-hidden="true"></svg>{{ n.lbl }}
              </button>
            }
          </nav>
        }
      </div>
      <div class="toast" [class.show]="ui.toastMsg()" [class.error]="ui.toastMsg()?.kind === 'error'" [class.success]="ui.toastMsg()?.kind === 'success'" role="status" aria-live="polite">{{ ui.toastMsg()?.text }}</div>
      @if (ui.confirmState(); as c) {
        <div class="mask show" (click)="ui.closeConfirm(false)"></div>
        <section class="sheet show" role="alertdialog" aria-modal="true" [attr.aria-label]="c.title">
          <div class="sheet-grip"></div>
          <div class="sheet-head"><b>{{ c.title }}</b>@if (c.message) {<span>{{ c.message }}</span>}</div>
          <div class="btn-row">
            <button type="button" class="btn ghost" (click)="ui.closeConfirm(false)">{{ c.cancelText || 'Cancel' }}</button>
            <button type="button" class="btn" [class.primary]="!c.danger" [class.danger-ghost]="c.danger" (click)="ui.closeConfirm(true)">{{ c.confirmText || 'Confirm' }}</button>
          </div>
        </section>
      }
    </div>`,
})
export class App {
  router = inject(Router);
  ui = inject(Ui);
  private auth = inject(AuthService);
  private badges = inject(Badges);
  private sanitizer = inject(DomSanitizer);
  /** Static, developer-authored SVG paths — safe to trust. */
  private icon = (k: keyof typeof ICONS) => this.sanitizer.bypassSecurityTrustHtml(ICONS[k]);
  nav = signal<string | null>(null);
  wide = signal(false);
  url = signal('');
  user = this.auth.user;
  /** Sidebar (desktop only, via CSS) on every signed-in screen except Start Day. */
  showSide = computed(() => this.auth.isLoggedIn() && !this.url().startsWith('/login') && !this.url().startsWith('/start-day'));

  /* Bottom bar (phone / tablet) */
  private execNav: NavItem[] = [
    { id: 'home', route: '/home', lbl: 'Home', ic: this.icon('grid') },
    { id: 'route', route: '/route', lbl: 'Route', ic: this.icon('map') },
    { id: 'work', route: '/work', lbl: 'Visits', ic: this.icon('pin') },
    { id: 'orders', route: '/orders', lbl: 'Order Status', ic: this.icon('clip'), badge: () => this.badges.ordersInProgress() },
    { id: 'reports', route: '/reports', lbl: 'Reports', ic: this.icon('chart') },
    { id: 'profile', route: '/profile', lbl: 'Profile', ic: this.icon('user') },
  ];
  private mgrNav: NavItem[] = [
    { id: 'mgr-home', route: '/manager', lbl: 'Overview', ic: this.icon('grid') },
    { id: 'mgr-team', route: '/manager/team', lbl: 'Team', ic: this.icon('team') },
    { id: 'mgr-approve', route: '/manager/approvals', lbl: 'Approvals', ic: this.icon('check'), badge: () => this.badges.approvals() },
    { id: 'mgr-track', route: '/manager/track', lbl: 'Track', ic: this.icon('pin') },
    { id: 'mgr-reports', route: '/manager/reports', lbl: 'Reports', ic: this.icon('chart') },
    { id: 'profile', route: '/profile', lbl: 'Profile', ic: this.icon('user') },
  ];
  items = computed(() => (this.auth.isManager() ? this.mgrNav : this.execNav));

  /* Sidebar (desktop): everything reachable in one click */
  private execSide: NavItem[] = [
    { id: 'home', route: '/home', lbl: 'Home', ic: this.icon('grid'), group: 'Field work' },
    { id: 'route', route: '/route', lbl: 'Journey Plan', ic: this.icon('map'), group: 'Field work' },
    { id: 'work', route: '/work', lbl: 'Visits', ic: this.icon('pin'), group: 'Field work' },
    { id: 'outlets', route: '/outlets', lbl: 'Outlets & Orders', ic: this.icon('store'), group: 'Field work' },
    { id: 'orders', route: '/orders', lbl: 'Order Status', ic: this.icon('clip'), badge: () => this.badges.ordersInProgress(), group: 'Field work' },
    { id: 'sample-pads', route: '/sample-pads', lbl: 'Sample Pads', ic: this.icon('pad'), group: 'Field work' },
    { id: 'targets', route: '/targets', lbl: 'Targets', ic: this.icon('target'), group: 'Performance' },
    { id: 'reports', route: '/reports', lbl: 'Reports', ic: this.icon('chart'), group: 'Performance' },
    { id: 'tracking', route: '/tracking', lbl: 'Live Tracking', ic: this.icon('pin'), group: 'Performance' },
    { id: 'expenses', route: '/expenses', lbl: 'Expenses', ic: this.icon('receipt'), group: 'Me' },
    { id: 'attendance', route: '/attendance', lbl: 'Attendance', ic: this.icon('cal'), group: 'Me' },
    { id: 'notifications', route: '/notifications', lbl: 'Notifications', ic: this.icon('bell'), group: 'Me' },
    { id: 'profile', route: '/profile', lbl: 'Profile', ic: this.icon('user'), group: 'Me' },
  ];
  private mgrSide: NavItem[] = [
    { id: 'mgr-home', route: '/manager', lbl: 'Overview', ic: this.icon('grid'), group: 'Team' },
    { id: 'mgr-team', route: '/manager/team', lbl: 'Team', ic: this.icon('team'), group: 'Team' },
    { id: 'mgr-approve', route: '/manager/approvals', lbl: 'Approvals', ic: this.icon('check'), badge: () => this.badges.approvals(), group: 'Team' },
    { id: 'mgr-track', route: '/manager/track', lbl: 'Live Tracking', ic: this.icon('pin'), group: 'Team' },
    { id: 'orders', route: '/orders', lbl: 'Team Orders', ic: this.icon('clip'), group: 'Sales' },
    { id: 'customers', route: '/customers', lbl: 'Customers', ic: this.icon('store'), group: 'Sales' },
    { id: 'products', route: '/products', lbl: 'Products', ic: this.icon('box'), group: 'Sales' },
    { id: 'pads', route: '/manager/sample-pads', lbl: 'Sample Pad Object', ic: this.icon('pad'), group: 'Sales' },
    { id: 'mgr-reports', route: '/manager/reports', lbl: 'Reports', ic: this.icon('chart'), group: 'Sales' },
    { id: 'notifications', route: '/notifications', lbl: 'Notifications', ic: this.icon('bell'), group: 'Me' },
    { id: 'profile', route: '/profile', lbl: 'Profile', ic: this.icon('user'), group: 'Me' },
  ];
  private adminSide: NavItem[] = [{ id: 'admin', route: '/admin/users', lbl: 'Users & Beats', ic: this.icon('gear'), group: 'Admin' }];
  sideItems = computed(() => this.auth.isManager()
    ? [...this.mgrSide, ...(this.auth.role() === 'ADMIN' ? this.adminSide : [])]
    : this.execSide);

  /** Longest matching route wins, so /manager/team doesn't also light up /manager. */
  isActive(n: NavItem) {
    const u = this.url().split('?')[0];
    const match = (r: string) => u === r || u.startsWith(r + '/');
    if (!match(n.route)) return false;
    return !this.sideItems().some(o => o !== n && o.route.length > n.route.length && match(o.route));
  }

  /** Field users often lose signal — show it instead of letting requests fail silently. */
  online = signal(navigator.onLine);

  constructor() {
    // Refresh the stored profile so a photo the admin added since sign-in shows up.
    if (this.auth.isLoggedIn()) this.auth.reloadProfile().catch(() => {});
    window.addEventListener('offline', () => this.online.set(false));
    window.addEventListener('online', () => { this.online.set(true); this.ui.success('✅ Back online'); });
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      let s: ActivatedRouteSnapshot = this.router.routerState.snapshot.root;
      while (s.firstChild) s = s.firstChild;
      this.nav.set(s.data['nav'] ?? null);
      this.wide.set(!!s.data['wide']);
      this.url.set(this.router.url);
      this.badges.refresh();
    });
  }

  async logout() {
    if (await this.ui.confirm({ title: 'Sign out?', message: 'You will need an OTP to sign in again.', confirmText: 'Sign out', danger: true })) this.auth.logout();
  }
}
