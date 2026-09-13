import { describe, expect, it } from 'vitest';
import {
  addDaysToDateString,
  addMinutes,
  dayBoundsInZone,
  differenceInMinutes,
  instantToZonedTime,
  intervalsOverlap,
  isValidDateString,
  isValidTimeString,
  minutesToTimeString,
  parseTimeString,
  zonedTimeToInstant,
} from './time';

const TZ = 'Asia/Jerusalem';

describe('date validation', () => {
  it.each(['2026-09-14', '2028-02-29', '2026-12-31', '2026-01-01'])('accepts %s', (value) => {
    expect(isValidDateString(value)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2027-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-09-32',
    '14/09/2026',
    '2026-9-14',
    'tomorrow',
    '',
  ])('rejects %s', (value) => {
    expect(isValidDateString(value)).toBe(false);
  });
});

describe('time validation', () => {
  it.each(['00:00', '09:30', '17:00', '23:59'])('accepts %s', (value) => {
    expect(isValidTimeString(value)).toBe(true);
  });

  it.each(['24:00', '17:60', '5:00', '17:0', '1700', '', 'שש'])('rejects %s', (value) => {
    expect(isValidTimeString(value)).toBe(false);
  });

  it('converts to minutes since midnight', () => {
    expect(parseTimeString('00:00')).toBe(0);
    expect(parseTimeString('17:30')).toBe(1050);
    expect(parseTimeString('23:59')).toBe(1439);
  });

  it('converts back, wrapping across days', () => {
    expect(minutesToTimeString(0)).toBe('00:00');
    expect(minutesToTimeString(1050)).toBe('17:30');
    expect(minutesToTimeString(1440)).toBe('00:00');
    expect(minutesToTimeString(1500)).toBe('01:00');
    expect(minutesToTimeString(-60)).toBe('23:00');
  });
});

describe('wall-clock to instant conversion', () => {
  it('uses the summer offset (IDT, UTC+3)', () => {
    expect(zonedTimeToInstant('2026-09-14', '18:00', TZ)?.toISOString()).toBe(
      '2026-09-14T15:00:00.000Z',
    );
  });

  it('uses the winter offset (IST, UTC+2)', () => {
    expect(zonedTimeToInstant('2026-12-14', '18:00', TZ)?.toISOString()).toBe(
      '2026-12-14T16:00:00.000Z',
    );
  });

  it('returns a plain Date that renders in UTC, not the zone offset', () => {
    const instant = zonedTimeToInstant('2026-09-14', '18:00', TZ);
    expect(instant?.toISOString().endsWith('Z')).toBe(true);
  });

  it('rejects an invalid date or time', () => {
    expect(zonedTimeToInstant('2026-02-30', '18:00', TZ)).toBeUndefined();
    expect(zonedTimeToInstant('2026-09-14', '25:00', TZ)).toBeUndefined();
  });

  it('round-trips back to the same wall-clock time', () => {
    for (const time of ['00:00', '08:15', '13:45', '23:59']) {
      const instant = zonedTimeToInstant('2026-09-14', time, TZ);
      expect(instant).toBeDefined();
      if (instant === undefined) continue;
      expect(instantToZonedTime(instant, TZ)).toEqual({ date: '2026-09-14', time });
    }
  });

  it('round-trips in winter too', () => {
    const instant = zonedTimeToInstant('2026-12-14', '08:15', TZ);
    expect(instant).toBeDefined();
    if (instant === undefined) return;
    expect(instantToZonedTime(instant, TZ)).toEqual({ date: '2026-12-14', time: '08:15' });
  });
});

describe('interval arithmetic', () => {
  it('adds absolute minutes', () => {
    const start = new Date('2026-09-14T15:00:00Z');
    expect(addMinutes(start, 90).toISOString()).toBe('2026-09-14T16:30:00.000Z');
  });

  it('measures the difference in minutes', () => {
    expect(
      differenceInMinutes(new Date('2026-09-14T16:30:00Z'), new Date('2026-09-14T15:00:00Z')),
    ).toBe(90);
  });

  it('crosses midnight correctly', () => {
    const start = new Date('2026-09-14T20:00:00Z'); // 23:00 Israel
    const end = addMinutes(start, 120);
    expect(instantToZonedTime(end, TZ)).toEqual({ date: '2026-09-15', time: '01:00' });
  });
});

describe('intervalsOverlap', () => {
  const make = (startHour: number, endHour: number) => ({
    start: new Date(Date.UTC(2026, 8, 14, startHour)),
    end: new Date(Date.UTC(2026, 8, 14, endHour)),
  });

  it('is false when intervals only touch', () => {
    expect(intervalsOverlap(make(17, 18), make(18, 19))).toBe(false);
    expect(intervalsOverlap(make(18, 19), make(17, 18))).toBe(false);
  });

  it('is true for a partial overlap in either direction', () => {
    expect(intervalsOverlap(make(17, 19), make(18, 20))).toBe(true);
    expect(intervalsOverlap(make(18, 20), make(17, 19))).toBe(true);
  });

  it('is true for identical intervals', () => {
    expect(intervalsOverlap(make(17, 18), make(17, 18))).toBe(true);
  });

  it('is true when one contains the other, either way round', () => {
    expect(intervalsOverlap(make(17, 20), make(18, 19))).toBe(true);
    expect(intervalsOverlap(make(18, 19), make(17, 20))).toBe(true);
  });

  it('is false for clearly separate intervals', () => {
    expect(intervalsOverlap(make(9, 10), make(17, 18))).toBe(false);
  });
});

describe('dayBoundsInZone', () => {
  it('spans local midnight to local midnight', () => {
    const bounds = dayBoundsInZone('2026-09-14', TZ);
    expect(bounds?.start.toISOString()).toBe('2026-09-13T21:00:00.000Z');
    expect(bounds?.end.toISOString()).toBe('2026-09-14T21:00:00.000Z');
  });

  it('is 24 hours long on an ordinary day', () => {
    const bounds = dayBoundsInZone('2026-09-14', TZ);
    expect(bounds).toBeDefined();
    if (bounds === undefined) return;
    expect(differenceInMinutes(bounds.end, bounds.start)).toBe(1440);
  });

  it('rejects an invalid date', () => {
    expect(dayBoundsInZone('2026-02-30', TZ)).toBeUndefined();
  });
});

describe('addDaysToDateString', () => {
  it('adds days across a month boundary', () => {
    expect(addDaysToDateString('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('adds days across a year boundary', () => {
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap year', () => {
    expect(addDaysToDateString('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToDateString('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('adds whole calendar days across a DST transition', () => {
    expect(addDaysToDateString('2026-10-23', 3)).toBe('2026-10-26');
  });

  it('subtracts too', () => {
    expect(addDaysToDateString('2026-10-01', -1)).toBe('2026-09-30');
  });
});
