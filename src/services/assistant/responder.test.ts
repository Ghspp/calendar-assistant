import { describe, expect, it } from 'vitest';
import { describeDate, describeTimeRange, respond } from './responder';
import { fixedClock } from '../../utils/clock';
import { TZ, interval, timed } from '../conflict/eventFixtures';
import { detectConflicts } from '../conflict/detectConflicts';
import { parseCommand } from '../parser';
import { validateEvent } from '../validation/validateEvent';
import type { StructuredEvent } from '../../types/calendar';

/** Sunday 2026-09-13, 12:00 Israel time. */
const CLOCK = fixedClock('2026-09-13T09:00:00Z');

function eventFor(text: string): StructuredEvent {
  const result = validateEvent(parseCommand(text, CLOCK), CLOCK);
  if (!result.ok) throw new Error(`fixture did not validate: ${text}`);
  return result.event;
}

describe('describeDate', () => {
  it.each([
    ['2026-09-13', 'היום'],
    ['2026-09-14', 'מחר'],
    ['2026-09-15', 'מחרתיים'],
  ])('%s is %s', (date, expected) => {
    expect(describeDate(date, CLOCK)).toBe(expected);
  });

  it('names a weekday within the coming week', () => {
    // 2026-09-18 is a Friday, five days after the Sunday anchor.
    expect(describeDate('2026-09-18', CLOCK)).toBe('ביום שישי');
    expect(describeDate('2026-09-19', CLOCK)).toBe('בשבת');
  });

  it('falls back to a numeric date beyond the coming week', () => {
    // 'ביום שלישי' three weeks out would be genuinely ambiguous.
    expect(describeDate('2026-10-06', CLOCK)).toBe('ב־06.10');
  });

  it('handles a date in a later year', () => {
    expect(describeDate('2027-01-05', CLOCK)).toBe('ב־05.01');
  });
});

describe('describeTimeRange', () => {
  it('reads as Hebrew with a maqaf', () => {
    expect(describeTimeRange('18:00', '19:00')).toBe('בין 18:00 ל־19:00');
  });
});

describe('success messages', () => {
  it('matches the wording from the specification', () => {
    const event = eventFor('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');
    const message = respond(
      {
        kind: 'created',
        event,
        created: { id: 'x', title: event.title, start: '', end: '' },
        informational: [],
      },
      CLOCK,
    );
    expect(message).toBe('קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00.');
  });

  it('handles the football example', () => {
    const event = eventFor('תקבע לי חוג כדורגל מחר בחמש אחר הצהריים לשעה');
    const message = respond(
      {
        kind: 'created',
        event,
        created: { id: 'x', title: event.title, start: '', end: '' },
        informational: [],
      },
      CLOCK,
    );
    expect(message).toBe('קבעתי חוג כדורגל מחר בין 17:00 ל־18:00.');
  });

  it('adds a note about an overlapping all-day event', () => {
    const event = eventFor('תקבע לי פגישה מחר בשש בערב לשעה');
    const message = respond(
      {
        kind: 'created',
        event,
        created: { id: 'x', title: event.title, start: '', end: '' },
        informational: [
          {
            kind: 'allDay',
            id: 'h',
            title: 'חופשה',
            startDate: '2026-09-14',
            endDateExclusive: '2026-09-15',
          },
        ],
      },
      CLOCK,
    );
    expect(message).toContain('שים לב שיש לך גם חופשה באותו יום.');
  });
});

describe('conflict messages', () => {
  it('matches the wording from the specification', () => {
    const event = eventFor('תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה');
    const report = detectConflicts(
      event.interval,
      [timed('חוג כדורגל', '17:00', '18:00')],
      TZ,
    );

    const message = respond({ kind: 'conflict', event, conflicts: report.conflicts }, CLOCK);
    expect(message).toBe(
      'לא ניתן לקבוע את פגישה ב־17:30־18:30 כי יש לך חוג כדורגל בין 17:00 ל־18:00.',
    );
  });

  it('lists several conflicts', () => {
    const event = eventFor('תקבע לי פגישה מחר ב-16:00 לשלוש שעות');
    const report = detectConflicts(
      event.interval,
      [timed('חוג כדורגל', '17:00', '18:00'), timed('שיעור נהיגה', '18:00', '19:00')],
      TZ,
    );

    const message = respond({ kind: 'conflict', event, conflicts: report.conflicts }, CLOCK);
    expect(message).toContain('חוג כדורגל 17:00־18:00');
    expect(message).toContain('שיעור נהיגה 18:00־19:00');
  });

  it('reports conflict times in Israel local time, not UTC', () => {
    const event = eventFor('תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה');
    const report = detectConflicts(
      event.interval,
      [
        {
          kind: 'timed',
          id: 'utc',
          title: 'ישיבה',
          // 14:00Z is 17:00 Israel in September.
          start: '2026-09-14T14:00:00Z',
          end: '2026-09-14T15:00:00Z',
        },
      ],
      TZ,
    );

    expect(respond({ kind: 'conflict', event, conflicts: report.conflicts }, CLOCK)).toContain(
      'בין 17:00 ל־18:00',
    );
  });
});

describe('question messages', () => {
  it('asks only the first question, not all of them at once', () => {
    const parsed = parseCommand('תקבע לי פגישה עם דניאל', CLOCK);
    const validation = validateEvent(parsed, CLOCK);
    if (validation.ok) throw new Error('expected validation to fail');

    const message = respond({ kind: 'needs-input', parsed, errors: validation.errors }, CLOCK);
    expect(message).toBe('באיזה תאריך לקבוע?');
  });

  it('asks the disambiguating question for an unresolved hour', () => {
    const parsed = parseCommand('תקבע לי פגישה עם דניאל מחר בשש לשעה', CLOCK);
    const validation = validateEvent(parsed, CLOCK);
    if (validation.ok) throw new Error('expected validation to fail');

    expect(respond({ kind: 'needs-input', parsed, errors: validation.errors }, CLOCK)).toBe(
      'בבוקר או בערב?',
    );
  });
});

describe('unsupported intents', () => {
  it('offers an example for an unrecognised command', () => {
    const parsed = parseCommand('שלום מה שלומך', CLOCK);
    expect(respond({ kind: 'unsupported', parsed }, CLOCK)).toContain('תקבע לי פגישה');
  });
});

describe('failure messages', () => {
  it('passes the Hebrew message straight through', () => {
    expect(
      respond({ kind: 'failed', errorKind: 'network', message: 'אין חיבור.' }, CLOCK),
    ).toBe('אין חיבור.');
  });
});

describe('purity', () => {
  it('produces the same string for the same input', () => {
    const event = eventFor('תקבע לי פגישה מחר בשש בערב לשעה');
    const outcome = {
      kind: 'created' as const,
      event,
      created: { id: 'x', title: event.title, start: '', end: '' },
      informational: [],
    };
    expect(respond(outcome, CLOCK)).toBe(respond(outcome, CLOCK));
  });

  it('does not depend on the interval object identity', () => {
    const event = eventFor('תקבע לי פגישה מחר בשש בערב לשעה');
    const report = detectConflicts(interval('18:00', '19:00'), [], TZ);
    expect(report.hasConflict).toBe(false);
    expect(respond({ kind: 'conflict', event, conflicts: [] }, CLOCK)).toContain('לא ניתן');
  });
});
