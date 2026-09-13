import { describe, expect, it, vi } from 'vitest';
import { handleTurn } from './handleTurn';
import { respond } from './responder';
import { parseCommand } from '../parser';
import { emptyConversation, type ConversationState } from '../conversation/ConversationManager';
import { timed } from '../conflict/eventFixtures';
import { fixedClock } from '../../utils/clock';
import type { CalendarProvider, CreatedEvent } from '../calendar/CalendarProvider';
import type { CalendarEvent, StructuredEvent } from '../../types/calendar';

/**
 * Two features from the original specification:
 *
 *   "תקבע את זה בזמן הפנוי הראשון"  — let the assistant pick the hour
 *   "אתה פנוי ב־19:00. רוצה שאקבע שם?" — offer an alternative after a conflict
 *
 * The safety property both share: the assistant never MOVES an event on its own. It
 * may compute an hour when asked to, and it may offer one — but an offer stays inert
 * until the user accepts it.
 */

const CLOCK = fixedClock('2026-09-13T09:00:00Z'); // Sunday, 12:00 Israel
const TOMORROW = '2026-09-14';

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

async function converse(turns: string[], events: CalendarEvent[] = []) {
  const { provider, createEvent } = stubProvider(events);
  let state: ConversationState = emptyConversation;
  const replies: string[] = [];

  for (const turn of turns) {
    const result = await handleTurn(turn, { provider, clock: CLOCK, state });
    state = result.state;
    replies.push(respond(result.outcome, CLOCK));
  }

  return { replies, createEvent, state };
}

describe('parsing the request', () => {
  it.each([
    'תקבע לי פגישה מחר בזמן הפנוי הראשון לשעה',
    'תקבע לי פגישה מחר בשעה הפנויה הראשונה לשעה',
    'תקבע לי פגישה מחר בחלון הפנוי הראשון לשעה',
    'תקבע לי פגישה מחר בזמן הפנוי לשעה',
  ])('recognises: %s', (text) => {
    const parsed = parseCommand(text, CLOCK);
    expect(parsed.useFirstFreeSlot).toBe(true);
    expect(parsed.missing).toEqual([]);
  });

  it('does not leave the phrase in the title', () => {
    const parsed = parseCommand('תקבע לי אימון מחר בזמן הפנוי הראשון לשעה', CLOCK);
    expect(parsed.title).toBe('אימון');
  });

  it('does not read בשעה הפנויה as the start of a clock time', () => {
    // 'בשעה' normally introduces an hour; the phrase has to win.
    const parsed = parseCommand('תקבע לי פגישה מחר בשעה הפנויה הראשונה לשעה', CLOCK);
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.ambiguities).toEqual([]);
  });

  it('leaves an ordinary command untouched', () => {
    expect(parseCommand('תקבע לי פגישה מחר ב-18:00 לשעה', CLOCK).useFirstFreeSlot).toBeUndefined();
  });
});

describe('booking the first free slot', () => {
  it('books at the start of the day when nothing is scheduled', async () => {
    const { createEvent, replies } = await converse([
      'תקבע לי פגישה עם דניאל מחר בזמן הפנוי הראשון לשעה',
    ]);

    expect(createEvent).toHaveBeenCalledOnce();
    expect(createEvent.mock.calls[0]?.[0]).toMatchObject({
      title: 'פגישה עם דניאל',
      date: TOMORROW,
      startTime: '08:00',
      durationMinutes: 60,
    });
    expect(replies[0]).toBe('קבעתי פגישה עם דניאל מחר בין 08:00 ל־09:00.');
  });

  it('skips over an existing event', async () => {
    const { createEvent } = await converse(
      ['תקבע לי פגישה מחר בזמן הפנוי הראשון לשעתיים'],
      [timed('חוג כדורגל', '08:00', '09:30')],
    );
    expect(createEvent.mock.calls[0]?.[0]?.startTime).toBe('09:30');
  });

  it('finds a gap between two events', async () => {
    const { createEvent } = await converse(
      ['תקבע לי פגישה מחר בזמן הפנוי הראשון לשעה'],
      [timed('א', '08:00', '10:00'), timed('ב', '11:00', '20:00')],
    );
    expect(createEvent.mock.calls[0]?.[0]?.startTime).toBe('10:00');
  });

  it('does not use a gap that is too short', async () => {
    const { createEvent } = await converse(
      ['תקבע לי פגישה מחר בזמן הפנוי הראשון לשעתיים'],
      [timed('א', '08:00', '10:00'), timed('ב', '11:00', '14:00')],
    );
    // The 10:00-11:00 gap cannot hold two hours.
    expect(createEvent.mock.calls[0]?.[0]?.startTime).toBe('14:00');
  });

  it('WRITES NOTHING when the day is full', async () => {
    const { createEvent, replies } = await converse(
      ['תקבע לי פגישה מחר בזמן הפנוי הראשון לשעה'],
      [timed('יום שלם', '08:00', '22:00')],
    );

    expect(createEvent).not.toHaveBeenCalled();
    expect(replies[0]).toBe('לא מצאתי שעה פנויה מחר.');
  });

  it('still asks for a duration, which it cannot invent', async () => {
    const { createEvent, replies } = await converse([
      'תקבע לי פגישה מחר בזמן הפנוי הראשון',
    ]);
    expect(createEvent).not.toHaveBeenCalled();
    expect(replies[0]).toBe('ולכמה זמן?');
  });

  it('ignores a cancelled event when looking for a gap', async () => {
    const { createEvent } = await converse(
      ['תקבע לי פגישה מחר בזמן הפנוי הראשון לשעה'],
      [timed('מבוטל', '08:00', '12:00', { status: 'cancelled' })],
    );
    expect(createEvent.mock.calls[0]?.[0]?.startTime).toBe('08:00');
  });
});

