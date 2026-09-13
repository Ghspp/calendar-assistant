import { describe, expect, it, vi } from 'vitest';
import { handleCommand } from './handleCommand';
import { respond } from './responder';
import { findDayPartWindow } from './queries';
import { titleMatches } from './eventMatching';
import { allDay, timed } from '../conflict/eventFixtures';
import { fixedClock } from '../../utils/clock';
import { calendarError } from '../calendar/errors';
import type { CalendarProvider } from '../calendar/CalendarProvider';
import type { CalendarEvent } from '../../types/calendar';

/** Sunday 2026-09-13, 12:00 Israel time. Stubs only — nothing reaches Google. */
const CLOCK = fixedClock('2026-09-13T09:00:00Z');

function stubProvider(events: CalendarEvent[] = []) {
  const createEvent = vi.fn();
  const provider: CalendarProvider = {
    listEvents: vi.fn(async () => events),
    listEventsForDate: vi.fn(async () => events),
    createEvent,
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  };
  return { provider, createEvent };
}

async function ask(text: string, events: CalendarEvent[] = []) {
  const { provider, createEvent } = stubProvider(events);
  const outcome = await handleCommand(text, { provider, clock: CLOCK });
  return { outcome, reply: respond(outcome, CLOCK), createEvent, provider };
}

const FOOTBALL = timed('חוג כדורגל', '17:00', '18:00');
const MEETING = timed('פגישה עם דניאל', '09:00', '10:00');

