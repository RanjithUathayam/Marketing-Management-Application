import { Component, computed, input, output, signal } from '@angular/core';
import { Beat } from '../core/models';
import { BEAT_COLOR, MONTHS, fmtD } from '../core/format';
import { VisitBadge } from './ui.components';

/* Beat insight card: visit indicator, priority reason, A/B/C mix, productive calls. Expandable. */
@Component({
  selector: 'app-beat-card',
  imports: [VisitBadge],
  template: `
    <div class="bk-item prio-{{ b().priority.group }}" [class.open]="open()">
      <div class="lrow bk-head" role="button" tabindex="0" [attr.aria-expanded]="open()" (click)="toggle.emit()" (keydown.enter)="toggle.emit()">
        <div class="av" [style.background]="color()">{{ b().code.replace('BT-', '') }}</div>
        <div class="lr-main">
          <div class="bname-row"><b>{{ b().name }}</b><app-visit-badge [ind]="b().indicator" /></div>
          <span>{{ b().code }} · {{ b().outlets }} outlets · {{ b().visitCount ? b().indicator.label + ' this month' : 'not visited this month' }}</span>
          @if (b().priority.group !== 'ok') {
            <div class="prio-why {{ b().priority.group }}">{{ b().priority.group === 'nv' ? 'Not visited this month' : 'Must visit' }}@for (r of b().priority.reasons; track r) { · {{ r }} }</div>
          }
        </div>
        <button class="bk-tog" type="button" [attr.aria-label]="(open() ? 'Collapse ' : 'Expand ') + b().name" (click)="$event.stopPropagation(); toggle.emit()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
      <div class="bk-body"><div class="bk-inner"><div class="lr-main">
        <div class="bk-meta">{{ b().plannedDays }} day{{ b().plannedDays === 1 ? '' : 's' }} planned in this month's journey plan</div>
        <div class="vline {{ b().indicator.tone }}"><i class="vdot"></i><span class="vtxt">{{ visitText() }}</span></div>
        <div class="cmix">
          <div class="cmix-chips"><em class="cm a">A-Class <b>{{ b().mix.a }}</b></em><em class="cm b">B-Class <b>{{ b().mix.b }}</b></em><em class="cm c">C-Class <b>{{ b().mix.c }}</b></em></div>
          <div class="cmix-bar"><i class="a" [style.width.%]="mixPct().a"></i><i class="b" [style.width.%]="mixPct().b"></i><i class="c" [style.width.%]="mixPct().c"></i></div>
        </div>
        @if (b().productiveCalls; as pc) {
          <div class="pc {{ pc.level }}">
            <div class="pc-top"><span class="pc-lbl">Last visit {{ fmtD(b().lastVisit!.date) }}{{ b().lastVisit!.previousMonth ? ' (prev. month)' : '' }}</span>
              <em class="pc-tag">{{ pc.level === 'hi' ? '🔥 High Selling' : pc.level === 'mid' ? 'Average' : '⚠ Low Calls' }}</em></div>
            <div class="pc-row"><b class="pc-num">{{ b().lastVisit!.ordered }}<small>/{{ b().lastVisit!.visited }}</small></b><span class="pc-txt">dealers ordered</span><b class="pc-pct">{{ pc.pct }}%</b></div>
            <div class="pc-bar"><i [style.width.%]="pc.pct"></i></div>
            @if (pc.level === 'low') {
              <div class="pc-warn">Only {{ b().lastVisit!.ordered }} of {{ b().lastVisit!.visited }} dealers placed orders. Check pending stock, push schemes to non-ordering dealers, and review the visit frequency before the next visit.</div>
            }
          </div>
        }
        <div class="bk-actions"><ng-content /></div>
      </div></div></div>
    </div>`,
})
export class BeatCard {
  b = input.required<Beat>();
  open = input(false);
  toggle = output<void>();
  fmtD = fmtD;
  color = computed(() => BEAT_COLOR[this.b().colorTag] ?? '#0d6e50');
  mixPct = computed(() => {
    const m = this.b().mix, t = m.a + m.b + m.c || 1;
    return { a: (m.a / t) * 100, b: (m.b / t) * 100, c: (m.c / t) * 100 };
  });
  visitText = computed(() => {
    const b = this.b(), mon = MONTHS[new Date().getMonth()];
    if (b.visitCount) return `${b.indicator.label} in ${mon} · ${b.monthVisits.map(v => v.date.slice(8, 10)).join(', ')} ${mon}`;
    return `No visit in ${mon} yet${b.lastVisit ? ' · last ' + fmtD(b.lastVisit.date) : ''}`;
  });
}

