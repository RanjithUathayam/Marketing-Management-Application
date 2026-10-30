import { Component, computed, input, output } from '@angular/core';
import { MONTHS_LONG, todayIso } from '../core/format';

/** Month grid showing a journey plan (beat code per day). In build mode working days are selectable. */
@Component({
  selector: 'app-plan-calendar',
  template: `
    <div class="cal-bar"><span></span><b>{{ label() }}</b><span></span></div>
    <div class="dows"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span class="off">S</span></div>
    <div class="days">
      @for (x of lead(); track $index) { <div class="day off"></div> }
      @for (d of cells(); track d.day) {
        <div class="day" [class.off]="d.sunday" [class.has]="d.code && !d.sel" [class.sel]="d.sel" [class.today]="d.today" [class.click]="pickable(d)" [class.past]="build() && d.past"
             [attr.role]="pickable(d) ? 'button' : null" [attr.tabindex]="pickable(d) ? 0 : null" [attr.aria-disabled]="build() && !pickable(d) ? true : null"
             [attr.aria-pressed]="build() ? d.sel : null" [attr.aria-label]="d.day + (d.code ? ' ' + d.code : '')"
             (click)="tap(d)" (keydown.enter)="tap(d)">{{ d.day }}@if (d.code) {<span class="bdg">{{ d.code }}</span>}</div>
      }
    </div>`,
})
export class PlanCalendar {
  year = input.required<number>();
  month = input.required<number>();
  days = input<{ day: number; beatId: number }[]>([]);
  codes = input<Map<number, string>>(new Map());
  selected = input<Set<number>>(new Set());
  build = input(false);
  /** In build mode, days before today cannot be (re)planned. */
  lockPast = input(false);
  toggle = output<number>();

  label = computed(() => `${MONTHS_LONG[this.month() - 1]} ${this.year()}`);
  lead = computed(() => Array((new Date(this.year(), this.month() - 1, 1).getDay() + 6) % 7));
  cells = computed(() => {
    const dim = new Date(this.year(), this.month(), 0).getDate(), t = todayIso();
    const map = new Map(this.days().map(d => [d.day, d.beatId]));
    return Array.from({ length: dim }, (_, i) => {
      const day = i + 1, iso = `${this.year()}-${String(this.month()).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const beat = map.get(day);
      return { day, sunday: new Date(this.year(), this.month() - 1, day).getDay() === 0, today: iso === t, past: this.lockPast() && iso < t,
               code: beat ? (this.codes().get(beat) ?? '').replace('BT-', '') : '', sel: this.selected().has(day) };
    });
  });
  pickable = (d: { sunday: boolean; past: boolean }) => this.build() && !d.sunday && !d.past;
  tap(d: { day: number; sunday: boolean; past: boolean }) { if (this.pickable(d)) this.toggle.emit(d.day); }
}
