import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Ui } from '../../core/ui.service';
import { AttendanceToday, MySamplePads, Notification, Outlet, Paged, Product } from '../../core/models';
import { DtPipe, InrPipe, PERF, STOCK_HEX, TimePipe, initials } from '../../core/format';
import { AppBar, Sheet, StateView } from '../../shared/ui.components';
import { OrderStore } from '../order/order.store';

/* ── Profile ── */
@Component({
  selector: 'app-profile',
  imports: [FormsModule, RouterLink, AppBar, Sheet, InrPipe, TimePipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Profile" [back]="false" />
    <div class="body pad">
      <div class="card p center">
        <div class="av" style="width:70px;height:70px;font-size:24px;margin:0 auto 10px;background:linear-gradient(135deg,#0d6e50,#10a070)">{{ ini() }}</div>
        <b style="font-size:17px">{{ u()?.name }}</b><div class="muted">{{ u()?.designation || u()?.role }} · {{ u()?.empCode }}</div>
        @if (att(); as a) {
          @if (a.openSession) { <div class="chip c-green mt8"><span class="d"></span>On duty · checked in {{ a.openSession.CheckInAt | time }}</div> }
          @else if (a.dayEnded) { <div class="chip c-grey mt8"><span class="d"></span>Day ended</div> }
        }
      </div>
      <div class="card mt12">
        @for (r of details(); track r[1]) { <div class="lrow static"><div class="av" style="background:var(--g2);color:var(--g)">{{ r[0] }}</div><div class="lr-main"><b>{{ r[1] }}</b><span>{{ r[2] }}</span></div></div> }
      </div>
      <div class="card mt12">
        @for (r of links(); track r.route) {
          <button type="button" class="lrow" [routerLink]="r.route"><div class="av" [style.background]="r.ix ? 'var(--ix)' : 'var(--g)'">{{ r.ic }}</div>
            <div class="lr-main"><b>{{ r.lbl }}</b>@if (r.sub) {<span>{{ r.sub }}</span>}</div>
            @if (r.badge) { <span class="chip xs c-amber">{{ r.badge }}</span> }<div class="lr-go">›</div></button>
        }
      </div>
      @if (!auth.isManager() && att()?.dayStarted && !att()?.dayEnded) {
        <button class="btn danger-ghost mt14" type="button" (click)="openEnd()">🌙 End Day &amp; Check Out</button>
      }
      <button class="btn ghost mt8" type="button" (click)="logout()">⎋ Sign out</button>
    </div>
    <app-sheet [(open)]="endOpen" heading="End Day Check-out">
      @if (att()?.day?.travelMode === 'OWN_VEHICLE') {
        <div class="fld"><label for="oe">Ending Odometer (start {{ att()?.day?.odoStart }})</label><input id="oe" type="number" inputmode="numeric" [(ngModel)]="odoEnd"></div>
        @if (odoKm() !== null) { <div class="chip c-green mb12"><span class="d"></span>Distance today: {{ odoKm() }} km</div> }
      }
      @if (summary(); as s) { <div class="metrics mb12"><div><b>{{ s.visits }}</b><span>Visits</span></div><div><b>{{ s.sales | inr }}</b><span>Sales</span></div><div><b>{{ s.gpsKm }} km</b><span>GPS Travel</span></div></div> }
      <button class="btn primary" type="button" [disabled]="busy()" (click)="endDay()">Confirm Check-out</button>
    </app-sheet>`,
})
export class ProfilePage {
  auth = inject(AuthService);
  private api = inject(Api);
  private ui = inject(Ui);
  private router = inject(Router);
  u = this.auth.user;
  att = signal<AttendanceToday | null>(null);
  pads = signal<MySamplePads | null>(null);
  endOpen = signal(false);
  busy = signal(false);
  summary = signal<{ visits: number; sales: number; gpsKm: number } | null>(null);
  odoEnd: number | null = null;
  ini = computed(() => initials(this.u()?.name ?? ''));
  odoKm = () => (this.odoEnd && this.att()?.day?.odoStart != null ? Number(this.odoEnd) - this.att()!.day!.odoStart! : null);
  details = computed(() => {
    const u = this.u();
    return [['🧭', 'Region', u?.region || '—'], ['👤', 'Reporting to', u?.manager ? `${u.manager.name} · ${u.manager.designation ?? ''}` : '—'],
      ['📞', 'Contact', u?.mobile ?? ''], ['🚗', 'Travel today', this.travel()]];
  });
  travel = () => ({ OWN_VEHICLE: 'Own Vehicle', BUS: 'Bus', CAB: 'Cab', WALK: 'Walk' } as Record<string, string>)[this.att()?.day?.travelMode ?? ''] ?? '—';
  links = computed(() => {
    if (this.auth.isManager()) {
      const l = [{ ic: '🗂️', lbl: 'Sample Pad object', route: '/manager/sample-pads', ix: true, sub: 'Salesforce view · remarks & reminders', badge: 0 },
        { ic: '📦', lbl: 'Team orders', route: '/orders', ix: false, sub: '', badge: 0 },
        { ic: '🏪', lbl: 'Customers / Retailers', route: '/customers', ix: false, sub: '', badge: 0 },
        { ic: '👕', lbl: 'Products / SKU', route: '/products', ix: false, sub: '', badge: 0 }];
      if (this.auth.role() === 'ADMIN') l.push({ ic: '🛠️', lbl: 'Users & beats (admin)', route: '/admin/users', ix: false, sub: '', badge: 0 });
      return l;
    }
    const n = this.pads()?.pending ?? 0;
    return [{ ic: '🏪', lbl: 'Customers / Retailers', route: '/customers', ix: false, sub: '', badge: 0 },
      { ic: '📦', lbl: 'Products / SKU', route: '/products', ix: false, sub: '', badge: 0 },
      { ic: '🗂️', lbl: 'Sample Pads', route: '/sample-pads', ix: true, sub: n ? `${n} pending acknowledgement` : 'All acknowledged', badge: n },
      { ic: '🧾', lbl: 'Expenses', route: '/expenses', ix: false, sub: '', badge: 0 },
      { ic: '📅', lbl: 'Attendance', route: '/attendance', ix: false, sub: '', badge: 0 }];
  });
  constructor() {
    if (!this.auth.isManager()) {
      this.api.get<AttendanceToday>('/attendance/today').then(a => this.att.set(a)).catch(() => {});
      this.api.get<MySamplePads>('/sample-pads').then(p => this.pads.set(p)).catch(() => {});
    }
  }
  async openEnd() {
    this.endOpen.set(true);
    try { this.summary.set(await this.api.get('/attendance/day-summary')); } catch { /* optional */ }
  }
  async endDay() {
    const own = this.att()?.day?.travelMode === 'OWN_VEHICLE';
    if (own && !(Number(this.odoEnd) >= (this.att()?.day?.odoStart ?? 0))) { this.ui.error(`Ending odometer must be at least ${this.att()?.day?.odoStart}`); return; }
    this.busy.set(true);
    try {
      await this.api.post('/attendance/end-day', own ? { odoEnd: Number(this.odoEnd) } : {});
      this.endOpen.set(false);
      this.ui.success('🌙 Checked out. See you tomorrow!');
      this.att.set(await this.api.get<AttendanceToday>('/attendance/today'));
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  async logout() {
    if (await this.ui.confirm({ title: 'Sign out?', message: 'You will need an OTP to sign in again.', confirmText: 'Sign out', danger: true })) this.auth.logout();
  }
}

/* ── Notifications ── */
@Component({
  selector: 'app-notifications',
  imports: [AppBar, StateView, DtPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Notifications" [sub]="unread() ? unread() + ' unread' : ''">
      @if (unread()) { <button class="bar-preview" type="button" (click)="readAll()">Mark all read</button> }
    </app-bar>
    <div class="body pad">
      <app-state [loading]="!items() && !err()" [error]="err()" (retry)="load()">
        @for (n of items() ?? []; track n.id) {
          <button type="button" class="card p" style="margin-bottom:9px;display:flex;gap:11px;align-items:flex-start;width:100%;text-align:left;cursor:pointer"
                  [style.background]="n.isRead ? '' : '#f8fffc'" [style.border-color]="n.isRead ? '' : 'var(--g3)'" (click)="open(n)">
            <div style="font-size:20px">{{ n.icon }}</div>
            <div style="flex:1"><b style="font-size:13px">{{ n.title }}</b><div class="muted" style="margin-top:2px">{{ n.body }}</div><div class="tiny mt8">{{ n.createdAt | dt }}</div></div>
            @if (!n.isRead) { <span style="width:8px;height:8px;border-radius:50%;background:var(--r);flex-shrink:0;margin-top:5px" aria-label="Unread"></span> }
          </button>
        } @empty { <div class="empty">You're all caught up.</div> }
      </app-state>
    </div>`,
})
export class NotificationsPage {
  private api = inject(Api);
  private router = inject(Router);
  items = signal<Notification[] | null>(null);
  unread = signal(0);
  err = signal<string | null>(null);
  constructor() { this.load(); }
  async load() {
    this.err.set(null);
    try { const r = await this.api.get<{ items: Notification[]; unread: number }>('/notifications'); this.items.set(r.items); this.unread.set(r.unread); }
    catch (e) { this.err.set(errorMessage(e)); }
  }
  async open(n: Notification) {
    if (!n.isRead) { await this.api.post(`/notifications/${n.id}/read`).catch(() => {}); this.load(); }
    if (n.link) this.router.navigateByUrl(n.link);
  }
  async readAll() { await this.api.post('/notifications/read-all').catch(() => {}); this.load(); }
}

/* ── Customers / retailers master ── */
@Component({
  selector: 'app-customers',
  imports: [FormsModule, AppBar, StateView, Sheet, InrPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Customers / Retailers" [sub]="total() + ' outlets'" />
    <div class="srch"><div class="sbox"><span>🔍</span><input [(ngModel)]="q" (ngModelChange)="debounced()" placeholder="Search retailers, owner, mobile…" aria-label="Search retailers"></div></div>
    <div class="body pad">
      <app-state [loading]="loading()" [error]="err()" (retry)="load()">
        @for (o of list(); track o.id) {
          <button type="button" class="card p" style="margin-bottom:9px;width:100%;text-align:left;cursor:pointer" (click)="cur.set(o)">
            <div class="between"><div><b style="font-size:13px">{{ o.name }}</b> <span class="stars">{{ '★'.repeat(o.grade) }}</span><div class="tiny" style="margin-top:2px">{{ o.owner }} · {{ o.mobile }}</div></div><div class="lr-go">›</div></div>
            <div class="wrap mt8"><span class="chip xs c-grey">{{ o.beatName }}</span><span class="chip xs c-blue">Limit {{ o.creditLimit | inr }}</span><span class="chip xs c-purple">LM {{ o.lastMonthSales | inr }}</span>
              <span class="chip xs" [style.background]="perf(o).hex + '22'" [style.color]="perf(o).hex">{{ perf(o).label }}</span></div>
          </button>
        } @empty { <div class="empty">No retailers found.</div> }
        @if (total() > list().length) { <button class="btn ghost" type="button" (click)="more()">Load more</button> }
      </app-state>
    </div>
    <app-sheet [open]="!!cur()" (openChange)="!$event && cur.set(null)" [heading]="cur()?.name ?? ''" [subheading]="(cur()?.owner ?? '') + ' · ' + (cur()?.mobile ?? '')">
      @if (cur(); as o) {
        <div class="metrics mb12"><div><b style="font-size:14px">{{ o.outstanding | inr }}</b><span>Outstanding</span></div><div><b style="font-size:14px">{{ o.creditLimit | inr }}</b><span>Credit Limit</span></div><div><b style="font-size:14px">{{ o.lastMonthSales | inr }}</b><span>Last Month</span></div></div>
        <div class="muted mb12">{{ o.address.line }}, {{ o.address.city }}, {{ o.address.state }} {{ o.address.postalCode }}@if (o.gstin) { · GSTIN {{ o.gstin }} }</div>
        @if (!auth.isManager()) {
          <div class="btn-row"><button class="btn primary" type="button" (click)="order(o)">📦 Take Order</button><button class="btn ghost" type="button" (click)="go('/payment', o)">💰 Payment</button></div>
        } @else {
          <button class="btn ghost" type="button" (click)="cur.set(null); router.navigate(['/orders'], {})">View team orders</button>
        }
      }
    </app-sheet>`,
})
export class CustomersPage {
  auth = inject(AuthService);
  router = inject(Router);
  private api = inject(Api);
  private orders = inject(OrderStore);
  list = signal<Outlet[]>([]);
  total = signal(0);
  loading = signal(true);
  err = signal<string | null>(null);
  cur = signal<Outlet | null>(null);
  q = '';
  size = 30;
  private t?: ReturnType<typeof setTimeout>;
  perf = (o: Outlet) => PERF[o.performance];
  constructor() { this.load(); }
  private page = 1;
  debounced() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 300); }
  async more() {
    try {
      const r = await this.api.get<Paged<Outlet>>('/outlets', { search: this.q.trim(), sort: 'name', pageSize: this.size, page: this.page + 1 });
      this.page = r.page; this.list.set([...this.list(), ...r.items]); this.total.set(r.total);
    } catch (e) { this.err.set(errorMessage(e)); }
  }
  async load() {
    this.err.set(null);
    try { const r = await this.api.get<Paged<Outlet>>('/outlets', { search: this.q.trim(), sort: 'name', pageSize: this.size, page: 1 }); this.page = 1; this.list.set(r.items); this.total.set(r.total); }
    catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  order(o: Outlet) { this.cur.set(null); this.orders.start(o); this.router.navigateByUrl('/order'); }
  go(p: string, o: Outlet) { this.cur.set(null); this.router.navigate([p, o.id]); }
}

/* ── Products / SKU master ── */
@Component({
  selector: 'app-products',
  imports: [FormsModule, AppBar, StateView, InrPipe],
  host: { class: 'sc' },
  template: `
    <app-bar title="Products / SKU" sub="Master catalogue" />
    <div class="srch"><div class="sbox"><span>🔍</span><input [(ngModel)]="q" (ngModelChange)="debounced()" placeholder="Search products, colour, QR…" aria-label="Search products"></div></div>
    <div class="body pad">
      <app-state [loading]="loading()" [error]="err()" (retry)="load()">
        @for (p of list(); track p.id) {
          <div class="card p" style="margin-bottom:9px;display:flex;gap:11px;align-items:center">
            <div class="qaic" style="width:44px;height:44px;background:var(--g2)">{{ p.icon }}</div>
            <div style="flex:1;min-width:0"><div class="row" style="gap:6px"><b style="font-size:13px">{{ p.name }}</b>@if (p.scheme) { <span class="chip xs c-amber" [title]="p.scheme.text">🎁 {{ p.scheme.text }}</span> }</div>
              <div class="tiny">{{ p.brand }} · {{ p.subBrand }} · {{ p.qrCode }} · {{ p.colorCount }} colours · MOQ {{ p.moq }}</div>
              <div class="wrap mt8" style="gap:5px"><span class="chip xs c-green">FR {{ p.factoryRate | inr }}</span><span class="chip xs c-grey">MRP {{ p.mrp | inr }}</span>
                @if (p.hasSleeves) { <span class="chip xs c-blue">Half {{ p.halfRate | inr }}</span> }
                <span style="font-size:9px;font-weight:800" [style.color]="hex(p.stockBand.tone)">● {{ p.stockBand.label }}</span></div></div>
          </div>
        } @empty { <div class="empty">No products match.</div> }
      </app-state>
    </div>`,
})
export class ProductsPage {
  private api = inject(Api);
  list = signal<Product[]>([]);
  loading = signal(true);
  err = signal<string | null>(null);
  q = '';
  private t?: ReturnType<typeof setTimeout>;
  hex = (t: string) => STOCK_HEX[t];
  constructor() { this.load(); }
  debounced() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 300); }
  async load() {
    this.err.set(null);
    try { this.list.set(await this.api.get<Product[]>('/products', { search: this.q.trim() })); } catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
}
