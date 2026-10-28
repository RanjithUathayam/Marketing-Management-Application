import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { BeatList } from './beat-list';
import { Beat } from '../core/models';

const beat = (id: number, visits: number, group: 'nv' | 'must' | 'ok', rank: number): Beat => ({
  id, code: `BT-00${id}`, name: `Beat ${id}`, area: 'Area', colorTag: 'green', outlets: 10, mix: { a: 4, b: 3, c: 3 },
  monthVisits: Array.from({ length: visits }, (_, i) => ({ date: `2026-06-0${i + 1}`, visited: 10, ordered: 5 })),
  visitCount: visits, indicator: { code: visits ? (visits === 1 ? 'MV' : 'V' + visits) : 'NV', tone: 'nv', label: `${visits} visits` },
  group: visits === 0 ? 'nv' : visits === 1 ? 'mv' : 'vs', lastVisit: null, productiveCalls: null, plannedToday: false, plannedDays: 2,
  priority: { rank, group, reasons: group === 'ok' ? [] : ['planned today'] },
});

describe('BeatList', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  it('groups by priority and filters NV / MV / Vs', async () => {
    const f = TestBed.createComponent(BeatList);
    f.componentRef.setInput('beats', [beat(1, 0, 'nv', 0), beat(2, 1, 'must', 1), beat(3, 3, 'ok', 2)]);
    await f.whenStable();
    const el: HTMLElement = f.nativeElement;
    expect([...el.querySelectorAll('.prio-head span')].map(s => s.textContent?.trim())).toEqual(['🚫 Not Visited', '⚑ Must Visit', '✓ On Track']);
    expect([...el.querySelectorAll('.bkf em')].map(e => e.textContent)).toEqual(['3', '1', '1', '1']);

    (el.querySelector('.bkf.vs') as HTMLButtonElement).click();
    await f.whenStable();
    expect(el.querySelectorAll('.bk-item').length).toBe(1);
    expect(el.querySelector('.bname-row b')?.textContent).toBe('Beat 3');
  });

  it('expands and collapses all visible beats', async () => {
    const f = TestBed.createComponent(BeatList);
    f.componentRef.setInput('beats', [beat(1, 0, 'nv', 0), beat(2, 2, 'ok', 2)]);
    await f.whenStable();
    const el: HTMLElement = f.nativeElement;
    (el.querySelector('.bk-all') as HTMLButtonElement).click();
    await f.whenStable();
    expect(el.querySelectorAll('.bk-item.open').length).toBe(2);
    expect(el.querySelector('.bk-all')?.textContent).toContain('Collapse all');
  });
});
