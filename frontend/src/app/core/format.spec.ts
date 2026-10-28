import { duration, fmtD, initials, money, stage, stageIdx, ORDER_STAGES } from './format';

describe('format helpers', () => {
  it('formats rupees in the Indian grouping', () => {
    expect(money(1500000)).toBe('₹15,00,000');
    expect(money(null)).toBe('₹0');
  });
  it('formats ISO dates as "10 Jun"', () => {
    expect(fmtD('2026-06-10')).toBe('10 Jun');
    expect(fmtD('2026-06-10', true)).toBe('10 Jun 2026');
    expect(fmtD(null)).toBe('');
  });
  it('formats durations for the check-in timer', () => {
    expect(duration(3_725_000)).toBe('01:02:05');
    expect(duration(3_725_000, false)).toBe('1h 02m');
  });
  it('builds initials', () => expect(initials('Ravi Kumar')).toBe('RK'));
  it('orders the six lifecycle stages', () => {
    expect(ORDER_STAGES.map(s => s.k)).toEqual(['RECEIVED', 'APPROVED', 'DELIVERED', 'INVOICED', 'DISPATCHED', 'COMPLETED']);
    expect(stageIdx('INVOICED')).toBe(3);
    expect(stage('DISPATCHED').short).toBe('Dispatched');
  });
});
