import { describe, expect, it, vi } from 'vitest';
import { handleTurn, CANCELLED_MESSAGE } from './handleTurn';
import { respond } from './responder';
import { PENDING_TTL_MS, emptyConversation } from '../conversation/ConversationManager';
import { TZ, timed } from '../conflict/eventFixtures';
import { fixedClock, mutableClock } from '../../utils/clock';
import type { CalendarProvider, CreatedEvent } from '../calendar/CalendarProvider';
import type { CalendarEvent, StructuredEvent } from '../../types/calendar';
import type { ConversationState } from '../conversation/ConversationManager';

/** Sunday 2026-09-13, 12:00 Israel time. The provider is always a stub. */
const CLOCK = fixedClock('2026-09-13T09:00:00Z');
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

/** Drive a whole conversation, returning each reply plus what was written. */
async function converse(
  turns: string[],
  options: { events?: CalendarEvent[]; clock?: typeof CLOCK } = {},
) {
  const clock = options.clock ?? CLOCK;
  const { provider, createEvent } = stubProvider(options.events ?? []);

  let state: ConversationState = emptyConversation;
  const replies: string[] = [];

  for (const turn of turns) {
    const result = await handleTurn(turn, { provider, clock, state });
    state = result.state;
    replies.push(respond(result.outcome, clock));
  }

  return { replies, createEvent, state };
}

