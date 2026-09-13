import { describe, expect, it } from 'vitest';
import { findFirstFreeSlot, findFreeSlots } from './findFreeSlots';
import { DAY, allDay, timed } from './eventFixtures';
import { fixedClock } from '../../utils/clock';
import type { CalendarEvent } from '../../types/calendar';

/** Sunday 2026-09-13, 12:00 Israel time. Everything on DAY (the 14th) is future. */
const CLOCK = fixedClock('2026-09-13T09:00:00Z');

function slots(events: CalendarEvent[], durationMinutes = 60, extra: Partial<{
  dayStart: string;
  dayEnd: string;
  date: string;
  includePast: boolean;
}> = {}) {
  return findFreeSlots(
    {
      date: extra.date ?? DAY,
      events,
      durationMinutes,
      ...(extra.dayStart !== undefined ? { dayStart: extra.dayStart } : {}),
      ...(extra.dayEnd !== undefined ? { dayEnd: extra.dayEnd } : {}),
      ...(extra.includePast !== undefined ? { includePast: extra.includePast } : {}),
    },
    CLOCK,
  );
}

function ranges(events: CalendarEvent[], durationMinutes = 60): string[] {
  return slots(events, durationMinutes).map((slot) => `${slot.startTime}-${slot.endTime}`);
}

describe('basic gap finding', () => {
  it('offers the whole waking day when the calendar is empty', () => {
    expect(ranges([])).toEqual(['08:00-22:00']);
  });

  it('splits the day around a single event', () => {
    expect(ranges([timed('חוג כדורגל', '17:00', '18:00')])).toEqual([
      '08:00-17:00',
      '18:00-22:00',
    ]);
  });

  it('splits the day around several events', () => {
    const events = [
      timed('פגישה', '09:00', '10:00'),
      timed('אימון', '13:00', '14:00'),
      timed('חוג', '17:00', '18:00'),
    ];
    expect(ranges(events)).toEqual([
      '08:00-09:00',
      '10:00-13:00',
      '14:00-17:00',
      '18:00-22:00',
    ]);
  });

  it('reports no gap when the window is fully booked', () => {
    expect(ranges([timed('יום שלם', '08:00', '22:00')])).toEqual([]);
  });

  it('handles an event that starts before the window', () => {
    expect(ranges([timed('לילה', '06:00', '09:00')])).toEqual(['09:00-22:00']);
  });

  it('handles an event that ends after the window', () => {
    expect(ranges([timed('ערב ארוך', '20:00', '23:30')])).toEqual(['08:00-20:00']);
  });

  it('ignores an event entirely outside the window', () => {
    expect(ranges([timed('מוקדם מאוד', '05:00', '06:00')])).toEqual(['08:00-22:00']);
  });
});

describe('merging', () => {
  it('merges back-to-back events into one busy block', () => {
    const events = [timed('א', '10:00', '11:00'), timed('ב', '11:00', '12:00')];
    expect(ranges(events)).toEqual(['08:00-10:00', '12:00-22:00']);
  });

  it('merges overlapping events', () => {
    const events = [timed('א', '10:00', '12:00'), timed('ב', '11:00', '13:00')];
    expect(ranges(events)).toEqual(['08:00-10:00', '13:00-22:00']);
  });

  it('merges an event fully inside another', () => {
    const events = [timed('גדול', '10:00', '14:00'), timed('קטן', '11:00', '12:00')];
    expect(ranges(events)).toEqual(['08:00-10:00', '14:00-22:00']);
  });

  it('is not confused by unsorted input', () => {
    const events = [timed('מאוחר', '17:00', '18:00'), timed('מוקדם', '09:00', '10:00')];
    expect(ranges(events)).toEqual(['08:00-09:00', '10:00-17:00', '18:00-22:00']);
  });
});

describe('duration filtering', () => {
  const packed = [
    timed('א', '09:00', '10:00'),
    timed('ב', '10:30', '12:00'),
    timed('ג', '14:00', '20:00'),
  ];

  it('returns short gaps when a short event is requested', () => {
    expect(ranges(packed, 30)).toEqual(['08:00-09:00', '10:00-10:30', '12:00-14:00', '20:00-22:00']);
  });

  it('drops gaps that are too short for the requested duration', () => {
    // 'מצא לי שעה פנויה של שעתיים' — the 30-minute and 60-minute gaps do not qualify.
    expect(ranges(packed, 120)).toEqual(['12:00-14:00', '20:00-22:00']);
  });

  it('accepts a gap exactly as long as the duration', () => {
    expect(ranges([timed('א', '09:00', '22:00')], 60)).toEqual(['08:00-09:00']);
  });

  it('returns nothing for a duration longer than any gap', () => {
    expect(ranges(packed, 300)).toEqual([]);
  });

  it('returns nothing for a zero or negative duration', () => {
    expect(ranges([], 0)).toEqual([]);
    expect(ranges([], -30)).toEqual([]);
  });

  it('reports the full gap, not a duration-sized slice', () => {
    const [slot] = slots([], 60);
    expect(slot?.durationMinutes).toBe(14 * 60);
  });
});

