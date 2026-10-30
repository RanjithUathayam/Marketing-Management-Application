import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location, NgTemplateOutlet } from '@angular/common';
import { Api, errorMessage } from '../../core/api.service';
import { Geo } from '../../core/geo.service';
import { Ui } from '../../core/ui.service';
import { Beat } from '../../core/models';
import { AppBar } from '../../shared/ui.components';

/* GSTIN = 2-digit state code + 10-char PAN + entity no. + Z + checksum */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IN_STATES: [string, string][] = [['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh']];
const MAX = 5;

interface Photo { file: File; url: string }

@Component({
  selector: 'app-new-outlet',
  imports: [FormsModule, AppBar, NgTemplateOutlet],
  host: { class: 'sc' },
  template: `
    <app-bar title="New Outlet" [sub]="'Beat ' + (beatName() || '')" fallback="/outlets" />
    <div class="body pad narrow">
      <div class="card p mb12">
        <label class="photo-box" [class.done]="!!shop()">
          @if (shop(); as s) { <img [src]="s.url" alt="Shop front"> } @else { <div style="font-size:34px">🏪</div><div class="muted">Tap to capture shop front (full outlet visible)</div> }
          <input type="file" accept="image/*" capture="environment" hidden (change)="onShop($event)">
        </label>
        @if (errs()['shop']) { <div class="ferr">{{ errs()['shop'] }}</div> }
      </div>

      <div class="no-sec">Outlet Details</div>
      <div class="card p">
        <div class="fld"><label for="nb">Beat *</label><select id="nb" [(ngModel)]="f.beatId" (ngModelChange)="syncBeat()">@for (b of beats(); track b.id) { <option [ngValue]="b.id">{{ b.code }} · {{ b.name }}</option> }</select></div>
        <div class="fld"><label for="nn">Outlet Name *</label><input id="nn" [(ngModel)]="f.name" [class.err]="!!errs()['name']" maxlength="120" placeholder="Shop name"></div>
        <div class="fld"><label for="no">Owner Name *</label><input id="no" [(ngModel)]="f.owner" [class.err]="!!errs()['owner']" maxlength="100" placeholder="Owner"></div>
        <div class="fld"><label for="nm">Mobile *</label><input id="nm" [(ngModel)]="f.mobile" (ngModelChange)="f.mobile = digits($event)" [class.err]="!!errs()['mobile']" inputmode="numeric" maxlength="10" placeholder="10-digit mobile"></div>
        <div class="fld" style="margin-bottom:0"><label for="nt">Outlet Type</label><select id="nt" [(ngModel)]="f.type"><option>Retailer</option><option>Wholesaler</option><option>Modern Trade</option></select></div>
      </div>

      <div class="no-sec">Tax &amp; KYC Details</div>
      <div class="card p">
        <div class="fld"><label for="ng">GSTIN</label>
          <input id="ng" [(ngModel)]="f.gstin" (ngModelChange)="onGstin($event)" [class.err]="gstinHint().bad" maxlength="15" placeholder="e.g. 29ABCDE1234F1Z5" autocapitalize="characters">
          <div class="fhint" [class.bad]="gstinHint().bad" [class.ok]="gstinHint().ok">{{ gstinHint().text }}</div></div>
        <ng-container *ngTemplateOutlet="photos; context: { k: 'gst', label: 'GSTIN Certificate Photos' }" />
        <div class="no-div"></div>
        <div class="fld"><label for="np">PAN Card Number</label>
          <input id="np" [(ngModel)]="f.pan" (ngModelChange)="onPan($event)" [class.err]="panHint().bad" maxlength="10" placeholder="e.g. ABCDE1234F" autocapitalize="characters">
          <div class="fhint" [class.bad]="panHint().bad" [class.ok]="panHint().ok">{{ panHint().text }}</div></div>
        <ng-container *ngTemplateOutlet="photos; context: { k: 'pan', label: 'PAN Card Photos' }" />
      </div>

      <div class="no-sec">Address Information</div>
      <div class="card p">
        <div class="fld"><label for="nbl">Building</label><input id="nbl" [(ngModel)]="f.building" maxlength="150" placeholder="Shop no. / building name / floor"></div>
        <div class="fld"><label for="nc">City *</label><input id="nc" [(ngModel)]="f.city" [class.err]="!!errs()['city']" maxlength="80"></div>
        <div class="fld"><label for="na">Address *</label><textarea id="na" rows="2" [(ngModel)]="f.address" [class.err]="!!errs()['address']" maxlength="300" placeholder="Street, area, landmark"></textarea></div>
        <div class="no-2col">
          <div class="fld"><label for="nd">District</label><input id="nd" [(ngModel)]="f.district" maxlength="80"></div>
          <div class="fld"><label for="npc">Postal Code *</label><input id="npc" [(ngModel)]="f.postalCode" (ngModelChange)="f.postalCode = digits($event)" [class.err]="!!errs()['postalCode']" inputmode="numeric" maxlength="6"></div>
        </div>
        <div class="fld"><label for="ns">State *</label><select id="ns" [(ngModel)]="f.state">@for (s of states; track s[0]) { <option [value]="s[1]">{{ s[1] }}</option> }</select></div>
        <div class="fld" style="margin-bottom:0"><label for="gps">GPS Location (auto-captured)</label>
          <div class="row" style="gap:8px"><input id="gps" [value]="gpsText()" readonly style="flex:1" [class.err]="!!errs()['gps']"><button class="pillbtn on" type="button" (click)="captureGps()" aria-label="Re-capture GPS">📍</button></div></div>
      </div>
      <div class="tiny center" style="margin:12px 0">New outlets require manager approval before order taking.</div>
    </div>
    <div class="bbar"><button class="btnp" type="button" [disabled]="busy()" (click)="submit()">Submit for Approval →</button></div>

    <ng-template #photos let-k="k" let-label="label">
      <div class="fld">
        <label>{{ label }} <span class="kyc-count">{{ list(k).length }}/{{ max }}</span></label>
        <div class="kyc-grid">
          @for (p of list(k); track p.url; let i = $index) {
            <div class="kyc-th"><img [src]="p.url" [alt]="label + ' ' + (i + 1)"><button class="kyc-x" type="button" [attr.aria-label]="'Remove photo ' + (i + 1)" (click)="remove(k, i)">×</button><em>{{ i + 1 }}</em></div>
          }
          @if (list(k).length < max) {
            <label class="kyc-add"><span>📷</span><b>Capture</b><input type="file" accept="image/*" capture="environment" multiple hidden (change)="add(k, $event)"></label>
          }
        </div>
        <div class="fhint">Up to {{ max }} images · camera or gallery</div>
      </div>
    </ng-template>`,
})
export class NewOutletPage implements OnDestroy {
  private api = inject(Api);
  private ui = inject(Ui);
  private geo = inject(Geo);
  private location = inject(Location);
  states = IN_STATES;
  max = MAX;
  beats = signal<Beat[]>([]);
  beatName = signal('');
  shop = signal<Photo | null>(null);
  gst = signal<Photo[]>([]);
  pan = signal<Photo[]>([]);
  errs = signal<Record<string, string>>({});
  busy = signal(false);
  gstinHint = signal({ text: '15 characters · leave blank if the outlet is unregistered', bad: false, ok: false });
  panHint = signal({ text: '10 characters · auto-filled from GSTIN', bad: false, ok: false });
  gpsText = signal('Capturing…');
  f = { beatId: 0, name: '', owner: '', mobile: '', type: 'Retailer', gstin: '', pan: '', building: '', city: 'Bengaluru', address: '',
        district: 'Bengaluru Urban', postalCode: '', state: 'Karnataka', lat: null as number | null, lng: null as number | null };
  digits = (v: string) => (v ?? '').replace(/\D/g, '');
  list = (k: string) => (k === 'gst' ? this.gst() : this.pan());