describe('the slot-filling conversation from the plan', () => {
  it('walks from a bare request to a created event', async () => {
    const { replies, createEvent } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'בשש',
      'בערב',
      'לשעה',
    ]);

    expect(replies).toEqual([
      'באיזו שעה לקבוע?',
      'בבוקר או בערב?',
      'ולכמה זמן?',
      'קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00.',
    ]);
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it('writes the event assembled across all four turns', async () => {
    const { createEvent } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'בשש',
      'בערב',
      'לשעה',
    ]);

    expect(createEvent.mock.calls[0]?.[0]).toMatchObject({
      title: 'פגישה עם דניאל',
      date: TOMORROW,
      startTime: '18:00',
      endTime: '19:00',
      durationMinutes: 60,
      timeZone: TZ,
    });
  });

  it('writes nothing until the very last turn', async () => {
    const { createEvent } = await converse(['תקבע לי פגישה עם דניאל מחר', 'בשש', 'בערב']);
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe('answering several questions at once', () => {
  it('accepts an hour and a day part together', async () => {
    const { replies, createEvent } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'בשש בערב',
      'לשעה',
    ]);
    expect(replies[1]).toBe('ולכמה זמן?');
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it('accepts hour, day part and duration in one answer', async () => {
    const { replies, createEvent } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'בשש בערב לשעה',
    ]);
    expect(replies[1]).toBe('קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00.');
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it('accepts an unambiguous hour, skipping the day-part question', async () => {
    const { replies } = await converse(['תקבע לי פגישה עם דניאל מחר', 'ב-18:00', 'לשעה']);
    expect(replies[1]).toBe('ולכמה זמן?');
  });
});

describe('answer forms', () => {
  it.each([
    ['בערב', '18:00'],
    ['ערב', '18:00'],
    ['בבוקר', '06:00'],
    ['בוקר', '06:00'],
    ['אחר הצהריים', '18:00'],
  ])('resolves the ambiguity from %s', async (answer, expected) => {
    const { createEvent } = await converse([
      'תקבע לי פגישה מחר',
      'בשש',
      answer,
      'לשעה',
    ]);
    expect(createEvent.mock.calls[0]?.[0]?.startTime).toBe(expected);
  });

  it.each([
    ['לשעה', 60],
    ['שעה', 60],
    ['שעתיים', 120],
    ['חצי שעה', 30],
    ['30 דקות', 30],
    ['שעה וחצי', 90],
  ])('reads the duration answer %s as %i minutes', async (answer, minutes) => {
    const { createEvent } = await converse([
      'תקבע לי פגישה מחר בשש בערב',
      answer,
    ]);
    expect(createEvent.mock.calls[0]?.[0]?.durationMinutes).toBe(minutes);
  });

  it.each([
    ['מחר', '2026-09-14'],
    ['ביום שישי', '2026-09-18'],
    ['מחרתיים', '2026-09-15'],
  ])('reads the date answer %s', async (answer, expected) => {
    const { createEvent } = await converse([
      'תקבע לי פגישה ב-18:00 לשעה',
      answer,
    ]);
    expect(createEvent.mock.calls[0]?.[0]?.date).toBe(expected);
  });

  it('takes a title answer literally', async () => {
    const { createEvent } = await converse([
      'תקבע לי מחר ב-18:00 לשעה',
      'פגישה עם דניאל',
    ]);
    expect(createEvent.mock.calls[0]?.[0]?.title).toBe('פגישה עם דניאל');
  });
});

describe('an answer never re-opens a resolved slot', () => {
  it('keeps the date established two turns earlier', async () => {
    const { createEvent } = await converse([
      'תקבע לי פגישה עם דניאל ביום שישי',
      'בשש',
      'בערב',
      'לשעה',
    ]);
    expect(createEvent.mock.calls[0]?.[0]?.date).toBe('2026-09-18');
  });

  it('keeps the title established in the first turn', async () => {
    const { createEvent } = await converse([
      'תקבע לי חוג כדורגל מחר',
      'בחמש',
      'אחר הצהריים',
      'לשעה',
    ]);
    expect(createEvent.mock.calls[0]?.[0]?.title).toBe('חוג כדורגל');
  });

  it('does not let a day-part answer disturb the duration', async () => {
    const { createEvent } = await converse([
      'תקבע לי פגישה מחר לשעתיים',
      'בשש',
      'בערב',
    ]);
    expect(createEvent.mock.calls[0]?.[0]?.durationMinutes).toBe(120);
  });

  it('re-asks when the restated hour is still ambiguous', async () => {
    const { replies } = await converse(['תקבע לי פגישה עם דניאל מחר', 'בשש', 'בשמונה']);
    expect(replies[2]).toBe('בבוקר או בערב?');
  });
});

describe('abandoning a request', () => {
  it('starts fresh when a new command arrives mid-conversation', async () => {
    const { replies, createEvent } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'תקבע לי אימון מחר ב-09:00 לשעה',
    ]);

    expect(replies[1]).toBe('קבעתי אימון מחר בין 09:00 ל־10:00.');
    expect(createEvent.mock.calls[0]?.[0]?.title).toBe('אימון');
  });

  it('does not fold a query into the pending request', async () => {
    // The query is answered on its own terms; it is not read as a title for the
    // half-finished meeting.
    const { replies, state, createEvent } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'מה יש לי מחר',
    ]);

    expect(replies[1]).toContain('היומן שלך פנוי');
    expect(state.pending).toBeUndefined();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('cancels on request', async () => {
    const { replies, createEvent, state } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'עזוב',
    ]);
    expect(replies[1]).toBe(CANCELLED_MESSAGE);
    expect(createEvent).not.toHaveBeenCalled();
    expect(state.pending).toBeUndefined();
  });

  it('forgets the request after it expires', async () => {
    const clock = mutableClock('2026-09-13T09:00:00Z');
    const { provider, createEvent } = stubProvider();

    let state: ConversationState = emptyConversation;
    const first = await handleTurn('תקבע לי פגישה עם דניאל מחר', { provider, clock, state });
    state = first.state;
    expect(state.pending).toBeDefined();

    clock.advanceBy(PENDING_TTL_MS + 1000);

    // 'בשש' on its own is no longer an answer to anything.
    const second = await handleTurn('בשש', { provider, clock, state });
    expect(second.state.pending).toBeUndefined();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('keeps the request alive within the timeout', async () => {
    const clock = mutableClock('2026-09-13T09:00:00Z');
    const { provider, createEvent } = stubProvider();

    let state: ConversationState = emptyConversation;
    for (const turn of ['תקבע לי פגישה עם דניאל מחר', 'בשש', 'בערב', 'לשעה']) {
      clock.advanceBy(30_000);
      const result = await handleTurn(turn, { provider, clock, state });
      state = result.state;
    }

    expect(createEvent).toHaveBeenCalledOnce();
  });
});

