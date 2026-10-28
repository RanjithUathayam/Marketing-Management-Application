import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Geo } from '../../core/geo.service';
import { Ui } from '../../core/ui.service';
import { WorkLog } from '../../core/models';
import { TimePipe, initials } from '../../core/format';
import { AppBar, Sheet, StateView } from '../../shared/ui.components';

const WORK_TYPES = [
  { k: 'retailer', ic: '🏪', lbl: 'Retailer Visit', sub: 'Beat outlets · order taking' },
  { k: 'joined', ic: '🤝', lbl: 'Joined Work', sub: 'Accompany an executive' },
  { k: 'distributor', ic: '🏭', lbl: 'Distributor Visit', sub: 'Check-in / check-out' },
  { k: 'office', ic: '🏢', lbl: 'Office Visit', sub: 'Check-in / check-out' },
  { k: 'meeting', ic: '👥', lbl: 'Meeting', sub: 'Log a meeting' },
];

@Component({
  selector: 'app-work',
  imports: [FormsModule, AppBar, Sheet],
  host: { class: 'sc' },
  template: `
    <app-bar title="Select Work Type" sub="What are you doing today?" [back]="false" />
    <div class="body pad">
      @for (w of types; track w.k) {
        <button type="button" class="card p" style="margin-bottom:10px;display:flex;align-items:center;gap:13px;cursor:pointer;width:100%;text-align:left" (click)="pick(w.k)">
          <div class="qaic" style="background:var(--g2);width:46px;height:46px">{{ w.ic }}</div>
          <div style="flex:1"><b style="font-size:14px">{{ w.lbl }}</b><div class="muted">{{ w.sub }}</div></div>
          <div class="lr-go">›</div>
        </button>
      }
    </div>

    <app-sheet [(open)]="joinOpen" heading="Joined Work" subheading="Select the executive to accompany">
      @for (c of colleagues(); track c.id) {
        <button type="button" class="lrow" (click)="join(c)">
          <div class="av" style="background:var(--purple)">{{ ini(c.name) }}</div>
          <div class="lr-main"><b>{{ c.name }}</b><span>{{ c.empCode }} · {{ c.territory }} · {{ c.outlets }} outlets</span></div><div class="lr-go">›</div>
        </button>
      } @empty { <div class="empty">No colleagues available.</div> }
    </app-sheet>

    <app-sheet [(open)]="meetOpen" heading="Log Meeting">
      <div class="fld"><label for="mw">With</label><input id="mw" [(ngModel)]="meetWith" placeholder="Person / company" maxlength="150"></div>
      <div class="fld"><label for="mn">Notes</label><textarea id="mn" [(ngModel)]="meetNotes" maxlength="1000"></textarea></div>
      <button class="btn primary" type="button" [disabled]="busy()" (click)="saveMeeting()">Save Meeting</button>
    </app-sheet>`,
})
export class WorkPage {
  private api = inject(Api);
  private ui = inject(Ui);
  private geo = inject(Geo);
  private router = inject(Router);
  types = WORK_TYPES;
  joinOpen = signal(false);
  meetOpen = signal(false);
  busy = signal(false);
  colleagues = signal<{ id: number; name: string; empCode: string; territory: string; outlets: number }[]>([]);
  meetWith = '';
  meetNotes = '';
  ini = initials;

