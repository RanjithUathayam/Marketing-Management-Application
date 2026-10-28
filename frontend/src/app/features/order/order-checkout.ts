import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Geo } from '../../core/geo.service';
import { Ui } from '../../core/ui.service';
import { Order, OrderList, Quote } from '../../core/models';
import { InrPipe, fmtD, money, todayIso } from '../../core/format';
import { AppBar, SignaturePad, StateView, StatusPill } from '../../shared/ui.components';
import { OrderStore } from './order.store';

/* ── Summary ── */
@Component({
  selector: 'app-order-summary',
  imports: [FormsModule, AppBar, StateView, InrPipe, SignaturePad],
  host: { class: 'sc' },
  template: `
    <app-bar title="Order Summary" [sub]="store.outlet()?.name" fallback="/order/matrix" />
    <div class="loc-bar green"><span>📍</span><span class="loc-txt">{{ store.outlet()?.name }}, {{ store.outlet()?.area }}</span><span class="loc-dot"></span></div>
    <div class="body pad">
      <app-state [loading]="!q() && !err()" [error]="err()" (retry)="load()">
        @if (q(); as q) {
          @if (q.credit.exceeds) {
            <div class="card p mb12" style="border-left:3px solid var(--r);background:#fff5f5"><b style="color:var(--r);font-size:12px">⚠ Credit limit exceeded</b>
              <div class="muted" style="margin-top:3px">Order + outstanding ({{ q.credit.outstanding + q.totalAmount | inr }}) exceeds limit {{ q.credit.creditLimit | inr }}. The order will be held for manager approval.</div></div>
          }
          <div class="card p">
            @for (p of q.products; track p.productId) {
              <div class="between" style="padding:10px 0;border-bottom:1px solid var(--brd)">
                <div><b style="font-size:13px">{{ p.productName }}</b><div class="tiny">{{ p.qty }} pc · {{ colorCount(p.productId) }} colour(s)@if (p.freeQty) { · 🎁 +{{ p.freeQty }} free }</div></div>
                <b style="font-size:13px">{{ p.amount | inr }}</b></div>
            }
            <div class="between" style="padding-top:11px"><span class="muted">Subtotal (dealer price)</span><b>{{ q.subTotal | inr }}</b></div>
            <div class="between" style="padding-top:6px"><span class="muted">MRP value</span><span class="tiny">{{ q.mrpValue | inr }}</span></div>
            <div class="between" style="padding-top:6px"><span class="muted">Scheme benefit (free goods)</span><b style="color:var(--g)">{{ q.schemeValue | inr }}</b></div>
            <div class="between" style="padding-top:6px"><span class="muted">Tax (5%)</span><span>{{ q.taxAmount | inr }}</span></div>
            <div class="between" style="padding-top:10px;margin-top:5px;border-top:2px solid var(--brd);font-size:16px;font-weight:800"><span>Total</span><span>{{ q.totalAmount | inr }}</span></div>
          </div>
          <div class="sec-title">Payment Terms</div>
          <div class="card p">
            <div class="seg">@for (t of terms; track t[0]) { <button type="button" [class.on]="store.state().terms === t[0]" (click)="setTerms(t[0])">{{ t[1] }}</button> }</div>
            <div class="fld mt12" style="margin-bottom:0"><label for="si">Special Instructions</label>
              <textarea id="si" [ngModel]="store.state().instructions" (ngModelChange)="store.setInstructions($event)" maxlength="500" placeholder="Optional…"></textarea></div>
          </div>
          <div class="sec-title">Customer Signature</div>
          <div class="card p"><app-signature (changed)="store.signature = $event; signed.set(!!$event)" />
            @if (!signed()) { <div class="tiny mt8">Ask the outlet owner to sign above to confirm the order.</div> }</div>
        }
      </app-state>
    </div>
    <div class="bbar"><div class="bb-info"><div class="bb-lbl">Order Total</div><div class="bb-amt">{{ (q()?.totalAmount ?? 0) | inr }}</div></div>
      <button class="btns" type="button" (click)="router.navigateByUrl('/order/matrix')">Edit</button>
      <button class="btnp" type="button" [disabled]="!q()" (click)="next()">Continue →</button></div>`,
})
export class OrderSummaryPage {
  store = inject(OrderStore);
  router = inject(Router);
  private ui = inject(Ui);
  q = signal<Quote | null>(null);
  err = signal<string | null>(null);
  signed = signal(false);
  terms: ['CREDIT' | 'CASH' | 'ONLINE', string][] = [['CREDIT', 'Credit'], ['CASH', 'Cash'], ['ONLINE', 'Online']];
  constructor() {
    if (!this.store.outlet() || !this.store.lines().length) { this.router.navigateByUrl(this.store.outlet() ? '/order/matrix' : '/outlets'); return; }
    this.store.signature = '';
    this.load();
  }
  colorCount = (pid: number) => new Set(this.store.lines().filter(l => l.productId === pid).map(l => l.colorId)).size;
  async load() {
    this.err.set(null);
    try { this.q.set(await this.store.fetchQuote()); } catch (e) { this.err.set(errorMessage(e)); }
  }
  setTerms(t: 'CREDIT' | 'CASH' | 'ONLINE') { this.store.setTerms(t); this.q.set(null); this.load(); }
  next() {
    if (!this.signed()) { this.ui.error('✍ Customer signature is required'); return; }
    this.router.navigateByUrl('/order/transport');
  }
}

