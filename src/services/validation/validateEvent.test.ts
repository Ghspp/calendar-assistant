import { describe, expect, it } from 'vitest';
import { validateEvent } from './validateEvent';
import { parseCommand } from '../parser';
import { detectConflicts } from '../conflict/detectConflicts';
import { TZ, timed } from '../conflict/eventFixtures';
import { fixedClock } from '../../utils/clock';
import { instantToZonedTime } from '../../utils/time';
import type { ParsedCommand } from '../../types/parser';

/** Sunday 2026-09-13, 12:00 Israel time. */
const CLOCK = fixedClock('2026-09-13T09:00:00Z');

/** Build a ParsedCommand directly, for shapes the parser cannot produce. */
function command(overrides: Partial<ParsedCommand> = {}): ParsedCommand {
  return {
    intent: 'CREATE',
    missing: [],
    ambiguities: [],
    confidence: 1,
    rawText: '',
    normalizedText: '',
    ...overrides,
  };
}

function validateText(text: string) {
  return validateEvent(parseCommand(text, CLOCK), CLOCK);
}

describe('the ambiguity gate', () => {
  it('REJECTS an unresolved hour, so it can never become an event', () => {
    const result = validateText('תקבע לי פגישה עם דניאל מחר בשש לשעה');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('AMBIGUOUS_TIME');
  });

  it('carries the Hebrew question and both readings back to the caller', () => {
    const result = validateText('תקבע לי פגישה עם דניאל מחר בשש לשעה');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toBe('בבוקר או בערב?');
    expect(result.errors[0]?.candidates).toEqual(['06:00', '18:00']);
  });

  it('ACCEPTS zero-padded HH:mm notation without a question', () => {
    const result = validateText('תקבע לי פגישה עם דניאל מחר ב-09:00 לשעה');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.startTime).toBe('09:00');
    expect(result.event.endTime).toBe('10:00');
  });

  it('STILL rejects the one-digit colon form', () => {
    const result = validateText('תקבע לי פגישה עם דניאל מחר ב-9:00 לשעה');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('AMBIGUOUS_TIME');
    expect(result.errors[0]?.candidates).toEqual(['09:00', '21:00']);
  });

  it('ACCEPTS the same command once the hour is disambiguated', () => {
    const result = validateText('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.startTime).toBe('18:00');
    expect(result.event.endTime).toBe('19:00');
  });

  it.each([
    'תקבע לי פגישה מחר בשמונה לשעה',
    'תקבע לי פגישה מחר ב-6 לשעה',
    'תקבע לי פגישה מחר ב-6:30 לשעה',
    'תקבע לי פגישה מחר ב-9:00 לשעה',
    'תקבע לי פגישה מחר בשתים עשרה לשעה',
  ])('rejects %s', (text) => {
    const result = validateText(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === 'AMBIGUOUS_TIME')).toBe(true);
  });

  it('reports ambiguity before complaining about anything else', () => {
    // A missing duration must not drown out the question that actually blocks progress.
    const result = validateText('תקבע לי פגישה מחר בשש');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe('AMBIGUOUS_TIME');
  });
});

describe('missing slots', () => {
  it('asks for the hour and duration when only a date was given', () => {
    const result = validateText('תקבע לי פגישה עם דניאל מחר');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.slot)).toEqual(['startTime', 'duration']);
    expect(result.errors[0]?.message).toBe('באיזו שעה לקבוע?');
    expect(result.errors[1]?.message).toBe('ולכמה זמן?');
  });

  it('asks for the duration when everything else is known', () => {
    const result = validateText('תקבע לי אימון מחר בשעה 17:00');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.slot).toBe('duration');
  });

  it('asks for a date when none was given', () => {
    const result = validateText('תקבע לי פגישה בשעה 17:00 לשעה');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.slot === 'date')).toBe(true);
  });
});

describe('field validation', () => {
  it('rejects an impossible calendar date', () => {
    const result = validateEvent(
      command({
        title: 'פגישה',
        date: '2026-02-30',
        startTime: '17:00',
        durationMinutes: 60,
      }),
      CLOCK,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('INVALID_DATE');
  });

  it('rejects a malformed date', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '14/09/2026', startTime: '17:00', durationMinutes: 60 }),
      CLOCK,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('INVALID_DATE');
  });

  it('rejects an out-of-range hour', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '2026-09-14', startTime: '25:00', durationMinutes: 60 }),
      CLOCK,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('INVALID_TIME');
  });

  it('rejects an out-of-range minute', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '2026-09-14', startTime: '17:60', durationMinutes: 60 }),
      CLOCK,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('INVALID_TIME');
  });

  it('accepts a leap day in a leap year', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '2028-02-29', startTime: '17:00', durationMinutes: 60 }),
      CLOCK,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a leap day in a common year', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '2027-02-29', startTime: '17:00', durationMinutes: 60 }),
      CLOCK,
    );
    expect(result.ok).toBe(false);
  });
});