describe('search window', () => {
  it('narrows to the evening for מחר בערב', () => {
    const events = [timed('חוג כדורגל', '17:00', '18:00')];
    expect(
      slots(events, 60, { dayStart: '18:00', dayEnd: '23:00' }).map(
        (slot) => `${slot.startTime}-${slot.endTime}`,
      ),
    ).toEqual(['18:00-23:00']);
  });

  it('returns nothing when the window is inverted', () => {
    expect(slots([], 60, { dayStart: '20:00', dayEnd: '09:00' })).toEqual([]);
  });

  it('returns nothing for an empty window', () => {
    expect(slots([], 60, { dayStart: '10:00', dayEnd: '10:00' })).toEqual([]);
  });

  it('returns nothing for an invalid date', () => {
    expect(slots([], 60, { date: '2026-02-30' })).toEqual([]);
  });
});

describe('past time', () => {
  // The clock reads 12:00 on 2026-09-13, so most of that day is already gone.
  const today = '2026-09-13';

  it('does not offer time that has already passed today', () => {
    const result = slots([], 60, { date: today });
    expect(result[0]?.startTime).toBe('12:00');
  });

  it('offers the whole day for a future date', () => {
    expect(ranges([])).toEqual(['08:00-22:00']);
  });

  it('offers past time when explicitly asked', () => {
    const result = slots([], 60, { date: today, includePast: true });
    expect(result[0]?.startTime).toBe('08:00');
  });

  it('returns nothing when the window has entirely passed', () => {
    expect(slots([], 60, { date: today, dayStart: '08:00', dayEnd: '11:00' })).toEqual([]);
  });
});

describe('events that do not consume time', () => {
  it('ignores a cancelled event', () => {
    expect(ranges([timed('מבוטל', '10:00', '12:00', { status: 'cancelled' })])).toEqual([
      '08:00-22:00',
    ]);
  });

  it('ignores a transparent event', () => {
    expect(ranges([timed('תזכורת', '10:00', '12:00', { transparency: 'transparent' })])).toEqual([
      '08:00-22:00',
    ]);
  });

  it('ignores a declined invitation', () => {
    expect(ranges([timed('ישיבה', '10:00', '12:00', { responseStatus: 'declined' })])).toEqual([
      '08:00-22:00',
    ]);
  });

  it('does not let an all-day event consume the whole day', () => {
    // Consistent with detectConflicts: a day marked 'חופשה' still has free hours.
    expect(ranges([allDay('חופשה')])).toEqual(['08:00-22:00']);
  });

  it('still respects timed events on an all-day-marked day', () => {
    expect(ranges([allDay('חופשה'), timed('פגישה', '10:00', '11:00')])).toEqual([
      '08:00-10:00',
      '11:00-22:00',
    ]);
  });

  it('ignores an unparseable event', () => {
    const broken: CalendarEvent = {
      kind: 'timed',
      id: 'broken',
      title: 'שבור',
      start: 'nonsense',
      end: 'nonsense',
    };
    expect(ranges([broken])).toEqual(['08:00-22:00']);
  });
});

describe('agreement with conflict detection', () => {
  it('never offers a slot that would conflict', () => {
    const events = [
      timed('א', '09:00', '10:00'),
      timed('ב', '13:00', '15:00'),
      timed('ג', '17:00', '18:00'),
    ];
    const free = slots(events, 60);

    for (const slot of free) {
      for (const event of events) {
        const eventStart = new Date(event.kind === 'timed' ? event.start : '').getTime();
        const eventEnd = new Date(event.kind === 'timed' ? event.end : '').getTime();
        const overlaps =
          slot.start.getTime() < eventEnd && slot.end.getTime() > eventStart;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe('findFirstFreeSlot', () => {
  it('returns the earliest qualifying gap', () => {
    const events = [timed('א', '08:00', '09:00'), timed('ב', '10:00', '11:00')];
    expect(findFirstFreeSlot({ date: DAY, events, durationMinutes: 60 }, CLOCK)?.startTime).toBe(
      '09:00',
    );
  });

  it('skips a gap that is too short', () => {
    const events = [timed('א', '08:00', '09:00'), timed('ב', '09:30', '11:00')];
    const first = findFirstFreeSlot({ date: DAY, events, durationMinutes: 60 }, CLOCK);
    expect(first?.startTime).toBe('11:00');
  });

  it('returns undefined when nothing fits', () => {
    const events = [timed('יום שלם', '08:00', '22:00')];
    expect(findFirstFreeSlot({ date: DAY, events, durationMinutes: 60 }, CLOCK)).toBeUndefined();
  });
});

describe('time zone correctness', () => {
  it('reports wall-clock times in Israel local time', () => {
    // 15:00Z is 18:00 Israel in September.
    const utcEvent: CalendarEvent = {
      kind: 'timed',
      id: 'utc',
      title: 'פגישה',
      start: '2026-09-14T15:00:00Z',
      end: '2026-09-14T16:00:00Z',
    };
    expect(ranges([utcEvent])).toEqual(['08:00-18:00', '19:00-22:00']);
  });

  it('works in winter, when Israel is at UTC+2', () => {
    const winterEvent: CalendarEvent = {
      kind: 'timed',
      id: 'winter',
      title: 'פגישה',
      start: '2026-12-14T16:00:00Z',
      end: '2026-12-14T17:00:00Z',
    };
    const result = findFreeSlots(
      { date: '2026-12-14', events: [winterEvent], durationMinutes: 60 },
      CLOCK,
    );
    expect(result.map((slot) => `${slot.startTime}-${slot.endTime}`)).toEqual([
      '08:00-18:00',
      '19:00-22:00',
    ]);
  });
});