  constructor() {
    this.api.get<Beat[]>('/beats').then(b => { this.beats.set(b); if (b[0]) { this.f.beatId = b[0].id; this.syncBeat(); } }).catch(e => this.ui.error(errorMessage(e)));
    this.captureGps();
  }
  ngOnDestroy() { [this.shop(), ...this.gst(), ...this.pan()].forEach(p => p && URL.revokeObjectURL(p.url)); }
  syncBeat() { this.beatName.set(this.beats().find(b => b.id === this.f.beatId)?.name ?? ''); }

  async captureGps() {
    this.gpsText.set('Capturing…');
    const p = await this.geo.current();
    if (p) { this.f.lat = p.lat; this.f.lng = p.lng; this.gpsText.set(`${p.lat}, ${p.lng}`); }
    else this.gpsText.set('Location unavailable — allow location access and tap 📍');
  }
  onShop(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const old = this.shop(); if (old) URL.revokeObjectURL(old.url);
    this.shop.set({ file, url: URL.createObjectURL(file) });
  }
  add(k: string, ev: Event) {
    const inp = ev.target as HTMLInputElement, sig = k === 'gst' ? this.gst : this.pan;
    const files = [...(inp.files ?? [])].filter(f => f.type.startsWith('image/'));
    const room = MAX - sig().length;
    if (files.length > room) this.ui.error(`Only ${MAX} ${k === 'gst' ? 'GSTIN' : 'PAN'} images allowed`);
    sig.set([...sig(), ...files.slice(0, room).map(file => ({ file, url: URL.createObjectURL(file) }))]);
    inp.value = '';
  }
  remove(k: string, i: number) {
    const sig = k === 'gst' ? this.gst : this.pan;
    URL.revokeObjectURL(sig()[i].url);
    sig.set(sig().filter((_, j) => j !== i));
  }
  onGstin(v: string) {
    this.f.gstin = (v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    const g = this.f.gstin;
    if (!g) return this.gstinHint.set({ text: '15 characters · leave blank if the outlet is unregistered', bad: false, ok: false });
    if (g.length < 15) return this.gstinHint.set({ text: `${g.length}/15 characters`, bad: false, ok: false });
    if (!GSTIN_RE.test(g)) return this.gstinHint.set({ text: 'Invalid GSTIN format', bad: true, ok: false });
    const st = IN_STATES.find(([c]) => c === g.slice(0, 2));
    if (!this.f.pan) this.onPan(g.slice(2, 12));
    if (st) this.f.state = st[1];
    this.gstinHint.set({ text: `✓ Valid GSTIN${st ? ' · ' + st[1] : ''} · PAN auto-filled`, bad: false, ok: true });
    this.onPan(this.f.pan);
  }
  onPan(v: string) {
    this.f.pan = (v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    const p = this.f.pan;
    if (!p) return this.panHint.set({ text: '10 characters · auto-filled from GSTIN', bad: false, ok: false });
    if (p.length < 10) return this.panHint.set({ text: `${p.length}/10 characters`, bad: false, ok: false });
    if (!PAN_RE.test(p)) return this.panHint.set({ text: 'Invalid PAN format (AAAAA9999A)', bad: true, ok: false });
    if (this.f.gstin.length === 15 && this.f.gstin.slice(2, 12) !== p) return this.panHint.set({ text: 'PAN does not match the GSTIN', bad: true, ok: false });
    this.panHint.set({ text: '✓ Valid PAN', bad: false, ok: true });
  }

  private validate() {
    const e: Record<string, string> = {}, f = this.f;
    if (!this.shop()) e['shop'] = 'Capture the shop front photo';
    if (f.name.trim().length < 2) e['name'] = 'Outlet name';
    if (f.owner.trim().length < 2) e['owner'] = 'Owner name';
    if (!/^[6-9]\d{9}$/.test(f.mobile)) e['mobile'] = '10-digit mobile';
    if (f.address.trim().length < 5) e['address'] = 'Address';
    if (f.city.trim().length < 2) e['city'] = 'City';
    if (!/^\d{6}$/.test(f.postalCode)) e['postalCode'] = '6-digit postal code';
    if (f.lat === null) e['gps'] = 'GPS location';
    if (f.gstin && !GSTIN_RE.test(f.gstin)) e['gstin'] = 'valid GSTIN';
    if (f.gstin && !this.gst().length) e['gstPhotos'] = 'at least 1 GSTIN photo';
    if (f.pan && !PAN_RE.test(f.pan)) e['pan'] = 'valid PAN';
    if (f.pan && !this.pan().length) e['panPhotos'] = 'at least 1 PAN photo';
    this.errs.set(e);
    return Object.values(e);
  }
  async submit() {
    const errs = this.validate();
    if (errs.length) { this.ui.error('⚠ Please add: ' + errs.slice(0, 3).join(', ') + (errs.length > 3 ? '…' : '')); return; }
    const f = this.f, fd = new FormData();
    const fields: Record<string, string | number> = { beatId: f.beatId, name: f.name.trim(), owner: f.owner.trim(), mobile: f.mobile, type: f.type,
      gstin: f.gstin, pan: f.pan, building: f.building.trim(), address: f.address.trim(), city: f.city.trim(), district: f.district.trim(),
      postalCode: f.postalCode, state: f.state, lat: f.lat!, lng: f.lng! };
    Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)));
    fd.append('shopPhoto', this.shop()!.file);
    this.gst().forEach(p => fd.append('gstinPhotos', p.file));
    this.pan().forEach(p => fd.append('panPhotos', p.file));
    this.busy.set(true);
    try {
      const r = await this.api.upload<{ status: string }>('/outlets', fd);
      this.ui.success(r.status === 'APPROVED' ? '✅ Outlet created' : '📤 Outlet sent for approval');
      this.location.back();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
