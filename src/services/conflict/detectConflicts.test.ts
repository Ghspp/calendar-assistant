import { describe, expect, it } from 'vitest';
import { detectConflicts } from './detectConflicts';
import { DAY, TZ, allDay, interval, timed } from './eventFixtures';
import type { CalendarEvent } from '../../types/calendar';

/** The reference busy block for the whole matrix: 17:00-18:00 on 2026-09-14. */
const FOOTBALL = timed('חוג כדורגל', '17:00', '18:00');

function check(startTime: string, endTime: string, events: CalendarEvent[] = [FOOTBALL]) {
  return detectConflicts(interval(startTime, endTime), events, TZ);
}

describe('the conflict matrix against חוג כדורגל 17:00-18:00', () => {
  it('ALLOWS an event that starts exactly when it ends', () => {
    // 17:00-18:00 + 18:00-19:00 — the canonical allowed case from the plan.
    expect(check('18:00', '19:00').hasConflict).toBe(false);
  });

  it('ALLOWS an event that ends exactly when it starts', () => {
    expect(check('16:00', '17:00').hasConflict).toBe(false);
  });

  it('BLOCKS a partial overlap at the end', () => {
    const report = check('17:30', '18:30');
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts[0]?.kind).toBe('partial');
  });

  it('BLOCKS a partial overlap at the start', () => {
    const report = check('16:30', '17:30');
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts[0]?.kind).toBe('partial');
  });

  it('BLOCKS an exact duplicate', () => {
    const report = check('17:00', '18:00');
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts[0]?.kind).toBe('identical');
  });

  it('BLOCKS an event entirely inside the existing one', () => {
    const report = check('17:15', '17:45');
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts[0]?.kind).toBe('contained');
  });

  it('BLOCKS an event that entirely contains the existing one', () => {
    const report = check('16:00', '19:00');
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts[0]?.kind).toBe('contains');
  });

  it('BLOCKS an overlap of a single minute', () => {
    expect(check('17:59', '18:30').hasConflict).toBe(true);
  });

  it('ALLOWS a clearly separate time', () => {
    expect(check('20:00', '21:00').hasConflict).toBe(false);
  });

  it('ALLOWS the same clock time on a different day', () => {
    const report = detectConflicts(interval('17:00', '18:00', '2026-09-15'), [FOOTBALL], TZ);
    expect(report.hasConflict).toBe(false);
  });

  it('reports the conflicting event so the user can be told which one', () => {
    const report = check('17:30', '18:30');
    expect(report.conflicts[0]?.event.title).toBe('חוג כדורגל');
  });
});

describe('events that must be ignored', () => {
  it('ignores a cancelled event', () => {
    const cancelled = timed('פגישה מבוטלת', '17:00', '18:00', { status: 'cancelled' });
    const report = check('17:30', '18:30', [cancelled]);
    expect(report.hasConflict).toBe(false);
    expect(report.ignored[0]?.reason).toBe('cancelled');
  });

  it('ignores a transparent (free) event', () => {
    const free = timed('תזכורת', '17:00', '18:00', { transparency: 'transparent' });
    const report = check('17:30', '18:30', [free]);
    expect(report.hasConflict).toBe(false);
    expect(report.ignored[0]?.reason).toBe('transparent');
  });

  it('ignores an invitation the user declined', () => {
    const declined = timed('ישיבת צוות', '17:00', '18:00', { responseStatus: 'declined' });
    const report = check('17:30', '18:30', [declined]);
    expect(report.hasConflict).toBe(false);
    expect(report.ignored[0]?.reason).toBe('declined');
  });

  it('ignores an event with unparseable times rather than crashing', () => {
    const broken: CalendarEvent = {
      kind: 'timed',
      id: 'broken',
      title: 'שבור',
      start: 'not-a-date',
      end: 'also-not-a-date',
    };
    const report = check('17:30', '18:30', [broken]);
    expect(report.hasConflict).toBe(false);
    expect(report.ignored[0]?.reason).toBe('unparseable');
  });

  it('ignores an event whose end is not after its start', () => {
    const inverted: CalendarEvent = {
      kind: 'timed',
      id: 'inverted',
      title: 'הפוך',
      start: '2026-09-14T15:00:00Z',
      end: '2026-09-14T14:00:00Z',
    };
    expect(check('17:30', '18:30', [inverted]).hasConflict).toBe(false);
  });
});

describe('events that must still block', () => {
  it('blocks on a tentative event — tentative is not cancelled', () => {
    const tentative = timed('אולי פגישה', '17:00', '18:00', { status: 'tentative' });
    expect(check('17:30', '18:30', [tentative]).hasConflict).toBe(true);
  });

  it('blocks on an accepted invitation', () => {
    const accepted = timed('ישיבה', '17:00', '18:00', { responseStatus: 'accepted' });
    expect(check('17:30', '18:30', [accepted]).hasConflict).toBe(true);
  });

  it('blocks on an invitation not yet answered', () => {
    const pending = timed('ישיבה', '17:00', '18:00', { responseStatus: 'needsAction' });
    expect(check('17:30', '18:30', [pending]).hasConflict).toBe(true);
  });

  it('blocks on an explicitly opaque event', () => {
    const opaque = timed('פגישה', '17:00', '18:00', { transparency: 'opaque' });
    expect(check('17:30', '18:30', [opaque]).hasConflict).toBe(true);
  });
});

