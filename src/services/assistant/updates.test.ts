import { describe, expect, it, vi } from 'vitest';
import { handleCommand } from './handleCommand';
import { respond } from './responder';
import { applySubstitution, applyTailReplacement, parseUpdate } from './updateParsing';
import { parseCommand } from '../parser';
import { timed } from '../conflict/eventFixtures';
import { fixedClock } from '../../utils/clock';
import { calendarError } from '../calendar/errors';
import type { CalendarProvider, CreatedEvent, EventChanges } from '../calendar/CalendarProvider';
import type { CalendarEvent } from '../../types/calendar';

/**
 * Every test uses a stub provider. `updateEvent` is a spy, so nothing here can change
 * a real calendar — and the tests assert precisely what would have been sent.
 */

const CLOCK = fixedClock('2026-09-13T09:00:00Z'); // Sunday, 12:00 Israel

/** The user's example: a meeting with Daniel tomorrow, 15:00-16:00. */
const DANIEL = timed('פגישה עם דניאל', '15:00', '16:00', { id: 'daniel-1' });

function stubProvider(events: CalendarEvent[] = []) {
  const updateEvent = vi.fn(
    async (eventId: string, changes: EventChanges): Promise<CreatedEvent> => ({
      id: eventId,
      title: changes.title ?? 'פגישה עם דניאל',
      start: changes.interval?.start.toISOString() ?? '2026-09-14T12:00:00Z',
      end: changes.interval?.end.toISOString() ?? '2026-09-14T13:00:00Z',
    }),
  );

  const provider: CalendarProvider = {
    listEvents: vi.fn(async () => events),
    listEventsForDate: vi.fn(async () => events),
    createEvent: vi.fn(),
    updateEvent,
    deleteEvent: vi.fn(),
  };

  return { provider, updateEvent };
}

async function say(text: string, events: CalendarEvent[] = [DANIEL]) {
  const stub = stubProvider(events);
  const outcome = await handleCommand(text, { provider: stub.provider, clock: CLOCK });
  return { outcome, reply: respond(outcome, CLOCK), ...stub };
}

describe('renaming — the requested feature', () => {
  it('swaps the participant', async () => {
    const { reply, updateEvent } = await say('תשנה את הפגישה מחר מדניאל לאברהם');

    expect(updateEvent).toHaveBeenCalledOnce();
    expect(updateEvent.mock.calls[0]?.[1]).toEqual({ title: 'פגישה עם אברהם' });
    expect(reply).toBe('שיניתי את פגישה עם דניאל לפגישה עם אברהם. נשאר מחר בין 15:00 ל־16:00.');
  });

  it('renames wholesale', async () => {
    const { updateEvent } = await say(
      'תשנה את הפגישה עם דניאל מחר לפגישה עם אברהם',
    );
    expect(updateEvent.mock.calls[0]?.[1]).toEqual({ title: 'פגישה עם אברהם' });
  });

  it('sends ONLY the title, leaving the time untouched', async () => {
    // A rename must never disturb when the event is.
    const { updateEvent } = await say('תשנה את הפגישה מחר מדניאל לאברהם');
    const changes = updateEvent.mock.calls[0]?.[1];
    expect(changes?.interval).toBeUndefined();
    expect(Object.keys(changes ?? {})).toEqual(['title']);
  });

  it('targets the right event id', async () => {
    const { updateEvent } = await say('תשנה את הפגישה מחר מדניאל לאברהם');
    expect(updateEvent.mock.calls[0]?.[0]).toBe('daniel-1');
  });

  it('says so when the word is not in the title', async () => {
    const { reply, updateEvent } = await say('תשנה את הפגישה מחר מרותי לאברהם');
    expect(updateEvent).not.toHaveBeenCalled();
    expect(reply).toContain('לא מצאתי');
  });
});