describe('offering an alternative after a conflict', () => {
  const football = [timed('חוג כדורגל', '17:00', '18:00')];

  it('suggests the next free slot without taking it', async () => {
    const { replies, createEvent } = await converse(
      ['תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה'],
      football,
    );

    expect(createEvent).not.toHaveBeenCalled();
    expect(replies[0]).toContain('אתה פנוי ב־18:00');
    expect(replies[0]).toContain('רוצה שאקבע שם?');
  });

  it('books it on a yes', async () => {
    const { replies, createEvent } = await converse(
      ['תקבע לי פגישה עם דניאל מחר בחמש וחצי אחר הצהריים לשעה', 'כן'],
      football,
    );

    expect(createEvent).toHaveBeenCalledOnce();
    expect(createEvent.mock.calls[0]?.[0]).toMatchObject({
      title: 'פגישה עם דניאל',
      startTime: '18:00',
      durationMinutes: 60,
    });
    expect(replies[1]).toBe('קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00.');
  });

  it('WRITES NOTHING on a no', async () => {
    const { replies, createEvent, state } = await converse(
      ['תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה', 'לא'],
      football,
    );

    expect(createEvent).not.toHaveBeenCalled();
    expect(replies[1]).toBe('בסדר, לא קבעתי כלום.');
    expect(state.action).toBeUndefined();
  });

  it('re-asks rather than treating an unclear answer as acceptance', async () => {
    const { replies, createEvent } = await converse(
      ['תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה', 'אמממ'],
      football,
    );
    expect(createEvent).not.toHaveBeenCalled();
    expect(replies[1]).toContain('לקבוע ב');
  });

  it('lets a new command replace the offer', async () => {
    const { createEvent } = await converse(
      [
        'תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה',
        'תקבע לי אימון מחר ב-08:00 לשעה',
      ],
      football,
    );
    expect(createEvent.mock.calls[0]?.[0]?.title).toBe('אימון');
  });

  it('re-checks the calendar before booking the accepted slot', async () => {
    // The offer was computed a moment ago; the slot must be verified again, not
    // trusted, in case something was added in between.
    const { provider, createEvent } = stubProvider(football);
    let state: ConversationState = emptyConversation;

    const first = await handleTurn('תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה', {
      provider,
      clock: CLOCK,
      state,
    });
    state = first.state;

    const callsBefore = (provider.listEventsForDate as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await handleTurn('כן', { provider, clock: CLOCK, state });

    expect(
      (provider.listEventsForDate as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(callsBefore);
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it('makes no suggestion when the day has no room', async () => {
    const { replies } = await converse(
      ['תקבע לי פגישה מחר בחמש וחצי אחר הצהריים לשעה'],
      [timed('יום שלם', '08:00', '22:00')],
    );
    expect(replies[0]).toContain('לא ניתן לקבוע');
    expect(replies[0]).not.toContain('רוצה שאקבע שם?');
  });
});