  async pick(k: string) {
    if (k === 'retailer') this.router.navigateByUrl('/outlets');
    else if (k === 'distributor' || k === 'office') this.router.navigate(['/work/check', k]);
    else if (k === 'meeting') this.meetOpen.set(true);
    else {
      this.joinOpen.set(true);
      try { this.colleagues.set(await this.api.get('/work-logs/colleagues')); } catch (e) { this.ui.error(errorMessage(e)); }
    }
  }
  async join(c: { id: number; name: string }) {
    try {
      const pos = await this.geo.current(4000);
      await this.api.post('/work-logs', { type: 'JOINED', joinedUserId: c.id, place: c.name, lat: pos?.lat, lng: pos?.lng });
      this.joinOpen.set(false);
      this.ui.success(`🤝 Joined work with ${c.name} logged`);
    } catch (e) { this.ui.error(errorMessage(e)); }
  }
  async saveMeeting() {
    if (!this.meetWith.trim()) { this.ui.error('Enter who the meeting was with'); return; }
    this.busy.set(true);
    try {
      const pos = await this.geo.current(4000);
      await this.api.post('/work-logs', { type: 'MEETING', place: this.meetWith.trim(), notes: this.meetNotes.trim() || undefined, lat: pos?.lat, lng: pos?.lng });
      this.meetOpen.set(false); this.meetWith = ''; this.meetNotes = '';
      this.ui.success('✅ Meeting logged');
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}

/** Distributor / office visit check-in & check-out with today's log. */
@Component({
  selector: 'app-checkinout',
  imports: [FormsModule, AppBar, StateView, TimePipe],
  host: { class: 'sc' },
  template: `
    <app-bar [title]="isDist() ? 'Distributor Visit' : 'Office Visit'" sub="Check-in / Check-out" fallback="/work" />
    <div class="body pad">
      <div class="card p center">
        <div style="font-size:44px;margin-bottom:8px">{{ isDist() ? '🏭' : '🏢' }}</div>
        @if (open(); as o) {
          <b style="font-size:15px">{{ o.place }}</b>
          <div class="chip c-green mt12" style="margin-bottom:12px"><span class="d"></span>Checked in · {{ o.checkInAt | time }}</div>
          <button class="btn dark" type="button" [disabled]="busy()" (click)="checkOut(o.id)">Check Out</button>
        } @else {
          <div class="fld" style="text-align:left"><label for="pl">{{ isDist() ? 'Distributor name' : 'Office' }}</label>
            <input id="pl" [(ngModel)]="place" [placeholder]="isDist() ? 'e.g. Ariser Distributor Hub' : 'e.g. Regional Sales Office'" maxlength="150"></div>
          <button class="btn primary" type="button" [disabled]="busy()" (click)="checkIn()">📍 Check In</button>
        }
      </div>
      <div class="sec-title">Today's Visit Log</div>
      <div class="card p">
        <app-state [loading]="loading()">
          @for (l of logs(); track l.id) {
            <div class="between" style="padding:7px 0;border-bottom:1px solid var(--brd)">
              <div><b style="font-size:13px">{{ label(l.type) }} · {{ l.place || l.joinedUser || '—' }}</b>
                <div class="tiny">In {{ l.checkInAt | time }}@if (l.checkOutAt) { · Out {{ l.checkOutAt | time }} · {{ l.minutes }} min }</div></div>
              <span class="chip xs" [class.c-green]="l.checkOutAt" [class.c-amber]="!l.checkOutAt"><span class="d"></span>{{ l.checkOutAt ? 'Saved' : 'Open' }}</span>
            </div>
          } @empty { <div class="muted">No visits logged yet.</div> }
        </app-state>
      </div>
    </div>`,
})
export class CheckInOutPage {
  type = input.required<string>();
  private api = inject(Api);
  private ui = inject(Ui);
  private geo = inject(Geo);
  logs = signal<WorkLog[]>([]);
  loading = signal(true);
  busy = signal(false);
  place = '';
  isDist = () => this.type() === 'distributor';
  open = () => this.logs().find(l => !l.checkOutAt && ['DISTRIBUTOR', 'OFFICE'].includes(l.type));
  label = (t: string) => ({ DISTRIBUTOR: 'Distributor', OFFICE: 'Office', MEETING: 'Meeting', JOINED: 'Joined work' })[t] ?? t;

  constructor() { this.load(); }
  async load() {
    try { this.logs.set(await this.api.get<WorkLog[]>('/work-logs/today')); } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  async checkIn() {
    if (!this.place.trim()) { this.ui.error('Enter the place you are visiting'); return; }
    this.busy.set(true);
    try {
      const pos = await this.geo.current(5000);
      await this.api.post('/work-logs', { type: this.isDist() ? 'DISTRIBUTOR' : 'OFFICE', place: this.place.trim(), lat: pos?.lat, lng: pos?.lng });
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  async checkOut(id: number) {
    this.busy.set(true);
    try {
      const r = await this.api.post<WorkLog>(`/work-logs/${id}/checkout`);
      this.ui.success(`✅ Check-out saved · duration ${r.minutes} min`);
      this.place = '';
      await this.load();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