describe('moving', () => {
  it('moves the event and keeps its length', async () => {
    const { updateEvent, reply } = await say('תעביר את הפגישה עם דניאל מחר ל-18:00');

    const changes = updateEvent.mock.calls[0]?.[1];
    expect(changes?.title).toBeUndefined();
    // 18:00 Israel in September is 15:00 UTC; the original was one hour long.
    expect(changes?.interval?.start.toISOString()).toBe('2026-09-14T15:00:00.000Z');
    expect(changes?.interval?.end.toISOString()).toBe('2026-09-14T16:00:00.000Z');
    expect(reply).toContain('העברתי את פגישה עם דניאל');
  });

  it('accepts a new duration', async () => {
    const { updateEvent } = await say('תעביר את הפגישה עם דניאל מחר ל-18:00 לשעתיים');
    const changes = updateEvent.mock.calls[0]?.[1];
    expect(changes?.interval?.end.toISOString()).toBe('2026-09-14T17:00:00.000Z');
  });

  it('asks rather than guessing an ambiguous hour', async () => {
    const { reply, updateEvent } = await say('תעביר את הפגישה עם דניאל מחר לשמונה');
    expect(updateEvent).not.toHaveBeenCalled();
    expect(reply).toBe('בבוקר או בערב?');
  });

  it('refuses a move that would collide', async () => {
    const { reply, updateEvent } = await say('תעביר את הפגישה עם דניאל מחר ל-17:30', [
      DANIEL,
      timed('חוג כדורגל', '17:00', '18:00', { id: 'football' }),
    ]);

    expect(updateEvent).not.toHaveBeenCalled();
    expect(reply).toContain('לא ניתן להעביר');
    expect(reply).toContain('חוג כדורגל');
  });

  it('does not treat the event as conflicting with itself', async () => {
    // Moving 15:00-16:00 to 15:30 overlaps its own old slot, which must not block it.
    const { updateEvent } = await say('תעביר את הפגישה עם דניאל מחר ל-15:30');
    expect(updateEvent).toHaveBeenCalledOnce();
  });
});

describe('never acting on an ambiguous match', () => {
  it('CHANGES NOTHING when several events match', async () => {
    const { reply, updateEvent } = await say('תשנה את הפגישה מחר מדניאל לאברהם', [
      DANIEL,
      timed('פגישה עם דניאל', '09:00', '10:00', { id: 'daniel-2' }),
    ]);

    expect(updateEvent).not.toHaveBeenCalled();
    expect(reply).toContain('מצאתי 2 אירועים');
    expect(reply).toContain('על איזה מהם?');
  });

  it('lists the matches with their times so the user can choose', async () => {
    const { reply } = await say('תשנה את הפגישה מחר מדניאל לאברהם', [
      DANIEL,
      timed('פגישה עם דניאל', '09:00', '10:00', { id: 'daniel-2' }),
    ]);
    expect(reply).toContain('1.');
    expect(reply).toContain('2.');
    expect(reply).toContain('09:00');
    expect(reply).toContain('15:00');
  });

  it('CHANGES NOTHING when no event matches', async () => {
    const { reply, updateEvent } = await say('תשנה את האימון מחר מדניאל לאברהם', [DANIEL]);
    expect(updateEvent).not.toHaveBeenCalled();
    expect(reply).toContain('לא מצאתי אירוע');
  });

  it('ignores a cancelled event when matching', async () => {
    const { updateEvent } = await say('תשנה את הפגישה מחר מדניאל לאברהם', [
      DANIEL,
      timed('פגישה עם דניאל', '09:00', '10:00', { id: 'x', status: 'cancelled' }),
    ]);
    // The cancelled one must not make this ambiguous.
    expect(updateEvent).toHaveBeenCalledOnce();
  });

  it('ignores a declined event when matching', async () => {
    const { updateEvent } = await say('תשנה את הפגישה מחר מדניאל לאברהם', [
      DANIEL,
      timed('פגישה עם דניאל', '09:00', '10:00', { id: 'x', responseStatus: 'declined' }),
    ]);
    expect(updateEvent).toHaveBeenCalledOnce();
  });
});

describe('unclear requests change nothing', () => {
  it('reports a request with no change described', async () => {
    const { reply, updateEvent } = await say('תשנה את הפגישה עם דניאל מחר');
    expect(updateEvent).not.toHaveBeenCalled();
    expect(reply).toContain('לא הבנתי מה לשנות');
  });

  it('reports a request with no target', async () => {
    const { reply, updateEvent } = await say('תשנה');
    expect(updateEvent).not.toHaveBeenCalled();
    expect(reply).toContain('לא הבנתי איזה אירוע');
  });
});