describe('all-day events', () => {
  it('does not block — it is informational only', () => {
    const report = check('17:30', '18:30', [allDay('חופשה')]);
    expect(report.hasConflict).toBe(false);
    expect(report.informational).toHaveLength(1);
    expect(report.informational[0]?.title).toBe('חופשה');
  });

  it('is not reported for a different day', () => {
    const report = check('17:30', '18:30', [allDay('חופשה', '2026-09-20', '2026-09-21')]);
    expect(report.informational).toHaveLength(0);
  });

  it('covers a multi-day span using an exclusive end date', () => {
    // 14th to 16th inclusive is stored with an end date of the 17th.
    const trip = allDay('טיול', '2026-09-14', '2026-09-17');
    const onSixteenth = detectConflicts(interval('10:00', '11:00', '2026-09-16'), [trip], TZ);
    const onSeventeenth = detectConflicts(interval('10:00', '11:00', '2026-09-17'), [trip], TZ);
    expect(onSixteenth.informational).toHaveLength(1);
    expect(onSeventeenth.informational).toHaveLength(0);
  });

  it('does not block even while a timed event on the same day does', () => {
    const report = check('17:30', '18:30', [allDay('חופשה'), FOOTBALL]);
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts).toHaveLength(1);
    expect(report.informational).toHaveLength(1);
  });

  it('ignores a cancelled all-day event entirely', () => {
    const report = check('17:30', '18:30', [allDay('חופשה', DAY, '2026-09-15', {
      status: 'cancelled',
    })]);
    expect(report.informational).toHaveLength(0);
    expect(report.ignored[0]?.reason).toBe('cancelled');
  });
});

describe('recurring event instances', () => {
  // The provider expands recurrences before we see them, so each instance is an
  // ordinary event that happens to carry a recurringEventId.
  const weekly = [
    timed('חוג כדורגל', '17:00', '18:00', { date: '2026-09-14', recurringEventId: 'football' }),
    timed('חוג כדורגל', '17:00', '18:00', { date: '2026-09-21', recurringEventId: 'football' }),
    timed('חוג כדורגל', '17:00', '18:00', { date: '2026-09-28', recurringEventId: 'football' }),
  ];

  it('blocks on the instance that overlaps', () => {
    const report = detectConflicts(interval('17:30', '18:30', '2026-09-21'), weekly, TZ);
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts).toHaveLength(1);
  });

  it('blocks on a later instance just as well as the first', () => {
    const report = detectConflicts(interval('17:30', '18:30', '2026-09-28'), weekly, TZ);
    expect(report.hasConflict).toBe(true);
  });

  it('does not block on a week with no instance', () => {
    const report = detectConflicts(interval('17:30', '18:30', '2026-09-15'), weekly, TZ);
    expect(report.hasConflict).toBe(false);
  });

  it('does not collapse instances that share a recurringEventId', () => {
    // A slot spanning all three instances must report three conflicts, not one series.
    const wide = {
      start: interval('00:00', '01:00', '2026-09-14').start,
      end: interval('00:00', '01:00', '2026-09-29').start,
    };
    expect(detectConflicts(wide, weekly, TZ).conflicts).toHaveLength(3);
  });
});

describe('multiple conflicts', () => {
  it('reports every overlapping event, earliest first', () => {
    const events = [
      timed('מאוחר', '19:00', '20:00'),
      timed('מוקדם', '16:00', '17:30'),
      timed('אמצע', '17:00', '18:00'),
    ];
    const report = detectConflicts(interval('16:30', '19:30'), events, TZ);
    expect(report.conflicts.map((conflict) => conflict.event.title)).toEqual([
      'מוקדם',
      'אמצע',
      'מאוחר',
    ]);
  });

  it('reports nothing for an empty calendar', () => {
    const report = check('17:30', '18:30', []);
    expect(report.hasConflict).toBe(false);
    expect(report.conflicts).toEqual([]);
  });
});

describe('time zone correctness', () => {
  it('compares absolute instants, so a UTC-stored event still blocks', () => {
    // 15:00Z is 18:00 Israel in September (IDT, +03:00).
    const utcEvent: CalendarEvent = {
      kind: 'timed',
      id: 'utc',
      title: 'פגישה',
      start: '2026-09-14T15:00:00Z',
      end: '2026-09-14T16:00:00Z',
    };
    expect(check('18:00', '19:00', [utcEvent]).hasConflict).toBe(true);
    expect(check('17:00', '18:00', [utcEvent]).hasConflict).toBe(false);
  });

  it('handles the winter offset', () => {
    // 16:00Z is 18:00 Israel in December (IST, +02:00).
    const winterEvent: CalendarEvent = {
      kind: 'timed',
      id: 'winter',
      title: 'פגישה',
      start: '2026-12-14T16:00:00Z',
      end: '2026-12-14T17:00:00Z',
    };
    const report = detectConflicts(interval('18:30', '19:30', '2026-12-14'), [winterEvent], TZ);
    expect(report.hasConflict).toBe(true);
  });

  it('treats an offset-form timestamp the same as a Z-form one', () => {
    const offsetForm: CalendarEvent = {
      kind: 'timed',
      id: 'offset',
      title: 'פגישה',
      start: '2026-09-14T18:00:00+03:00',
      end: '2026-09-14T19:00:00+03:00',
    };
    expect(check('18:30', '19:30', [offsetForm]).hasConflict).toBe(true);
    expect(check('19:00', '20:00', [offsetForm]).hasConflict).toBe(false);
  });
});

describe('purity', () => {
  it('does not mutate the events it is given', () => {
    const events = [FOOTBALL];
    const snapshot = JSON.stringify(events);
    detectConflicts(interval('17:30', '18:30'), events, TZ);
    expect(JSON.stringify(events)).toBe(snapshot);
  });

  it('returns the same report for the same inputs', () => {
    const first = check('17:30', '18:30');
    const second = check('17:30', '18:30');
    expect(first.hasConflict).toBe(second.hasConflict);
    expect(first.conflicts.length).toBe(second.conflicts.length);
  });
});