/* ── Transport ── */
@Component({
  selector: 'app-order-transport',
  imports: [FormsModule, AppBar],
  host: { class: 'sc' },
  template: `
    <app-bar title="Transport Details" [sub]="store.outlet()?.name" fallback="/order/summary" />
    <div class="body pad">
      <div class="card p">
        <div style="font-size:13px;font-weight:800;margin-bottom:12px">🚚 Transport Info</div>
        @if (last(); as l) {
          <div class="card p mb12" style="background:var(--g2);border-color:var(--g3)"><div class="between">
            <div><b style="font-size:12px;color:var(--g)">Same as last visit?</b><div class="tiny">{{ l.mode }} · {{ l.transporter }} · {{ l.destination }}</div></div>
            <button class="pillbtn" type="button" [class.on]="useLast()" (click)="applyLast()">{{ useLast() ? '✓ Confirmed' : 'Use this ✓' }}</button></div></div>
        }
        <div class="fld"><label for="tm">Transport Mode *</label>
          <select id="tm" [ngModel]="t().mode" (ngModelChange)="set({ mode: $event })" [disabled]="useLast()"><option>Lorry</option><option>Van</option><option>Bus</option></select></div>
        <div class="fld"><label for="tn">Transporter Name *</label><input id="tn" [ngModel]="t().transporter" (ngModelChange)="set({ transporter: $event })" [readonly]="useLast()" maxlength="80" placeholder="Enter name…"></div>
        <div class="fld"><label for="td">Destination *</label><input id="td" [ngModel]="t().destination" (ngModelChange)="set({ destination: $event })" [readonly]="useLast()" maxlength="120" placeholder="Enter destination…"></div>
        <div class="fld" style="margin-bottom:0;padding-top:12px;border-top:1px dashed var(--brd2)"><label>Delivery Date *</label>
          <div class="seg"><button type="button" [class.on]="t().immediate" (click)="set({ immediate: true })">⚡ Immediate</button><button type="button" [class.on]="!t().immediate" (click)="set({ immediate: false })">📅 Custom</button></div>
          @if (!t().immediate) { <input class="mt8" type="date" [min]="today" [ngModel]="t().deliveryDate" (ngModelChange)="set({ deliveryDate: $event })" aria-label="Delivery date"> }
          <div class="fhint ok">{{ t().immediate ? '⚡ Deliver today · ' + fmtD(today, true) : '📅 Deliver on ' + fmtD(t().deliveryDate, true) }}</div>
        </div>
      </div>
    </div>
    <div class="bbar"><button class="btns" type="button" (click)="router.navigateByUrl('/order/summary')">Back</button>
      <button class="btnp" type="button" [disabled]="busy()" (click)="place()">{{ busy() ? 'Placing…' : 'Place Order →' }}</button></div>`,
})
export class OrderTransportPage {
  store = inject(OrderStore);
  router = inject(Router);
  private api = inject(Api);
  private ui = inject(Ui);
  private geo = inject(Geo);
  today = todayIso();
  fmtD = fmtD;
  busy = signal(false);
  useLast = signal(false);
  last = signal<{ mode: string; transporter: string; destination: string } | null>(null);
  t = () => this.store.state().transport;
  constructor() {
    if (!this.store.outlet() || !this.store.signature) { this.router.navigateByUrl('/order/summary'); return; }
    this.api.get<OrderList>('/orders', { outletId: this.store.outlet()!.id, pageSize: 1 })
      .then(r => { const o = r.items[0]; if (o?.transport.transporter) this.last.set(o.transport); }).catch(() => {});
  }
  set(p: Partial<ReturnType<OrderStore['state']>['transport']>) { this.store.setTransport(p); }
  applyLast() {
    const l = this.last()!;
    if (this.useLast()) { this.useLast.set(false); return; }
    this.store.setTransport({ mode: l.mode as 'Lorry', transporter: l.transporter, destination: l.destination });
    this.useLast.set(true);
  }
  async place() {
    const t = this.t();
    if (!t.transporter.trim() || !t.destination.trim()) { this.ui.error('Enter transporter and destination'); return; }
    if (!t.immediate && (!t.deliveryDate || t.deliveryDate < this.today)) { this.ui.error('Pick a delivery date from today onwards'); return; }
    this.busy.set(true);
    try {
      const pos = await this.geo.current(5000);
      const o = await this.store.place(pos?.lat, pos?.lng);
      this.router.navigate(['/order/success', o.id], { replaceUrl: true });
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}

/* ── Success ── */
@Component({
  selector: 'app-order-success',
  imports: [AppBar, StateView, InrPipe, StatusPill],
  host: { class: 'sc' },
  template: `
    <app-bar title="Order Placed" [back]="false" />
    <div class="body" style="display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:24px">
      <app-state [loading]="!o()">
        @if (o(); as o) {
          <div style="width:92px;height:92px;border-radius:50%;background:linear-gradient(135deg,#0d6e50,#10a070);color:#fff;display:flex;align-items:center;justify-content:center;font-size:44px;margin:0 auto 16px;box-shadow:0 10px 30px rgba(13,110,80,.35)">✓</div>
          @if (elapsed()) { <div class="chip c-green mb12"><span class="d"></span>⚡ Completed in {{ elapsed() }}</div> }
          <div style="font-size:22px;font-weight:800">Order Placed!</div>
          <div class="muted" style="margin:6px 0 16px">Confirmed for <b>{{ o.outletName }}</b></div>
          @if (o.creditHold) { <div class="pc-alert" style="text-align:left">⚠ <span>Held for manager approval — the outlet's credit limit is exceeded.</span></div> }
          <div class="card p" style="width:100%;text-align:left">
            <div class="between" style="margin-bottom:9px"><span class="muted">Order #</span><b>{{ o.orderNo }}</b></div>
            <div class="between" style="margin-bottom:9px"><span class="muted">Total Amount</span><b style="color:var(--g)">{{ o.totalAmount | inr }}</b></div>
            <div class="between" style="margin-bottom:9px"><span class="muted">Products</span><b>{{ o.productCount }} · {{ o.totalPieces }} pc</b></div>
            <div class="between" style="margin-bottom:9px"><span class="muted">Transport</span><b>{{ o.transport.mode }} · {{ o.transport.transporter }}</b></div>
            <div class="between"><span class="muted">Status</span><app-status-pill [status]="o.status" [sm]="true" /></div>
          </div>
          <a class="btn ghost mt14" [href]="waLink(o)" target="_blank" rel="noopener">📲 Share to Customer WhatsApp</a>
          <button class="btn ghost mt8" type="button" (click)="done('/orders/' + o.id)">📋 Track in Order Status</button>
          <button class="btn primary mt8" type="button" (click)="done('/home')">← Back to Dashboard</button>
        }
      </app-state>
    </div>`,
})
export class OrderSuccessPage {
  id = input.required<string>();
  private api = inject(Api);
  private router = inject(Router);
  private store = inject(OrderStore);
  o = signal<Order | null>(null);
  elapsed = signal('');
  constructor() {
    queueMicrotask(async () => {
      try {
        const o = await this.api.get<Order>(`/orders/${this.id()}`);
        this.o.set(o);
        const started = Number(sessionStorage.getItem('mma.orderStart') || 0);
        if (started) { const s = Math.round((Date.now() - started) / 1000); this.elapsed.set(`${Math.floor(s / 60)} min ${s % 60} sec`); }
        this.store.reset();
        sessionStorage.removeItem('mma.orderStart');
      } catch { this.router.navigateByUrl('/orders'); }
    });
  }
  waLink(o: Order) {
    const outlet = this.store.outlet();
    const text = `Order ${o.orderNo} confirmed for ${o.outletName}: ${o.totalPieces} pcs, total ${money(o.totalAmount)}. Delivery: ${o.transport.deliveryDate}. Thank you!`;
    return `https://wa.me/${outlet?.mobile ? '91' + outlet.mobile : ''}?text=${encodeURIComponent(text)}`;
  }
  done(url: string) { this.router.navigateByUrl(url); }
}
