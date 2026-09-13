import { describe, expect, it, vi } from 'vitest';
import { handleCommand } from './handleCommand';
import { respond } from './responder';
import { TZ, timed } from '../conflict/eventFixtures';
import { fixedClock } from '../../utils/clock';
import { calendarError } from '../calendar/errors';
import type { CalendarProvider, CreatedEvent } from '../calendar/CalendarProvider';
import type { CalendarEvent, StructuredEvent } from '../../types/calendar';

/**
 * The provider is always a stub here. No test in this file can write to a real
 * calendar — `createEvent` is a spy that records what it was asked to do.
 */

const CLOCK = fixedClock('2026-09-13T09:00:00Z'); // Sunday, 12:00 Israel
const TOMORROW = '2026-09-14';

function stubProvider(events: CalendarEvent[] = []) {
  const createEvent = vi.fn(
    async (event: StructuredEvent): Promise<CreatedEvent> => ({
      id: 'created-1',
      htmlLink: 'https://calendar.google.com/event?eid=abc',
      title: event.title,
      start: event.interval.start.toISOString(),
      end: event.interval.end.toISOString(),
    }),
  );

  const listEventsForDate = vi.fn(async () => events);

  const provider: CalendarProvider = {
    listEvents: vi.fn(async () => events),
    listEventsForDate,
    createEvent,
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  };

  return { provider, createEvent, listEventsForDate };
}

function run(text: string, events: CalendarEvent[] = []) {
  const stub = stubProvider(events);
  return handleCommand(text, { provider: stub.provider, clock: CLOCK }).then((outcome) => ({
    outcome,
    ...stub,
  }));
}