type Filter = 'all' | 'nv' | 'mv' | 'vs';

/* Filterable (All · NV · MV · Vs), priority-grouped, expandable beat list. */
@Component({
  selector: 'app-beat-list',
  imports: [BeatCard],
  template: `
    <div class="sec-title bk-title"><span>{{ heading() }}</span>
      <button class="bk-all" type="button" (click)="toggleAll()">{{ allOpen() ? 'Collapse all' : 'Expand all' }}</button></div>
    <div class="bk-filter" role="tablist" aria-label="Filter beats by visit status">
      @for (f of filters; track f[0]) {
        <button role="tab" type="button" class="bkf {{ f[0] }}" [class.on]="filter() === f[0]" [attr.aria-selected]="filter() === f[0]" (click)="filter.set(f[0])">{{ f[1] }}<em>{{ count(f[0]) }}</em></button>
      }
    </div>
    <div class="card">
      @for (b of visible(); track b.id; let i = $index) {
        @if (grouped() && (i === 0 || visible()[i - 1].priority.group !== b.priority.group)) {
          <div class="prio-head {{ b.priority.group }}"><span>{{ groupLabel[b.priority.group] }}</span><em>{{ groupCount(b.priority.group) }}</em></div>
        }
        <app-beat-card [b]="b" [open]="opened().has(b.id)" (toggle)="toggleOne(b.id)">
          @if (actions()) {
            <button class="logv" type="button" (click)="logVisit.emit(b)">＋ Log visit</button>
            <button class="logv alt" type="button" (click)="beatChange.emit(b)">⇄ Beat change</button>
          }
        </app-beat-card>
      } @empty {
        <div class="empty">No {{ emptyLabel[filter()] }} beats this month.</div>
      }
    </div>`,
})
export class BeatList {
  beats = input.required<Beat[]>();
  heading = input('Assigned Beats');
  actions = input(false);
  grouped = input(true);
  logVisit = output<Beat>();
  beatChange = output<Beat>();

  filters: [Filter, string][] = [['all', 'All'], ['nv', 'NV'], ['mv', 'MV'], ['vs', 'Vs']];
  groupLabel: Record<string, string> = { nv: '🚫 Not Visited', must: '⚑ Must Visit', ok: '✓ On Track' };
  emptyLabel: Record<Filter, string> = { all: '', nv: 'NV – not visited', mv: 'MV – visited once', vs: 'Vs – visited 2+ times' };
  filter = signal<Filter>('all');
  opened = signal(new Set<number>());
  visible = computed(() => this.beats().filter(b => this.filter() === 'all' || b.group === this.filter()));
  allOpen = computed(() => this.visible().length > 0 && this.visible().every(b => this.opened().has(b.id)));

  count(f: Filter) { return f === 'all' ? this.beats().length : this.beats().filter(b => b.group === f).length; }
  groupCount(g: string) { return this.visible().filter(b => b.priority.group === g).length; }
  toggleOne(id: number) {
    const s = new Set(this.opened());
    s.has(id) ? s.delete(id) : s.add(id);
    this.opened.set(s);
  }
  toggleAll() {
    const s = new Set(this.opened()), open = !this.allOpen();
    this.visible().forEach(b => (open ? s.add(b.id) : s.delete(b.id)));
    this.opened.set(s);
  }
}
