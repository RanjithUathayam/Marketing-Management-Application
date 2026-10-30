import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { Product } from '../../core/models';
import { InrPipe, STOCK_HEX } from '../../core/format';
import { AppBar, StateView } from '../../shared/ui.components';
import { QrScanner } from '../../shared/qr-scanner';
import { SamplePadList } from '../samplepads/sample-pad-list';
import { OrderStore } from './order.store';

const TABS = ['All', 'Quick Pick', 'Frequently', 'Offer', 'New Launch', 'Must Selling', 'Sample Pad'];
const CATS = [{ cls: 'shirt', label: 'Shirt' }, { cls: 'trouser', label: 'Mens Trousers' }, { cls: 'fabric', label: 'Fabric' }];

@Component({
  selector: 'app-order-select',
  imports: [FormsModule, AppBar, StateView, InrPipe, QrScanner, SamplePadList],
  host: { class: 'sc' },
  template: `
    <app-bar title="Take Order" [sub]="store.outlet()?.name" fallback="/outlets">
      <div class="row" style="gap:7px">
        <button class="bico" type="button" (click)="scan.set(true)" aria-label="Scan product QR" title="Scan QR">▦</button>
        <button class="bico" type="button" (click)="next()" aria-label="Cart">🛒@if (store.selected().size) {<span class="badgepill">{{ store.selected().size }}</span>}</button>
      </div>
    </app-bar>
    <div class="loc-bar green"><span>📍</span><span class="loc-txt">{{ store.outlet()?.name }}, {{ store.outlet()?.area }}</span><span class="loc-dot"></span><span>{{ store.outlet()?.distanceKm !== null && store.outlet()?.distanceKm !== undefined ? store.outlet()?.distanceKm + ' km' : '' }}</span></div>
    @if (tab() !== 'Sample Pad') {
      <div class="srch"><div class="sbox"><span>🔍</span><input [(ngModel)]="search" (ngModelChange)="debounced()" placeholder="Search products, colour, brand…" aria-label="Search products"></div></div>
    }
    <div class="tabs" role="tablist">
      @for (t of tabs; track t) {
        <button type="button" role="tab" class="tab" [class.sp-tab]="t === 'Sample Pad'" [class.on]="tab() === t" [attr.aria-selected]="tab() === t" (click)="setTab(t)">{{ t }}
          @if (t === 'Frequently' && freqCount()) {<span class="tn">{{ freqCount() }}</span>}
          @if (t === 'Sample Pad' && padPending()) {<span class="tn" style="background:#ef4444">{{ padPending() }}</span>}</button>
      }
    </div>
    <div class="body"><div class="pad contain">
      @if (tab() === 'Sample Pad') {
        <app-sample-pad-list (changed)="padPending.set($event.pending)" />
      } @else if (tab() === 'Quick Pick') {
        <div style="font-size:10px;font-weight:800;color:var(--t2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Select Brand</div>
        <div class="wrap mb12">@for (b of brands(); track b) { <button type="button" class="pillbtn" [class.on]="qpBrand() === b" (click)="qpBrand.set(b); qpCat.set(null)">{{ b }}</button> }</div>
        @for (c of qpCats(); track c.cls) {
          <div class="card" style="margin-bottom:9px;overflow:hidden">
            <button type="button" class="lrow" [style.background]="qpCat() === c.cls ? 'var(--g2)' : ''" [attr.aria-expanded]="qpCat() === c.cls" (click)="qpCat.set(qpCat() === c.cls ? null : c.cls)">
              <div class="lr-main"><b>{{ c.label }} <span class="chip xs c-grey">{{ c.items.length }}</span></b></div><span class="lr-go">{{ qpCat() === c.cls ? '▴' : '▾' }}</span></button>
            @if (qpCat() === c.cls) {
              @for (p of c.items; track p.id) {
                <button type="button" class="lrow" (click)="quickPick(p)"><div class="qaic" style="width:38px;height:38px;background:var(--g2);font-size:19px">{{ p.icon }}</div>
                  <div class="lr-main"><b>{{ p.name }}</b><span>{{ c.label }}</span></div><span class="lr-go" style="color:var(--g)">›</span></button>
              }
            }
          </div>
        } @empty { <div class="empty">No products under {{ qpBrand() }} yet.</div> }
      } @else {
        <app-state [loading]="loading()" [error]="err()" (retry)="load()"><div class="card-grid">
          @for (p of products(); track p.id) {
            <button type="button" class="card p" style="margin-bottom:8px;display:flex;align-items:center;gap:11px;cursor:pointer;width:100%;text-align:left"
                    [style.border]="store.selected().has(p.id) ? '2px solid var(--g)' : '2px solid transparent'" [style.background]="store.selected().has(p.id) ? '#f0fbf7' : ''"
                    [attr.aria-pressed]="store.selected().has(p.id)" (click)="store.toggle(p.id)">
              <div class="qaic" style="width:46px;height:46px;background:var(--g2);position:relative">{{ p.icon }}
                <span style="position:absolute;bottom:-3px;right:-3px;width:12px;height:12px;border-radius:50%;border:2px solid #fff" [style.background]="hex(p.stockBand.tone)"></span></div>
              <div style="flex:1;min-width:0">
                <div class="row" style="gap:6px;flex-wrap:wrap"><b style="font-size:13px">{{ p.name }}</b>
                  @if (p.scheme) { <span class="chip xs c-amber" role="button" tabindex="0" (click)="$event.stopPropagation(); ui.toast('🎁 ' + p.name + ': ' + p.scheme.text)">🎁 OFFER</span> }
                  @if (p.tag === 'New Launch') { <span class="chip xs c-blue">NEW</span> }
                  @if (p.frequent) { <span class="chip xs c-amber">REPEAT</span> }
                  @if (p.nonReturnable) { <span class="chip xs c-red">Non-returnable</span> }</div>
                <div class="tiny" style="margin-top:3px">{{ p.brand }} · {{ p.subBrand }} · MOQ {{ p.moq }}</div>
                <div class="wrap" style="margin-top:5px;gap:5px"><span class="chip xs c-green">FR {{ p.factoryRate | inr }}</span><span class="chip xs c-grey">MRP {{ p.mrp | inr }}</span>
                  <span style="font-size:9px;font-weight:800" [style.color]="hex(p.stockBand.tone)">● {{ p.stockBand.label }}</span></div>
              </div>
              <div style="font-size:22px;color:var(--g);font-weight:700">{{ store.selected().has(p.id) ? '✓' : '+' }}</div>
            </button>
          } @empty { <div class="empty">No products match.</div> }
        </div></app-state>
      }
    </div></div>
    @if (tab() !== 'Sample Pad') {
      <div class="bbar">
        <div class="bb-info"><div class="bb-lbl">{{ store.selected().size ? 'Ready to enter quantities' : 'Tap products to select' }}</div>
          <div class="bb-amt" style="font-size:15px">{{ store.selected().size }} product{{ store.selected().size === 1 ? '' : 's' }}</div></div>
        <button class="btnp" type="button" [disabled]="!store.selected().size" (click)="next()">Enter Quantities →</button>
      </div>
    }
    @if (scan()) {
      <app-qr-scanner title="Scan Product QR" sub="Product / sample-pad QR codes" [check]="checkQr" [simulateValue]="all()[0]?.qrCode ?? null"
        (scanned)="onScan($event.text)" (closed)="scan.set(false)" />
    }`,
})
export class OrderSelectPage {
  store = inject(OrderStore);
  ui = inject(Ui);
  private api = inject(Api);
  private router = inject(Router);
  tabs = TABS;
  tab = signal('All');
  all = signal<Product[]>([]);
  products = signal<Product[]>([]);
  loading = signal(true);
  err = signal<string | null>(null);
  scan = signal(false);
  padPending = signal(0);
  search = '';
  qpBrand = signal('Ariser');
  qpCat = signal<string | null>(null);
  private t?: ReturnType<typeof setTimeout>;
  freqCount = computed(() => this.all().filter(p => p.frequent).length);
  brands = computed(() => [...new Set(['Ariser', ...this.all().map(p => p.brand)])]);
  qpCats = computed(() => CATS.map(c => ({ ...c, items: this.all().filter(p => p.brand === this.qpBrand() && p.category === c.cls) })).filter(c => c.items.length));
  hex = (t: string) => STOCK_HEX[t];
  checkQr = (text: string) => (this.all().some(p => p.qrCode === text) ? null : 'Not a product QR code');

  constructor() {
    if (!this.store.outlet()) { this.router.navigateByUrl('/outlets'); return; }
    this.api.get<Product[]>('/products').then(p => this.all.set(p)).catch(() => {});
    this.api.get<{ pending: number }>('/sample-pads').then(r => this.padPending.set(r.pending)).catch(() => {});
    this.load();
  }
  setTab(t: string) { this.tab.set(t); if (t !== 'Quick Pick' && t !== 'Sample Pad') this.load(); }
  debounced() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 250); }
  async load() {
    this.loading.set(true); this.err.set(null);
    try { this.products.set(await this.api.get<Product[]>('/products', { tab: this.tab(), search: this.search.trim() })); }
    catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  next() { if (this.store.selected().size) this.router.navigateByUrl('/order/matrix'); }
  quickPick(p: Product) { this.store.select(p.id); this.router.navigate(['/order/matrix'], { queryParams: { focus: p.id } }); }
  onScan(text: string) {
    this.scan.set(false);
    const p = this.all().find(x => x.qrCode === text);
    if (!p) return;
    this.store.select(p.id);
    this.ui.success(`✓ Scanned ${p.name} (${p.qrCode})`);
    this.router.navigate(['/order/matrix'], { queryParams: { focus: p.id } });
  }
}
