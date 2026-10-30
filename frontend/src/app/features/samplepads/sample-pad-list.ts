import { Component, computed, inject, output, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { MySamplePads, SamplePad } from '../../core/models';
import { DPipe, DtPipe, initials } from '../../core/format';
import { QrImage, Sheet, StateView } from '../../shared/ui.components';
import { QrScanner } from '../../shared/qr-scanner';

const QRI = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="10" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="1" y="10" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M10 10h2v2h-2zM13 13h2v2h-2zM13 10h2v2h-2zM10 13h2v2h-2z" fill="currentColor"/></svg>`;

/** The executive's own sample pads grouped by DC, with QR sheet and scan-to-acknowledge. */
@Component({
  selector: 'app-sample-pad-list',
  imports: [Sheet, StateView, QrImage, QrScanner, DPipe, DtPipe],
  template: `
    <app-state [loading]="!data() && !err()" [error]="err()" (retry)="load()">
      @if (data(); as d) {
        <div class="spx-head">
          <div class="row"><div class="spx-av">{{ ini(d.employee.name) }}</div>
            <div style="flex:1;min-width:0"><b style="font-size:13.5px">{{ d.employee.name }}</b><div style="font-size:10.5px;font-weight:700;color:var(--ix1)">Employee ID {{ d.employee.empCode }}</div></div>
            <div style="text-align:right;line-height:1"><b style="font-size:20px;color:var(--ixd)">{{ d.acknowledged }}/{{ d.issued }}</b><div style="font-size:9.5px;font-weight:700;color:#6366f1;margin-top:4px">acknowledged</div></div></div>
          <div class="spx-prog"><i [style.width.%]="d.issued ? (d.acknowledged / d.issued) * 100 : 0"></i></div>
        </div>
        <div class="spx-seg" role="tablist" aria-label="Filter sample pads">
          @for (f of filters; track f[0]) {
            <button type="button" role="tab" [class.on]="filter() === f[0]" [attr.aria-selected]="filter() === f[0]" (click)="filter.set(f[0])">{{ f[1] }}<em>{{ count(f[0]) }}</em></button>
          }
        </div>
        <div class="card-grid cols-2">
        @for (dc of dcs(); track dc.dcNo) {
          <div class="card spx-dc">
            <div class="spx-dc-hd"><div class="spx-k">DC Number</div><div class="spx-k r">DC Date</div><div class="spx-v">{{ dc.dcNo }}</div><div class="spx-v r">{{ dc.dcDate | d: true }}</div></div>
            @for (it of dc.items; track it.id) {
              <div class="spx-item" [class.flash]="it.id === flashId()">
                <div style="flex:1;min-width:0">
                  <button type="button" class="spx-pname" (click)="openQr(it)"><span [innerHTML]="qri"></span>{{ it.name }}</button>
                  <div class="tiny" style="margin-top:3px;font-weight:600">{{ it.subgroup }} · Qty {{ it.qty }}</div>
                </div>
                @if (it.ackAt) { <div class="spx-tag ack">✓ Acknowledged<small>{{ it.ackAt | dt }}</small></div> } @else { <div class="spx-tag pen">Pending</div> }
              </div>
            }
          </div>
        } @empty {
          <div class="card empty">{{ !d.issued ? 'No sample pads have been issued to you yet.' : filter() === 'pen' ? 'All your sample pads are acknowledged. 🎉' : 'Nothing acknowledged yet.' }}</div>
        }
        </div>
        @if (d.issued) { <div class="tiny center" style="padding:12px 10px 4px;line-height:1.5;font-weight:600">Tap a pad's name to show its QR, then scan it to acknowledge receipt.</div> }
      }
    </app-state>

    <app-sheet [(open)]="qrOpen">
      @if (cur(); as r) {
        <div class="spx-sh-hd"><b>{{ r.name }}</b><span>{{ r.subgroup }} · Qty {{ r.qty }}</span></div>
        <div class="spx-dl"><div><div class="spx-k">DC Number</div><div class="spx-v">{{ r.dcNo }}</div></div><div><div class="spx-k">DC Date</div><div class="spx-v">{{ r.dcDate | d: true }}</div></div></div>
        <div class="spx-qr"><div class="spx-qr-box" [class.done]="!!r.ackAt"><app-qr [text]="r.qr" /></div><div class="tiny" style="font-weight:700">{{ r.qr }}</div></div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          @if (r.ackAt) { <div class="spx-done">✓ Acknowledged on {{ r.ackAt | dt }} · {{ r.ackVia === 'PHOTO_SCAN' ? 'Photo scan' : 'QR scan' }}</div> }
          @else { <button class="btn indigo" type="button" (click)="startScan()">📷 Scan QR to Acknowledge</button> }
        </div>
      }
    </app-sheet>

    @if (scanning(); as r) {
      <app-qr-scanner title="Scan Sample Pad QR" [sub]="r.name + ' · ' + r.dcNo" [check]="checker" [simulateValue]="r.qr"
        (scanned)="acknowledge(r, $event)" (closed)="scanning.set(null)" />
    }`,
})
export class SamplePadList {
  changed = output<MySamplePads>();
  private api = inject(Api);
  private ui = inject(Ui);
  data = signal<MySamplePads | null>(null);
  err = signal<string | null>(null);
  filter = signal<'all' | 'pen' | 'ack'>('all');
  qrOpen = signal(false);
  cur = signal<SamplePad | null>(null);
  scanning = signal<SamplePad | null>(null);
  flashId = signal<number | null>(null);
  filters: ['all' | 'pen' | 'ack', string][] = [['all', 'All'], ['pen', 'Pending'], ['ack', 'Acknowledged']];
  qri = inject(DomSanitizer).bypassSecurityTrustHtml(QRI);   // static icon markup
  ini = initials;
  dcs = computed(() => (this.data()?.dcs ?? []).map(dc => ({
    ...dc, items: dc.items.filter(i => this.filter() === 'all' || (this.filter() === 'ack') === !!i.ackAt),
  })).filter(dc => dc.items.length));
  count = (f: string) => { const d = this.data(); return !d ? 0 : f === 'all' ? d.issued : f === 'ack' ? d.acknowledged : d.pending; };

  /** Only the QR of the selected pad is accepted. */
  checker = (text: string) => {
    const r = this.scanning();
    if (!r || text === r.qr) return null;
    return text.startsWith('SP|') ? 'This QR belongs to a different sample pad' : 'Not a sample pad QR';
  };

  constructor() { this.load(); }
  async load() {
    this.err.set(null);
    try { const d = await this.api.get<MySamplePads>('/sample-pads'); this.data.set(d); this.changed.emit(d); }
    catch (e) { this.err.set(errorMessage(e)); }
  }
  openQr(r: SamplePad) { this.cur.set(r); this.qrOpen.set(true); }
  startScan() { this.scanning.set(this.cur()); this.qrOpen.set(false); }
  async acknowledge(r: SamplePad, ev: { text: string; via: 'QR_SCAN' | 'PHOTO_SCAN' }) {
    this.scanning.set(null);
    try {
      await this.api.post(`/sample-pads/${r.id}/acknowledge`, { code: ev.text, via: ev.via });
      this.ui.success(`✅ Acknowledged · ${r.name}`);
      this.flashId.set(r.id);
      setTimeout(() => this.flashId.set(null), 1600);
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
  }
}
