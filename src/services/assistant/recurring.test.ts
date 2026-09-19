import { describe, expect, it, vi } from 'vitest';
import { handleCommand } from './handleCommand';
import { respond } from './responder';
import { parseCommand } from '../parser';
import { findRecurrence } from '../parser/recurrence';
import { normalizeText, tokenize } from '../parser/normalize';
import { timed } from '../conflict/eventFixtures';
import { fixedClock } from '../../utils/clock';
import type { CalendarProvider, CreatedEvent } from '../calendar/CalendarProvider';
import type { CalendarEvent, StructuredEvent } from '../../types/calendar';

/** Sunday 2026-09-13, 12:00 Israel time. */
const CLOCK = fixedClock('2026-09-13T09:00:00Z');

function stubProvider(events: CalendarEvent[] = []) {
  const createEvent = vi.fn(
    async (event: StructuredEvent): Promise<CreatedEvent> => ({
      id: 'created-1',
      title: event.title,
      start: event.interval.start.toISOString(),
      end: event.interval.end.toISOString(),
    }),
  );
  const provider: CalendarProvider = {
    listEvents: vi.fn(async () => events),
    listEventsForDate: vi.fn(async () => events),
    createEvent,
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  };
  return { provider, createEvent };
}

async function say(text: string, events: CalendarEvent[] = []) {
  const stub = stubProvider(events);
  const outcome = await handleCommand(text, { provider: stub.provider, clock: CLOCK });
  return { outcome, reply: respond(outcome, CLOCK), ...stub };
}

const parse = (text: string) => parseCommand(text, CLOCK);
const recurrenceOf = (text: string) =>
  findRecurrence(tokenize(normalizeText(text)), new Set())?.recurrence;

describe('reading the rule', () => {
  it('reads כל יום שני as weekly on Monday', () => {
    expect(recurrenceOf('תקבע לי חוג כל יום שני בחמש אחר הצהריים לשעה')).toEqual({
      frequency: 'weekly',
      interval: 1,
      byWeekday: [1],
    });
  });

  it('reads several weekdays joined by ו', () => {
    expect(recurrenceOf('תקבע לי אימון כל יום שני ורביעי')).toEqual({
      frequency: 'weekly',
      interval: 1,
      byWeekday: [1, 3],
    });
  });

  it('reads כל יום as daily', () => {
    expect(recurrenceOf('תקבע לי אימון כל יום')).toEqual({ frequency: 'daily', interval: 1 });
  });

  it.each([
    ['כל יומיים', { frequency: 'daily', interval: 2 }],
    ['כל שבועיים', { frequency: 'weekly', interval: 2 }],
    ['כל חודשיים', { frequency: 'monthly', interval: 2 }],
    ['כל שבוע', { frequency: 'weekly', interval: 1 }],
    ['כל חודש', { frequency: 'monthly', interval: 1 }],
  ])('reads %s', (phrase, expected) => {
    expect(recurrenceOf(`תקבע לי אימון ${phrase}`)).toEqual(expected);
  });

  it('reads בשבת as Saturday', () => {
    expect(recurrenceOf('תקבע לי אימון כל שבת')?.byWeekday).toEqual([6]);
  });

  it('needs an explicit כל — a one-off can never become a series by accident', () => {
    expect(recurrenceOf('תקבע לי פגישה ביום שני בשמונה בערב')).toBeUndefined();
    expect(parse('תקבע לי פגישה מחר בשמונה בערב לשעה').recurrence).toBeUndefined();
  });

  it('does not read a bare שני as Monday', () => {
    // 'שני' is also the numeral two, so it still needs 'יום' in front.
    expect(recurrenceOf('תקבע לי אימון כל שני')).toBeUndefined();
  });
});

describe('the first occurrence still comes from the date', () => {
  it('starts on the coming Monday', () => {
    // The anchor is a Sunday, so 'כל יום שני' begins tomorrow.
    const parsed = parse('תקבע לי חוג כדורגל כל יום שני בחמש אחר הצהריים לשעה');
    expect(parsed.date).toBe('2026-09-14');
    expect(parsed.recurrence?.byWeekday).toEqual([1]);
  });

  it('honours an explicit start date', () => {
    const parsed = parse('תקבע לי אימון כל יום מחר בשבע בבוקר לשעה');
    expect(parsed.date).toBe('2026-09-14');
    expect(parsed.recurrence).toEqual({ frequency: 'daily', interval: 1 });
  });

  it('keeps the rule out of the title', () => {
    expect(parse('תקבע לי חוג כדורגל כל יום שני בחמש אחר הצהריים לשעה').title).toBe(
      'חוג כדורגל',
    );
    expect(parse('תקבע לי אימון כל יום שני ורביעי ב-07:00 לשעה').title).toBe('אימון');
  });
});

describe('what reaches Google', () => {
  it('sends an RRULE for a weekly series', async () => {
    const { createEvent } = await say('תקבע לי חוג כדורגל כל יום שני בחמש אחר הצהריים לשעה');

    expect(createEvent).toHaveBeenCalledOnce();
    expect(createEvent.mock.calls[0]?.[0]?.recurrence).toEqual({
      frequency: 'weekly',
      interval: 1,
      byWeekday: [1],
    });
  });

  it('sends no recurrence for a one-off', async () => {
    const { createEvent } = await say('תקבע לי פגישה מחר ב-18:00 לשעה');
    expect(createEvent.mock.calls[0]?.[0]?.recurrence).toBeUndefined();
  });
});

describe('the Hebrew reply says it repeats', () => {
  it('reports a weekly series', async () => {
    const { reply } = await say('תקבע לי חוג כדורגל כל יום שני בחמש אחר הצהריים לשעה');
    expect(reply).toBe('קבעתי חוג כדורגל כל יום שני בין 17:00 ל־18:00, החל ממחר.');
  });

  it('reports several weekdays', async () => {
    const { reply } = await say('תקבע לי אימון כל יום שני ורביעי ב-07:00 לשעה');
    expect(reply).toContain('כל יום שני ויום רביעי');
  });

  it('reports a daily series', async () => {
    const { reply } = await say('תקבע לי אימון כל יום מחר ב-07:00 לחצי שעה');
    expect(reply).toContain('כל יום');
  });

  it('reports an interval', async () => {
    const { reply } = await say('תקבע לי פגישה כל שבועיים מחר ב-10:00 לשעה');
    expect(reply).toContain('כל שבועיים');
  });

  it('never calls a one-off a series', async () => {
    const { reply } = await say('תקבע לי פגישה מחר ב-18:00 לשעה');
    expect(reply).not.toContain('כל ');
  });
});

describe('the existing rules still apply to a series', () => {
  it('refuses to guess an ambiguous hour', async () => {
    const { reply, createEvent } = await say('תקבע לי חוג כל יום שני בחמש לשעה');
    expect(createEvent).not.toHaveBeenCalled();
    expect(reply).toBe('בבוקר או בערב?');
  });

  it('still asks for a duration', async () => {
    const { reply, createEvent } = await say('תקבע לי חוג כל יום שני ב-17:00');
    expect(createEvent).not.toHaveBeenCalled();
    expect(reply).toBe('ולכמה זמן?');
  });

  it('refuses when the FIRST occurrence conflicts', async () => {
    const { reply, createEvent } = await say(
      'תקבע לי חוג כל יום שני בחמש אחר הצהריים לשעה',
      [timed('פגישה', '17:00', '18:00', { date: '2026-09-14' })],
    );

    expect(createEvent).not.toHaveBeenCalled();
    expect(reply).toContain('לא ניתן לקבוע');
  });
});