describe('nothing here writes', () => {
  it.each([
    'מה יש לי מחר',
    'מה יש לי היום',
    'אני פנוי מחר בשש',
    'מצא לי שעה פנויה מחר',
    'מתי יש לי את הפגישה עם דניאל',
    'באיזה שעה אני פנוי ביום שישי',
  ])('answers %s without creating anything', async (text) => {
    const { createEvent } = await ask(text, [FOOTBALL]);
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe('agenda — מה יש לי', () => {
  it('reports an empty day', async () => {
    const { reply } = await ask('מה יש לי מחר');
    expect(reply).toBe('מחר היומן שלך פנוי.');
  });

  it('reports a single event', async () => {
    const { reply } = await ask('מה יש לי מחר', [FOOTBALL]);
    expect(reply).toBe('מחר יש לך חוג כדורגל 17:00־18:00.');
  });

  it('reports several events in order', async () => {
    const { reply } = await ask('מה יש לי מחר', [FOOTBALL, MEETING]);
    expect(reply).toBe(
      'מחר יש לך 2 אירועים: פגישה עם דניאל 09:00־10:00, חוג כדורגל 17:00־18:00.',
    );
  });

  it('defaults to today when no date was given', async () => {
    const { outcome } = await ask('מה יש לי');
    expect(outcome.kind).toBe('agenda');
    if (outcome.kind !== 'agenda') return;
    expect(outcome.date).toBe('2026-09-13');
  });

  it('answers for today', async () => {
    const { reply } = await ask('מה יש לי היום', [FOOTBALL]);
    expect(reply).toContain('היום יש לך');
  });

  it('hides cancelled and declined events', async () => {
    const { reply } = await ask('מה יש לי מחר', [
      timed('מבוטל', '11:00', '12:00', { status: 'cancelled' }),
      timed('ישיבה', '13:00', '14:00', { responseStatus: 'declined' }),
      FOOTBALL,
    ]);
    expect(reply).toBe('מחר יש לך חוג כדורגל 17:00־18:00.');
  });

  it('shows an all-day event as a whole-day marker', async () => {
    const { reply } = await ask('מה יש לי מחר', [allDay('חופשה')]);
    expect(reply).toBe('מחר יש לך חופשה (יום שלם).');
  });

  it('answers for a whole week', async () => {
    const { outcome, provider } = await ask('מה יש לי השבוע', [FOOTBALL]);
    expect(outcome.kind).toBe('agenda');
    if (outcome.kind !== 'agenda') return;
    expect(outcome.dateRange).toEqual({ startDate: '2026-09-13', endDate: '2026-09-19' });
    // A week needs a range query, not a single day.
    expect(provider.listEvents).toHaveBeenCalled();
  });

  it('includes the date when answering for a week', async () => {
    const { reply } = await ask('מה יש לי השבוע', [FOOTBALL]);
    expect(reply).toContain('חוג כדורגל מחר בין 17:00 ל־18:00');
  });
});

describe('availability — אני פנוי', () => {
  it('answers yes when the slot is free', async () => {
    const { reply } = await ask('אני פנוי מחר ב-20:00', [FOOTBALL]);
    expect(reply).toBe('כן, אתה פנוי מחר בין 20:00 ל־21:00.');
  });

  it('answers no and names the clash', async () => {
    const { reply } = await ask('אני פנוי מחר ב-17:30', [FOOTBALL]);
    expect(reply).toBe('לא. מחר בין 17:30 ל־18:30 יש לך חוג כדורגל 17:00־18:00.');
  });

  it('answers BOTH readings when the hour is ambiguous', async () => {
    // A question changes nothing, so answering twice beats a round trip — and it still
    // refuses to guess which reading was meant.
    const { reply } = await ask('אני פנוי מחר בשש', [FOOTBALL]);
    expect(reply).toBe('ב־06:00 אתה פנוי. ב־18:00 אתה פנוי.');
  });

  it('distinguishes the two readings when only one clashes', async () => {
    const { reply } = await ask('אני פנוי מחר בחמש', [FOOTBALL]);
    expect(reply).toBe('ב־05:00 אתה פנוי. ב־17:00 יש לך חוג כדורגל 17:00־18:00.');
  });

  it('honours an explicit duration', async () => {
    const { reply } = await ask('אני פנוי מחר ב-16:00 לשעתיים', [FOOTBALL]);
    expect(reply).toContain('בין 16:00 ל־18:00');
    expect(reply).toContain('לא.');
  });

  it('ignores a transparent event', async () => {
    const { reply } = await ask('אני פנוי מחר ב-17:30', [
      timed('תזכורת', '17:00', '18:00', { transparency: 'transparent' }),
    ]);
    expect(reply).toContain('כן, אתה פנוי');
  });
});

describe('free slots — מצא לי שעה פנויה', () => {
  it('lists the gaps around an event', async () => {
    const { reply } = await ask('מצא לי שעה פנויה מחר', [FOOTBALL]);
    expect(reply).toBe('מחר אתה פנוי בין 08:00 ל־17:00, בין 18:00 ל־22:00.');
  });

  it('honours a requested length', async () => {
    const { outcome } = await ask('מצא לי שעה פנויה של שעתיים מחר', [FOOTBALL]);
    expect(outcome.kind).toBe('free-slots');
    if (outcome.kind !== 'free-slots') return;
    expect(outcome.durationMinutes).toBe(120);
  });

  it('narrows the search to the evening', async () => {
    const { outcome, reply } = await ask('מצא לי שעה פנויה מחר בערב', [FOOTBALL]);
    expect(outcome.kind).toBe('free-slots');
    if (outcome.kind !== 'free-slots') return;
    expect(outcome.dayPartLabel).toBe('בערב');
    expect(reply).toBe('מחר בערב אתה פנוי בין 18:00 ל־23:00.');
  });

  it('narrows the search to the morning', async () => {
    const { reply } = await ask('מצא לי שעה פנויה מחר בבוקר', [FOOTBALL]);
    expect(reply).toBe('מחר בבוקר אתה פנוי בין 06:00 ל־12:00.');
  });

  it('says so when nothing fits', async () => {
    const { reply } = await ask('מצא לי שעה פנויה של שעתיים מחר', [
      timed('יום שלם', '08:00', '22:00'),
    ]);
    expect(reply).toBe('לא מצאתי שעה פנויה של שעתיים מחר.');
  });

  it('answers באיזה שעה אני פנוי', async () => {
    const { outcome } = await ask('באיזה שעה אני פנוי ביום שישי', [FOOTBALL]);
    expect(outcome.kind).toBe('free-slots');
    if (outcome.kind !== 'free-slots') return;
    expect(outcome.date).toBe('2026-09-18');
  });

  it('does not offer time that has already passed today', async () => {
    const { outcome } = await ask('מצא לי שעה פנויה היום');
    expect(outcome.kind).toBe('free-slots');
    if (outcome.kind !== 'free-slots') return;
    // The clock reads 12:00.
    expect(outcome.slots[0]?.startTime).toBe('12:00');
  });
});

describe('finding an event by name — מתי יש לי', () => {
  it('reports when and where', async () => {
    const { reply } = await ask('מתי יש לי את הפגישה עם דניאל', [MEETING]);
    expect(reply).toBe('פגישה עם דניאל מחר בין 09:00 ל־10:00.');
  });

  it('matches despite the definite article', async () => {
    // The user says 'הפגישה'; the event is titled 'פגישה'.
    expect(titleMatches('פגישה עם דניאל', 'הפגישה עם דניאל')).toBe(true);
  });

  it('requires every word of the query to appear', async () => {
    expect(titleMatches('פגישה עם דניאל', 'פגישה עם רותי')).toBe(false);
    expect(titleMatches('פגישה עם דניאל', 'פגישה')).toBe(true);
  });

  it('says so when there is no match', async () => {
    const { reply } = await ask('מתי יש לי את האימון', [MEETING]);
    expect(reply).toContain('לא מצאתי');
  });

  it('lists several matches', async () => {
    const { reply } = await ask('מתי יש לי את הפגישה עם דניאל', [
      MEETING,
      timed('פגישה עם דניאל', '09:00', '10:00', { date: '2026-09-16', id: 'second' }),
    ]);
    expect(reply).toContain('מצאתי 2');
  });
});

describe('findDayPartWindow', () => {
  it.each([
    ['מצא לי שעה פנויה מחר בבוקר', 'בבוקר'],
    ['מצא לי שעה פנויה מחר בערב', 'בערב'],
    ['מצא לי שעה פנויה מחר אחר הצהריים', 'אחר הצהריים'],
    ['מצא לי שעה פנויה מחר בלילה', 'בלילה'],
  ])('reads the day part of %s', (text, label) => {
    expect(findDayPartWindow(text)?.label).toBe(label);
  });

  it('returns nothing when no day part is mentioned', () => {
    expect(findDayPartWindow('מצא לי שעה פנויה מחר')).toBeUndefined();
  });
});

describe('failures are reported, not thrown', () => {
  it('reports a network failure during a query', async () => {
    const provider: CalendarProvider = {
      listEvents: vi.fn(),
      listEventsForDate: vi.fn(async () => {
        throw calendarError('network');
      }),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    };

    const outcome = await handleCommand('מה יש לי מחר', { provider, clock: CLOCK });
    expect(outcome.kind).toBe('failed');
    expect(respond(outcome, CLOCK)).toContain('אין חיבור לשרתי Google');
  });

  it('reports an expired session during a free-slot search', async () => {
    const provider: CalendarProvider = {
      listEvents: vi.fn(),
      listEventsForDate: vi.fn(async () => {
        throw calendarError('not-authenticated');
      }),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    };

    const outcome = await handleCommand('מצא לי שעה פנויה מחר', { provider, clock: CLOCK });
    expect(respond(outcome, CLOCK)).toBe('נדרשת התחברות ל-Google Calendar.');
  });
});
