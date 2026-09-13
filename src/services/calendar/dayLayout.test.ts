import { describe, expect, it } from 'vitest';
import { hourMarks, layoutDay } from './dayLayout';
import { DAY, TZ, allDay, timed } from '../conflict/eventFixtures';
import type { CalendarEvent } from '../../types/calendar';

const WINDOW = { start: '06:00', end: '23:00' };

function layout(events: CalendarEvent[], date = DAY) {
  return layoutDay(events, date, TZ, WINDOW);
}

describe('placing events', () => {
  it('converts an event to minutes from midnight', () => {
    const [placed] = layout([timed('חוג כדורגל', '17:00', '18:00')]).positioned;

    expect(placed).toMatchObject({
      startMinutes: 17 * 60,
      endMinutes: 18 * 60,
      startTime: '17:00',
      endTime: '18:00',
    });
  });

  it('orders events by start time', () => {
    const placed = layout([
      timed('מאוחר', '17:00', '18:00'),
      timed('מוקדם', '09:00', '10:00'),
    ]).positioned;

    expect(placed.map((item) => item.event.title)).toEqual(['מוקדם', 'מאוחר']);
  });

  it('separates all-day events from the grid', () => {
    const result = layout([allDay('חופשה'), timed('פגישה', '10:00', '11:00')]);

    expect(result.allDay.map((event) => event.title)).toEqual(['חופשה']);
    expect(result.positioned).toHaveLength(1);
  });

  it('hides cancelled and declined events', () => {
    const result = layout([
      timed('מבוטל', '10:00', '11:00', { status: 'cancelled' }),
      timed('נדחה', '12:00', '13:00', { responseStatus: 'declined' }),
      timed('אמיתי', '14:00', '15:00'),
    ]);

    expect(result.positioned.map((item) => item.event.title)).toEqual(['אמיתי']);
  });

  it('skips an unparseable event rather than crashing', () => {
    const broken: CalendarEvent = {
      kind: 'timed',
      id: 'broken',
      title: 'שבור',
      start: 'nonsense',
      end: 'nonsense',
    };
    expect(layout([broken]).positioned).toHaveLength(0);
  });
});

describe('the visible window', () => {
  it('drops an event that finishes before the window opens', () => {
    expect(layout([timed('לילה', '03:00', '04:00')]).positioned).toHaveLength(0);
  });

  it('drops an event that starts after the window closes', () => {
    expect(layout([timed('מאוחר מאוד', '23:30', '23:59')]).positioned).toHaveLength(0);
  });

  it('clamps an event that begins before the window', () => {
    const [placed] = layout([timed('מוקדם', '05:00', '08:00')]).positioned;
    expect(placed?.startMinutes).toBe(6 * 60);
    expect(placed?.clippedStart).toBe(true);
    // The real time is still reported, so the label stays truthful.
    expect(placed?.startTime).toBe('05:00');
  });

  it('clamps an event that runs past the window', () => {
    const [placed] = layout([timed('ארוך', '22:00', '23:59')]).positioned;
    expect(placed?.endMinutes).toBe(23 * 60);
    expect(placed?.clippedEnd).toBe(true);
  });
});

describe('overlapping events share the width', () => {
  it('gives a lone event the full width', () => {
    const [placed] = layout([timed('לבד', '10:00', '11:00')]).positioned;
    expect(placed).toMatchObject({ column: 0, columns: 1 });
  });

  it('splits two overlapping events into two columns', () => {
    const placed = layout([
      timed('א', '10:00', '12:00'),
      timed('ב', '11:00', '13:00'),
    ]).positioned;

    expect(placed.map((item) => item.column)).toEqual([0, 1]);
    expect(placed.every((item) => item.columns === 2)).toBe(true);
  });

  it('splits three concurrent events into three columns', () => {
    const placed = layout([
      timed('א', '10:00', '11:00'),
      timed('ב', '10:00', '11:00'),
      timed('ג', '10:00', '11:00'),
    ]).positioned;

    expect(placed.map((item) => item.column).sort()).toEqual([0, 1, 2]);
    expect(placed.every((item) => item.columns === 3)).toBe(true);
  });

  it('reuses a column once the earlier event has finished', () => {
    const placed = layout([
      timed('א', '10:00', '11:00'),
      timed('ב', '10:30', '12:00'),
      timed('ג', '11:00', '12:00'),
    ]).positioned;

    // 'ג' starts as 'א' ends, so it can take column 0 again.
    const byTitle = Object.fromEntries(placed.map((item) => [item.event.title, item.column]));
    expect(byTitle['א']).toBe(0);
    expect(byTitle['ב']).toBe(1);
    expect(byTitle['ג']).toBe(0);
  });

  it('keeps events that merely touch at full width', () => {
    const placed = layout([
      timed('א', '10:00', '11:00'),
      timed('ב', '11:00', '12:00'),
    ]).positioned;

    expect(placed.every((item) => item.columns === 1)).toBe(true);
  });

  it('starts a new group after a gap', () => {
    const placed = layout([
      timed('א', '09:00', '10:00'),
      timed('ב', '09:30', '10:30'),
      timed('ג', '14:00', '15:00'),
    ]).positioned;

    const byTitle = Object.fromEntries(placed.map((item) => [item.event.title, item.columns]));
    expect(byTitle['א']).toBe(2);
    expect(byTitle['ג']).toBe(1);
  });
});

describe('events crossing midnight', () => {
  it('shows the tail of an event that began yesterday', () => {
    // 23:00 the previous day until 01:00 today.
    const overnight: CalendarEvent = {
      kind: 'timed',
      id: 'overnight',
      title: 'משמרת לילה',
      start: '2026-09-13T20:00:00Z',
      end: '2026-09-14T04:00:00Z',
    };

    const [placed] = layout([overnight]).positioned;
    expect(placed?.clippedStart).toBe(true);
    expect(placed?.startMinutes).toBe(6 * 60);
  });
});

describe('hourMarks', () => {
  it('covers the window inclusively', () => {
    expect(hourMarks({ start: '06:00', end: '09:00' })).toEqual([6, 7, 8, 9]);
  });

  it('rounds a partial window outward', () => {
    expect(hourMarks({ start: '06:30', end: '08:30' })).toEqual([6, 7, 8, 9]);
  });
});