describe('parseUpdate', () => {
  const read = (text: string) => parseUpdate(parseCommand(text, CLOCK));

  it('reads a substitution', () => {
    expect(read('תשנה את הפגישה מחר מדניאל לאברהם')).toMatchObject({
      target: 'הפגישה',
      targetDate: '2026-09-14',
      change: { kind: 'substitute', from: 'דניאל', to: 'אברהם' },
    });
  });

  it('reads a wholesale rename', () => {
    expect(read('תשנה את הפגישה עם דניאל מחר לפגישה עם אברהם')).toMatchObject({
      target: 'הפגישה עם דניאל',
      change: { kind: 'retitle', newTitle: 'פגישה עם אברהם' },
    });
  });

  it('reads a move', () => {
    expect(read('תעביר את הפגישה עם דניאל מחר ל-18:00')).toMatchObject({
      target: 'הפגישה עם דניאל',
      change: { kind: 'move', startTime: '18:00' },
    });
  });

  it('prefers a move over a rename when a time is present', () => {
    // 'לשמונה' must never be read as renaming the event to "שמונה".
    const request = read('תעביר את הפגישה עם דניאל מחר לשמונה בערב');
    expect(request?.change.kind).toBe('move');
  });

  it('returns undefined for a non-update command', () => {
    expect(read('תקבע לי פגישה מחר ב-18:00 לשעה')).toBeUndefined();
  });
});

describe('applySubstitution', () => {
  it('replaces a whole word', () => {
    expect(applySubstitution('פגישה עם דניאל', 'דניאל', 'אברהם')).toBe('פגישה עם אברהם');
  });

  it('keeps a particle the original carried', () => {
    expect(applySubstitution('פגישה לדניאל', 'דניאל', 'אברהם')).toBe('פגישה לאברהם');
  });

  it('does not corrupt a longer word that merely starts the same', () => {
    // Replacing 'דן' must not touch 'דניאל'.
    expect(applySubstitution('פגישה עם דניאל', 'דן', 'אברהם')).toBeUndefined();
  });

  it('returns undefined when the word is absent', () => {
    expect(applySubstitution('פגישה עם דניאל', 'רותי', 'אברהם')).toBeUndefined();
  });

  it('replaces only the first occurrence', () => {
    expect(applySubstitution('דניאל ודניאל', 'דניאל', 'אברהם')).toBe('אברהם ודניאל');
  });
});

describe('failures', () => {
  it('reports an API failure without pretending it worked', async () => {
    const provider: CalendarProvider = {
      listEvents: vi.fn(async () => [DANIEL]),
      listEventsForDate: vi.fn(async () => [DANIEL]),
      createEvent: vi.fn(),
      updateEvent: vi.fn(async () => {
        throw calendarError('permission-denied');
      }),
      deleteEvent: vi.fn(),
    };

    const outcome = await handleCommand('תשנה את הפגישה מחר מדניאל לאברהם', {
      provider,
      clock: CLOCK,
    });

    expect(outcome.kind).toBe('failed');
    expect(respond(outcome, CLOCK)).toContain('אין הרשאה');
  });
});

describe('phrasings that must all be recognised as an edit', () => {
  // Each of these used to fall through and risk creating a second event instead of
  // changing the existing one.
  it.each([
    'תשנה את הפגישה מחר מדניאל לאברהם',
    'תשנה את הפגישה עם דניאל מחר לפגישה עם אברהם',
    'תשנה את הפגישה עם דניאל מחר שתהיה עם אברהם',
    'תעדכן את הפגישה מחר מדניאל לאברהם',
    'עדכן את הפגישה מחר מדניאל לאברהם',
    'תחליף את הפגישה מחר מדניאל לאברהם',
    'שנה את הפגישה מחר מדניאל לאברהם',
    'תשנה את הפגישה עם דניאל מחר במקום דניאל אברהם',
    'במקום דניאל תשים אברהם',
  ])('renames via: %s', async (text) => {
    const { updateEvent } = await say(text);
    expect(updateEvent).toHaveBeenCalledOnce();
    expect(updateEvent.mock.calls[0]?.[1]).toEqual({ title: 'פגישה עם אברהם' });
  });

  it.each([
    'תשנה את הפגישה מחר מדניאל לאברהם',
    'תעדכן את הפגישה מחר מדניאל לאברהם',
    'במקום דניאל תשים אברהם',
  ])('never creates a second event for: %s', async (text) => {
    const stub = stubProvider([DANIEL]);
    const createEvent = stub.provider.createEvent;
    await handleCommand(text, { provider: stub.provider, clock: CLOCK });
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe('applyTailReplacement', () => {
  it('replaces from the anchor word onwards', () => {
    expect(applyTailReplacement('פגישה עם דניאל', 'עם אברהם')).toBe('פגישה עם אברהם');
  });

  it('keeps everything before the anchor', () => {
    expect(applyTailReplacement('ארוחת ערב עם דניאל', 'עם אברהם')).toBe(
      'ארוחת ערב עם אברהם',
    );
  });

  it('returns undefined when the anchor is absent', () => {
    expect(applyTailReplacement('אימון בוקר', 'עם אברהם')).toBeUndefined();
  });
});