describe('the conversation is cleared once a request ends', () => {
  it('clears after a successful creation', async () => {
    const { state } = await converse(['תקבע לי פגישה מחר ב-18:00 לשעה']);
    expect(state.pending).toBeUndefined();
  });

  it('clears after a conflict', async () => {
    const { state, replies } = await converse(['תקבע לי פגישה מחר ב-17:30 לשעה'], {
      events: [timed('חוג כדורגל', '17:00', '18:00')],
    });
    expect(replies[0]).toContain('לא ניתן לקבוע');
    expect(state.pending).toBeUndefined();
  });

  it('clears after a past time, which more answers cannot fix', async () => {
    const { state, replies } = await converse(['תקבע לי פגישה היום ב-09:00 לשעה']);
    expect(replies[0]).toBe('הזמן שביקשת כבר עבר.');
    expect(state.pending).toBeUndefined();
  });
});

describe('conflicts still apply to a multi-turn request', () => {
  it('refuses at the final turn and writes nothing', async () => {
    const { replies, createEvent } = await converse(
      ['תקבע לי פגישה עם דניאל מחר', 'בחמש', 'אחר הצהריים', 'לשעה'],
      { events: [timed('חוג כדורגל', '17:00', '18:00')] },
    );

    expect(replies[3]).toContain(
      'לא ניתן לקבוע את פגישה עם דניאל ב־17:00־18:00 כי יש לך חוג כדורגל בין 17:00 ל־18:00.',
    );
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('allows a touching boundary assembled over several turns', async () => {
    const { createEvent } = await converse(
      ['תקבע לי פגישה עם דניאל מחר', 'בשש', 'בערב', 'לשעה'],
      { events: [timed('חוג כדורגל', '17:00', '18:00')] },
    );
    expect(createEvent).toHaveBeenCalledOnce();
  });
});

describe('single-shot commands still work unchanged', () => {
  it('creates without any conversation', async () => {
    const { replies, state } = await converse([
      'תקבע לי פגישה עם דניאל מחר בשש בערב לשעה',
    ]);
    expect(replies[0]).toBe('קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00.');
    expect(state.pending).toBeUndefined();
  });

  it('never reaches the calendar while an hour is ambiguous', async () => {
    const { provider, createEvent } = stubProvider();
    await handleTurn('תקבע לי פגישה עם דניאל מחר בשש לשעה', {
      provider,
      clock: CLOCK,
      state: emptyConversation,
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(provider.listEventsForDate).not.toHaveBeenCalled();
  });
});

describe('an unanswered question never becomes a new event', () => {
  // This is the failure that made an edit request add a second meeting: an utterance
  // the assistant could not read was folded into the half-finished CREATE and
  // completed it.
  it('does not absorb an unrelated utterance into a pending request', async () => {
    const { replies, createEvent, state } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'בלה בלה משהו לא ברור',
    ]);

    expect(createEvent).not.toHaveBeenCalled();
    expect(replies[1]).toContain('לא הבנתי');
    // The request survives so the user can answer properly.
    expect(state.pending).toBeDefined();
  });

  it('still accepts a proper answer after one that was not understood', async () => {
    const { createEvent } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'בלה בלה משהו לא ברור',
      'ב-18:00',
      'לשעה',
    ]);
    expect(createEvent).toHaveBeenCalledOnce();
    expect(createEvent.mock.calls[0]?.[0]?.startTime).toBe('18:00');
  });

  it('treats an edit request as an edit, never as an answer', async () => {
    const { createEvent } = await converse([
      'תקבע לי פגישה עם דניאל מחר',
      'תעדכן את הפגישה מחר מדניאל לאברהם',
    ]);
    expect(createEvent).not.toHaveBeenCalled();
  });
});
