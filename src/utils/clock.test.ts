import { describe, expect, it } from 'vitest';
import { TZDate } from '@date-fns/tz';
import { APP_TIME_ZONE, fixedClock, mutableClock, systemClock } from './clock';

describe('fixedClock', () => {
  it('always reports the same instant', () => {
    const clock = fixedClock('2026-09-13T12:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-09-13T12:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-13T12:00:00.000Z');
  });

  it('defaults to the Israel time zone', () => {
    expect(fixedClock('2026-09-13T12:00:00Z').timeZone()).toBe('Asia/Jerusalem');
  });

  it('hands out copies so a caller cannot mutate the frozen instant', () => {
    const clock = fixedClock('2026-09-13T12:00:00Z');
    const first = clock.now();
    first.setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('rejects an unparseable instant rather than silently yielding Invalid Date', () => {
    expect(() => fixedClock('not-a-date')).toThrow(/invalid instant/i);
  });
});

describe('mutableClock', () => {
  it('advances by the requested amount', () => {
    const clock = mutableClock('2026-09-13T12:00:00Z');
    clock.advanceBy(90 * 60 * 1000);
    expect(clock.now().toISOString()).toBe('2026-09-13T13:30:00.000Z');
  });
});

describe('time zone handling', () => {
  // Guards the assumption the whole parser rests on: wall-clock times are resolved in
  // Israel local time, not in whatever zone the machine running the code happens to use.
  it('resolves a UTC instant to Israel wall-clock time (IDT, UTC+3)', () => {
    const clock = fixedClock('2026-09-13T15:00:00Z');
    const local = new TZDate(clock.now(), clock.timeZone());
    expect(local.getHours()).toBe(18);
  });

  it('handles the winter offset too (IST, UTC+2)', () => {
    const clock = fixedClock('2026-12-13T15:00:00Z');
    const local = new TZDate(clock.now(), clock.timeZone());
    expect(local.getHours()).toBe(17);
  });

  it('exposes Asia/Jerusalem as the app time zone', () => {
    expect(APP_TIME_ZONE).toBe('Asia/Jerusalem');
    expect(systemClock.timeZone()).toBe(APP_TIME_ZONE);
  });
});
