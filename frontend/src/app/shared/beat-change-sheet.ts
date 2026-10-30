import { Component, effect, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Ui } from '../core/ui.service';
import { Beat } from '../core/models';
import { BEAT_COLOR, todayIso } from '../core/format';
import { Sheet, VisitBadge } from './ui.components';

/* Beat change request: pick another beat, a date and a reason; the manager's approval moves that plan day. */
@Component({
  selector: 'app-beat-change-sheet',
  imports: [FormsModule, Sheet, VisitBadge],
  template: `
    <app-sheet [(open)]="open" heading="Beat Change Request" [subheading]="'From ' + (from()?.name ?? '')">
      <div class="sbox mb12"><span>🔍</span><input [(ngModel)]="query" placeholder="Search beats…" aria-label="Search beats"></div>
      @for (b of list(); track b.id) {
        <button type="button" class="lrow" (click)="pick.set(b.id)" [attr.aria-pressed]="pick() === b.id">
          <div class="av" [style.background]="color(b)">{{ b.code.replace('BT-', '') }}</div>
          <div class="lr-main"><div class="bname-row"><b>{{ b.name }}</b><app-visit-badge [ind]="b.indicator" /></div>
            <span>{{ b.code }} · {{ b.outlets }} outlets · {{ b.indicator.label }} this month</span></div>
          <div style="font-size:18px;color:var(--g)">{{ pick() === b.id ? '✓' : '' }}</div>
        </button>
      } @empty { <div class="empty">No beats match.</div> }
      <div class="fld mt12"><label for="bcd">For date</label><input id="bcd" type="date" [min]="today" [(ngModel)]="date"></div>
      <div class="fld"><label for="bcr">Remarks (required)</label><textarea id="bcr" [(ngModel)]="remark" placeholder="Reason for beat change…" maxlength="400"></textarea></div>
      <button class="btn primary" type="button" [disabled]="busy()" (click)="submit()">Send Change Request →</button>
      <div class="tiny center mt8">Request is sent to {{ auth.user()?.manager?.name || 'your manager' }} for approval.</div>
    </app-sheet>`,
})
export class BeatChangeSheet {
  open = model(false);
  from = input<{ id: number; name: string } | null>(null);
  sent = output<void>();
  auth = inject(AuthService);
  private api = inject(Api);
  private ui = inject(Ui);
  today = todayIso();
  busy = signal(false);
  pick = signal<number | null>(null);
  allBeats = signal<Beat[]>([]);
  query = ''; remark = ''; date = this.today;
  color = (b: Beat) => BEAT_COLOR[b.colorTag];
  list = () => this.allBeats().filter(b => b.id !== this.from()?.id &&
    (b.name.toLowerCase().includes(this.query.toLowerCase()) || b.code.toLowerCase().includes(this.query.toLowerCase())));

  constructor() {
    // Reset the form and refresh the beat list each time the sheet opens.
    effect(() => { if (this.open()) this.reset(); });
  }
  private async reset() {
    this.pick.set(null); this.remark = ''; this.query = ''; this.date = this.today;
    try { this.allBeats.set(await this.api.get<Beat[]>('/beats', { scope: 'all' })); } catch (e) { this.ui.error(errorMessage(e)); }
  }
  async submit() {
    if (!this.pick()) { this.ui.error('Select a beat'); return; }
    if (this.remark.trim().length < 3) { this.ui.error('Remarks required'); return; }
    this.busy.set(true);
    try {
      await this.api.post('/beat-changes', { fromBeatId: this.from()!.id, toBeatId: this.pick(), forDate: this.date, remarks: this.remark.trim() });
      this.open.set(false);
      this.ui.success('📤 Beat change request sent for approval');
      this.sent.emit();
    } catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
}
