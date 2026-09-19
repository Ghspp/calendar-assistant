import { describe, expect, it } from 'vitest';
import { buildRrule } from './rrule';

describe('buildRrule', () => {
  it('builds a daily rule', () => {
    expect(buildRrule({ frequency: 'daily', interval: 1 })).toBe('RRULE:FREQ=DAILY');
  });

  it('builds a weekly rule on one day', () => {
    expect(buildRrule({ frequency: 'weekly', interval: 1, byWeekday: [1] })).toBe(
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
    );
  });

  it('builds a weekly rule on several days, in the order given', () => {
    expect(buildRrule({ frequency: 'weekly', interval: 1, byWeekday: [0, 2, 4] })).toBe(
      'RRULE:FREQ=WEEKLY;BYDAY=SU,TU,TH',
    );
  });

  it('maps Saturday correctly', () => {
    expect(buildRrule({ frequency: 'weekly', interval: 1, byWeekday: [6] })).toBe(
      'RRULE:FREQ=WEEKLY;BYDAY=SA',
    );
  });

  it('includes an interval above one', () => {
    expect(buildRrule({ frequency: 'weekly', interval: 2 })).toBe(
      'RRULE:FREQ=WEEKLY;INTERVAL=2',
    );
  });

  it('omits INTERVAL=1, which is the default', () => {
    expect(buildRrule({ frequency: 'daily', interval: 1 })).not.toContain('INTERVAL');
  });

  it('builds a monthly rule', () => {
    expect(buildRrule({ frequency: 'monthly', interval: 1 })).toBe('RRULE:FREQ=MONTHLY');
  });

  it('drops a duplicated weekday', () => {
    expect(buildRrule({ frequency: 'weekly', interval: 1, byWeekday: [1, 1] })).toBe(
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
    );
  });

  it('refuses an out-of-range weekday rather than guessing', () => {
    expect(buildRrule({ frequency: 'weekly', interval: 1, byWeekday: [7] })).toBeUndefined();
    expect(buildRrule({ frequency: 'weekly', interval: 1, byWeekday: [-1] })).toBeUndefined();
  });

  it('refuses a nonsensical interval', () => {
    expect(buildRrule({ frequency: 'daily', interval: 0 })).toBeUndefined();
    expect(buildRrule({ frequency: 'daily', interval: -2 })).toBeUndefined();
    expect(buildRrule({ frequency: 'daily', interval: 1.5 })).toBeUndefined();
  });

  it('ignores an empty weekday list', () => {
    expect(buildRrule({ frequency: 'weekly', interval: 1, byWeekday: [] })).toBe(
      'RRULE:FREQ=WEEKLY',
    );
  });
});