describe('duration validation', () => {
  it('rejects a zero duration', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '2026-09-14', startTime: '17:00', durationMinutes: 0 }),
      CLOCK,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('INVALID_DURATION');
  });

  it('rejects a negative duration', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '2026-09-14', startTime: '17:00', durationMinutes: -30 }),
      CLOCK,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('INVALID_DURATION');
  });

  it('rejects a duration longer than a day', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '2026-09-14', startTime: '17:00', durationMinutes: 1441 }),
      CLOCK,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('INVALID_DURATION');
  });

  it('accepts a duration of exactly one day', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '2026-09-14', startTime: '00:00', durationMinutes: 1440 }),
      CLOCK,
    );
    expect(result.ok).toBe(true);
  });

  it('derives the duration from an end time', () => {
    const result = validateEvent(
      command({
        title: 'פגישה',
        date: '2026-09-14',
        startTime: '10:00',
        endTime: '11:30',
      }),
      CLOCK,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.durationMinutes).toBe(90);
  });

  it('wraps an end time that crosses midnight', () => {
    // 23:00 until 01:00 is two hours, not minus twenty-two.
    const result = validateEvent(
      command({
        title: 'פגישה',
        date: '2026-09-14',
        startTime: '23:00',
        endTime: '01:00',
      }),
      CLOCK,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.durationMinutes).toBe(120);
    expect(result.event.endTime).toBe('01:00');
  });
});

describe('past times', () => {
  it('rejects a time that has already passed', () => {
    // The clock reads 12:00 on 2026-09-13.
    const result = validateEvent(
      command({ title: 'פגישה', date: '2026-09-13', startTime: '09:00', durationMinutes: 60 }),
      CLOCK,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('TIME_IN_PAST');
  });

  it('accepts a time later today', () => {
    const result = validateEvent(
      command({ title: 'פגישה', date: '2026-09-13', startTime: '18:00', durationMinutes: 60 }),
      CLOCK,
    );
    expect(result.ok).toBe(true);
  });

  it('catches the weekday-means-today case with a clear error', () => {
    // 'ביום ראשון' on a Sunday resolves to today, which may already have passed.
    const morning = fixedClock('2026-09-13T15:00:00Z'); // 18:00 Israel
    const result = validateEvent(
      parseCommand('שים לי פגישה ביום ראשון ב-10 בבוקר עד 11', morning),
      morning,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('TIME_IN_PAST');
    expect(result.errors[0]?.message).toBe('הזמן שביקשת כבר עבר.');
  });
});

describe('intent scope', () => {
  it.each(['QUERY', 'DELETE', 'UPDATE', 'FIND_FREE', 'UNKNOWN'] as const)(
    'refuses to validate a %s command as a new event',
    (intent) => {
      const result = validateEvent(command({ intent }), CLOCK);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0]?.code).toBe('UNSUPPORTED_INTENT');
    },
  );
});

describe('successful validation', () => {
  it('produces a complete structured event', () => {
    const result = validateText('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({
      title: 'פגישה עם דניאל',
      date: '2026-09-14',
      startTime: '18:00',
      endTime: '19:00',
      durationMinutes: 60,
      timeZone: TZ,
    });
  });

  it('resolves the interval to the correct absolute instants', () => {
    const result = validateText('תקבע לי פגישה מחר בשש בערב לשעה');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 18:00 Israel in September is 15:00 UTC.
    expect(result.event.interval.start.toISOString()).toBe('2026-09-14T15:00:00.000Z');
    expect(result.event.interval.end.toISOString()).toBe('2026-09-14T16:00:00.000Z');
  });

  it('resolves the interval correctly in winter', () => {
    const winterClock = fixedClock('2026-12-13T09:00:00Z');
    const result = validateEvent(
      parseCommand('תקבע לי פגישה מחר בשש בערב לשעה', winterClock),
      winterClock,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 18:00 Israel in December is 16:00 UTC.
    expect(result.event.interval.start.toISOString()).toBe('2026-12-14T16:00:00.000Z');
  });

  it('round-trips the interval back to the requested wall-clock time', () => {
    const result = validateText('תקבע לי פגישה מחר בשש בערב לשעה');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const local = instantToZonedTime(result.event.interval.start, TZ);
    expect(local).toEqual({ date: '2026-09-14', time: '18:00' });
  });
});

describe('the full pipeline: Hebrew text to accept or reject', () => {
  const football = timed('חוג כדורגל', '17:00', '18:00');

  function run(text: string) {
    const parsed = parseCommand(text, CLOCK);
    const validation = validateEvent(parsed, CLOCK);
    if (!validation.ok) return { stage: 'validation' as const, validation };
    const conflicts = detectConflicts(validation.event.interval, [football], TZ);
    return { stage: 'conflict' as const, validation, conflicts };
  }

  it('creates an event in a free slot', () => {
    const result = run('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');
    expect(result.stage).toBe('conflict');
    if (result.stage !== 'conflict') return;
    expect(result.conflicts.hasConflict).toBe(false);
  });

  it('blocks an event that overlaps the football class', () => {
    const result = run('תקבע לי פגישה עם דניאל מחר בחמש וחצי אחר הצהריים לשעה');
    expect(result.stage).toBe('conflict');
    if (result.stage !== 'conflict') return;
    expect(result.conflicts.hasConflict).toBe(true);
    expect(result.conflicts.conflicts[0]?.event.title).toBe('חוג כדורגל');
  });

  it('allows an event that starts exactly when the class ends', () => {
    const result = run('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');
    expect(result.stage).toBe('conflict');
    if (result.stage !== 'conflict') return;
    expect(result.conflicts.hasConflict).toBe(false);
  });

  it('never reaches conflict detection while the hour is ambiguous', () => {
    const result = run('תקבע לי פגישה עם דניאל מחר בשש לשעה');
    expect(result.stage).toBe('validation');
  });
});
