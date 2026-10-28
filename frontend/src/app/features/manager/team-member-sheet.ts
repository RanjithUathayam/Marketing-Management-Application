import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Ui } from '../../core/ui.service';
import { TeamMember } from '../../core/models';
import { InrPipe } from '../../core/format';
import { Sheet } from '../../shared/ui.components';

/** Team member quick view: KPIs, set monthly target, jump to tracking / orders / call. */
@Component({
  selector: 'app-team-member-sheet',
  imports: [FormsModule, Sheet, InrPipe],
  template: `
    <app-sheet [open]="!!member()" (openChange)="!$event && closed.emit()" [heading]="member()?.name ?? ''" [subheading]="(member()?.empCode ?? '') + ' · ' + (member()?.territory ?? '')">
      @if (member(); as t) {
        <div class="metrics mb12"><div><b>{{ t.achievedPct }}%</b><span>Target</span></div><div><b>{{ t.sales | inr }}</b><span>Sales MTD</span></div><div><b style="text-transform:capitalize;font-size:13px">{{ t.status }}</b><span>Status</span></div></div>
        <div class="prog mb12" [class.red]="t.achievedPct < 50" [class.amber]="t.achievedPct >= 50 && t.achievedPct < 70"><div [style.width.%]="min(t.achievedPct, 100)"></div></div>
        <div class="fld"><label for="tg">Monthly target (₹)</label>
          <div class="row" style="gap:8px"><input id="tg" type="number" min="1" [(ngModel)]="target" style="flex:1"><button class="btn primary sm" type="button" [disabled]="busy()" (click)="saveTarget(t)">Save</button></div></div>
        <div class="btn-row">
          <button class="btn ghost sm" type="button" (click)="go('/manager/track', t)">📡 Track</button>
          <button class="btn ghost sm" type="button" (click)="go('/orders', t)">📦 Orders</button>
        </div>
      }
    </app-sheet>`,
})
export class TeamMemberSheet {
  member = input<TeamMember | null>(null);
  closed = output<void>();
  private api = inject(Api);
  private ui = inject(Ui);
  private router = inject(Router);
  target: number | null = null;
  busy = signal(false);
  min = Math.min;
  constructor() { effect(() => { const m = this.member(); this.target = m?.target || null; }); }
  async saveTarget(t: TeamMember) {
    const amt = Number(this.target);
    if (!(amt > 0)) { this.ui.error('Enter a target amount'); return; }
    const d = new Date();
    this.busy.set(true);
    try { await this.api.put('/targets', { userId: t.id, year: d.getFullYear(), month: d.getMonth() + 1, monthlyTarget: amt }); this.ui.success('🎯 Target saved'); }
    catch (e) { this.ui.error(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  go(path: string, t: TeamMember) { this.closed.emit(); this.router.navigate([path], { queryParams: { userId: t.id } }); }
}
