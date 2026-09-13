import { describe, expect, it } from 'vitest';
import { parseCommand } from './index';
import { fixedClock } from '../../utils/clock';

/**
 * Anchor: Sunday 2026-09-13, 12:00 Israel local time (09:00 UTC, IDT = UTC+3).
 * Sunday is weekday 0, which makes the weekday offsets easy to read.
 */
const SUNDAY_NOON = fixedClock('2026-09-13T09:00:00Z');

function dateOf(text: string, clock = SUNDAY_NOON): string | undefined {
  return parseCommand(text, clock).date;
}

describe('relative days', () => {
  it('parses היום', () => {
    expect(dateOf('מה יש לי היום')).toBe('2026-09-13');
  });

  it('parses מחר', () => {
    expect(dateOf('תקבע לי פגישה מחר')).toBe('2026-09-14');
  });

  it('parses מחרתיים', () => {
    expect(dateOf('תקבע לי פגישה מחרתיים')).toBe('2026-09-15');
  });

  it('parses מחר carrying a ל particle', () => {
    expect(dateOf('העבר את הפגישה למחר')).toBe('2026-09-14');
  });

  it('does not mistake מחר for a מ-prefixed word', () => {
    // 'מחר' starts with the particle מ; the untouched form must win.
    expect(dateOf('מחר')).toBe('2026-09-14');
  });
});

describe('weekdays', () => {
  it('parses ביום שישי as the coming Friday', () => {
    expect(dateOf('תקבע לי פגישה ביום שישי')).toBe('2026-09-18');
  });

  it('parses בשבת', () => {
    expect(dateOf('תקבע לי פגישה בשבת')).toBe('2026-09-19');
  });

  it('parses ביום שני', () => {
    expect(dateOf('תקבע לי פגישה ביום שני')).toBe('2026-09-14');
  });

  it('parses ביום רביעי', () => {
    expect(dateOf('תקבע לי פגישה ביום רביעי')).toBe('2026-09-16');
  });

  it('treats today as a match for its own weekday', () => {
    // The anchor is a Sunday, so 'ביום ראשון' means today, not next week.
    expect(dateOf('תקבע לי פגישה ביום ראשון')).toBe('2026-09-13');
  });

  it('rolls over into the next week', () => {
    const tuesday = fixedClock('2026-09-15T09:00:00Z');
    expect(dateOf('תקבע לי פגישה ביום שני', tuesday)).toBe('2026-09-21');
  });

  it('does not read a bare שני as Monday', () => {
    // 'שני' is also the numeral 2, so it needs an explicit 'יום' to count as a weekday.
    expect(dateOf('תקבע לי פגישה שני')).toBeUndefined();
  });

  it('accepts an unambiguous weekday without יום', () => {
    expect(dateOf('תקבע לי פגישה בשישי')).toBe('2026-09-18');
  });
});

describe('בעוד expressions', () => {
  it('parses בעוד יומיים', () => {
    expect(dateOf('תקבע לי פגישה בעוד יומיים')).toBe('2026-09-15');
  });

  it('parses בעוד 3 ימים', () => {
    expect(dateOf('תקבע לי פגישה בעוד 3 ימים')).toBe('2026-09-16');
  });

  it('parses בעוד שלושה ימים', () => {
    expect(dateOf('תקבע לי פגישה בעוד שלושה ימים')).toBe('2026-09-16');
  });

  it('parses בעוד שבוע', () => {
    expect(dateOf('תקבע לי פגישה בעוד שבוע')).toBe('2026-09-20');
  });

  it('parses בעוד שבועיים', () => {
    expect(dateOf('תקבע לי פגישה בעוד שבועיים')).toBe('2026-09-27');
  });
});

describe('week scopes', () => {
  it('parses השבוע as the Sunday-to-Saturday week containing today', () => {
    const parsed = parseCommand('מה יש לי השבוע', SUNDAY_NOON);
    expect(parsed.dateRange).toEqual({ startDate: '2026-09-13', endDate: '2026-09-19' });
    expect(parsed.date).toBeUndefined();
  });

  it('parses שבוע הבא', () => {
    const parsed = parseCommand('מה יש לי שבוע הבא', SUNDAY_NOON);
    expect(parsed.dateRange).toEqual({ startDate: '2026-09-20', endDate: '2026-09-26' });
  });

  it('shifts a weekday into next week', () => {
    expect(dateOf('תקבע לי פגישה ביום שישי בשבוע הבא')).toBe('2026-09-25');
  });
});

describe('time zone correctness', () => {
  it('uses Israel local time, not UTC, to decide what day it is', () => {
    // 21:30 UTC is already 00:30 the next day in Israel (IDT, UTC+3).
    const lateEvening = fixedClock('2026-09-13T21:30:00Z');
    expect(dateOf('מה יש לי היום', lateEvening)).toBe('2026-09-14');
  });

  it('is still correct just before local midnight', () => {
    const beforeMidnight = fixedClock('2026-09-13T20:30:00Z');
    expect(dateOf('מה יש לי היום', beforeMidnight)).toBe('2026-09-13');
  });

  it('handles the winter offset (IST, UTC+2)', () => {
    const winter = fixedClock('2026-12-13T22:30:00Z');
    expect(dateOf('מה יש לי היום', winter)).toBe('2026-12-14');
  });

  it('adds whole calendar days across a DST transition', () => {
    // Israeli DST ends in late October. Pure calendar arithmetic must add exactly
    // three days regardless of the offset change in between.
    const beforeTransition = fixedClock('2026-10-23T09:00:00Z');
    expect(dateOf('תקבע לי פגישה בעוד 3 ימים', beforeTransition)).toBe('2026-10-26');
  });

  it('crosses a month boundary', () => {
    const endOfMonth = fixedClock('2026-09-30T09:00:00Z');
    expect(dateOf('תקבע לי פגישה מחר', endOfMonth)).toBe('2026-10-01');
  });

  it('crosses a year boundary', () => {
    const newYearsEve = fixedClock('2026-12-31T09:00:00Z');
    expect(dateOf('תקבע לי פגישה מחר', newYearsEve)).toBe('2027-01-01');
  });
});

describe('clock injection', () => {
  it('produces different dates for different clocks, proving the clock is used', () => {
    const a = dateOf('תקבע לי פגישה מחר', fixedClock('2026-09-13T09:00:00Z'));
    const b = dateOf('תקבע לי פגישה מחר', fixedClock('2027-03-01T09:00:00Z'));
    expect(a).toBe('2026-09-14');
    expect(b).toBe('2027-03-02');
  });
});
