import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from './core/auth.service';
import { Ui } from './core/ui.service';
import { Badges } from './core/badges.service';

interface NavItem { id: string; route: string; lbl: string; ic: SafeHtml; badge?: () => number }

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  map: '<path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z"/><circle cx="12" cy="10" r="3"/>',
  clip: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 13l2 2 4-4"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="12" y="6" width="3" height="12"/><rect x="17" y="13" width="3" height="5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0114 0v1"/>',
  team: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.9"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
};

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <div class="app-frame" [class.wide]="wide()">
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

  constructor() {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      let s: ActivatedRouteSnapshot = this.router.routerState.snapshot.root;
      while (s.firstChild) s = s.firstChild;
      this.nav.set(s.data['nav'] ?? null);
      this.wide.set(!!s.data['wide']);
      this.badges.refresh();
    });
  }
}