describe('creating an event in a free slot', () => {
  it('writes the event', async () => {
    const { outcome, createEvent } = await run('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');

    expect(outcome.kind).toBe('created');
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it('passes the fully resolved event to the provider', async () => {
    const { createEvent } = await run('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');
    const written = createEvent.mock.calls[0]?.[0];

    expect(written).toMatchObject({
      title: 'פגישה עם דניאל',
      date: TOMORROW,
      startTime: '18:00',
      endTime: '19:00',
      durationMinutes: 60,
      timeZone: TZ,
    });
    // 18:00 Israel in September is 15:00 UTC.
    expect(written?.interval.start.toISOString()).toBe('2026-09-14T15:00:00.000Z');
  });

  it('answers in Hebrew', async () => {
    const { outcome } = await run('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');
    expect(respond(outcome, CLOCK)).toBe('קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00.');
  });

  it('checks the calendar before writing', async () => {
    const { listEventsForDate, createEvent } = await run(
      'תקבע לי פגישה מחר בשש בערב לשעה',
    );
    expect(listEventsForDate).toHaveBeenCalledWith(TOMORROW);
    expect(listEventsForDate.mock.invocationCallOrder[0]).toBeLessThan(
      createEvent.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('allows an event that merely touches an existing one', async () => {
    const { outcome, createEvent } = await run('תקבע לי פגישה מחר בשש בערב לשעה', [
      timed('חוג כדורגל', '17:00', '18:00'),
    ]);
    expect(outcome.kind).toBe('created');
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it('mentions an overlapping all-day event without refusing', async () => {
    const { outcome } = await run('תקבע לי פגישה מחר בשש בערב לשעה', [
      { kind: 'allDay', id: 'h', title: 'חופשה', startDate: TOMORROW, endDateExclusive: '2026-09-15' },
    ]);
    expect(outcome.kind).toBe('created');
    expect(respond(outcome, CLOCK)).toContain('שים לב שיש לך גם חופשה');
  });
});

describe('refusing on a conflict', () => {
  const football = [timed('חוג כדורגל', '17:00', '18:00')];

  it('WRITES NOTHING when the slot is taken', async () => {
    const { outcome, createEvent } = await run(
      'תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה',
      football,
    );
    expect(outcome.kind).toBe('conflict');
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('names the conflicting event in Hebrew', async () => {
    const { outcome } = await run('תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה', football);
    expect(respond(outcome, CLOCK)).toBe(
      'לא ניתן לקבוע את פגישה ב־17:30־18:30 כי יש לך חוג כדורגל בין 17:00 ל־18:00.',
    );
  });

  it.each([
    ['partial overlap', 'תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה'],
    ['exact duplicate', 'תקבע לי פגישה מחר בחמש אחר הצהריים לשעה'],
    ['contained', 'תקבע לי פגישה מחר ב-17:15 לרבע שעה'],
    ['containing', 'תקבע לי פגישה מחר ב-16:00 לשלוש שעות'],
  ])('refuses a %s', async (_label, text) => {
    const { outcome, createEvent } = await run(text, football);
    expect(outcome.kind).toBe('conflict');
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('lists every conflict when several overlap', async () => {
    const { outcome } = await run('תקבע לי פגישה מחר ב-16:00 לשלוש שעות', [
      timed('חוג כדורגל', '17:00', '18:00'),
      timed('שיעור נהיגה', '18:00', '19:00'),
    ]);
    expect(outcome.kind).toBe('conflict');
    if (outcome.kind !== 'conflict') return;
    expect(outcome.conflicts).toHaveLength(2);
    expect(respond(outcome, CLOCK)).toContain('שיעור נהיגה');
  });

  it('never offers to move the event somewhere else', async () => {
    const { outcome } = await run('תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה', football);
    const message = respond(outcome, CLOCK);
    expect(message).not.toContain('רוצה');
    expect(message).not.toContain('במקום');
  });

  it('ignores a cancelled event and creates normally', async () => {
    const { outcome, createEvent } = await run('תקבע לי פגישה מחר בחמש אחר הצהריים לשעה', [
      timed('מבוטל', '17:00', '18:00', { status: 'cancelled' }),
    ]);
    expect(outcome.kind).toBe('created');
    expect(createEvent).toHaveBeenCalledOnce();
  });
});

describe('refusing before any network call', () => {
  it('WRITES NOTHING and asks the question when the hour is ambiguous', async () => {
    const { outcome, createEvent, listEventsForDate } = await run(
      'תקבע לי פגישה עם דניאל מחר בשש לשעה',
    );

    expect(outcome.kind).toBe('needs-input');
    expect(createEvent).not.toHaveBeenCalled();
    // Nothing to look up until we know what was asked for.
    expect(listEventsForDate).not.toHaveBeenCalled();
    expect(respond(outcome, CLOCK)).toBe('בבוקר או בערב?');
  });

  it('asks for the duration when it is missing', async () => {
    const { outcome, createEvent } = await run('תקבע לי אימון מחר בשעה 17:00');
    expect(outcome.kind).toBe('needs-input');
    expect(createEvent).not.toHaveBeenCalled();
    expect(respond(outcome, CLOCK)).toBe('ולכמה זמן?');
  });

  it('asks for the hour when it is missing', async () => {
    const { outcome } = await run('תקבע לי פגישה עם דניאל מחר');
    expect(respond(outcome, CLOCK)).toBe('באיזו שעה לקבוע?');
  });

  it('refuses a time that has already passed', async () => {
    const { outcome, createEvent } = await run('תקבע לי פגישה היום ב-09:00 לשעה');
    expect(outcome.kind).toBe('needs-input');
    expect(createEvent).not.toHaveBeenCalled();
    expect(respond(outcome, CLOCK)).toBe('הזמן שביקשת כבר עבר.');
  });
});

describe('commands that are still not acted on', () => {
  it.each([['שלום מה שלומך', 'UNKNOWN']])(
    'declines %s without touching the calendar',
    async (text) => {
      const { outcome, createEvent, listEventsForDate } = await run(text);
      expect(outcome.kind).toBe('unsupported');
      expect(createEvent).not.toHaveBeenCalled();
      expect(listEventsForDate).not.toHaveBeenCalled();
    },
  );

  it('offers an example for something it cannot read', async () => {
    const { outcome } = await run('שלום מה שלומך');
    expect(respond(outcome, CLOCK)).toContain('תקבע לי פגישה');
  });
});

describe('read-only questions never write', () => {
  it.each([
    'מה יש לי מחר',
    'מצא לי שעה פנויה מחר',
    'אני פנוי מחר בשש',
    'מתי יש לי את הפגישה עם דניאל',
  ])('answers %s without creating anything', async (text) => {
    const { outcome, createEvent } = await run(text);
    expect(outcome.kind).not.toBe('unsupported');
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it('reports a lost connection without writing', async () => {
    const provider: CalendarProvider = {
      listEvents: vi.fn(),
      listEventsForDate: vi.fn(async () => {
        throw calendarError('network');
      }),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    };

    const outcome = await handleCommand('תקבע לי פגישה מחר בשש בערב לשעה', {
      provider,
      clock: CLOCK,
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.errorKind).toBe('network');
    expect(provider.createEvent).not.toHaveBeenCalled();
  });

  it('reports an expired session', async () => {
    const provider: CalendarProvider = {
      listEvents: vi.fn(),
      listEventsForDate: vi.fn(async () => {
        throw calendarError('not-authenticated');
      }),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    };

    const outcome = await handleCommand('תקבע לי פגישה מחר בשש בערב לשעה', {
      provider,
      clock: CLOCK,
    });
    expect(respond(outcome, CLOCK)).toBe('נדרשת התחברות ל-Google Calendar.');
  });

  it('reports a failure during the write itself', async () => {
    const { provider } = stubProvider();
    provider.createEvent = vi.fn(async () => {
      throw calendarError('permission-denied');
    });

    const outcome = await handleCommand('תקבע לי פגישה מחר בשש בערב לשעה', {
      provider,
      clock: CLOCK,
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.errorKind).toBe('permission-denied');
  });

  it('does not leak a raw error to the user', async () => {
    const { provider } = stubProvider();
    provider.listEventsForDate = vi.fn(async () => {
      throw new Error('TypeError: undefined is not a function');
    });

    const outcome = await handleCommand('תקבע לי פגישה מחר בשש בערב לשעה', {
      provider,
      clock: CLOCK,
    });
    expect(respond(outcome, CLOCK)).toBe('אירעה שגיאה בלתי צפויה.');
  });
});
