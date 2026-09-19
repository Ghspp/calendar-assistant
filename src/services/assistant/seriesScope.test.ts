/**
 * Repeating events: one occurrence, or the whole series?
 *
 * Every test here asserts which id reached the provider, because that id is the entire
 * difference between changing one afternoon and changing all of them. The unclear cases
 * matter most: neither reading is assumed, because both are destructive in a way the
 * user did not ask for.
 */

import { describe, expect, it, vi } from 'vitest';
import { handleTurn } from './handleTurn';
import { respond } from './responder';
import { readSeriesScope } from '../conversation/choices';
import { emptyConversation, type ConversationState } from '../conversation/ConversationManager';
import { timed } from '../conflict/eventFixtures';
import { fixedClock } from '../../utils/clock';
import type { CalendarProvider } from '../calendar/CalendarProvider';
import type { CalendarEvent } from '../../types/calendar';

const CLOCK = fixedClock('2026-09-13T09:00:00Z'); // Sunday, 12:00 Israel

/** One occurrence of a weekly series. Google gives the occurrence its own id. */
const FOOTBALL = timed('חוג כדורגל', '17:00', '18:00', {
  id: 'football-20260914T170000Z',
  recurringEventId: 'football-series',
});

/** Same shape, but a one-off: no series to ask about. */
const DANIEL = timed('פגישה עם דניאל', '15:00', '16:00', { id: 'daniel-1' });

function stubProvider(events: CalendarEvent[]) {
  const deleteEvent = vi.fn(async () => undefined);
  const updateEvent = vi.fn(async (id: string) => ({
    id,
    htmlLink: 'https://example.test/e',
    title: 'חוג כדורגל',
    start: FOOTBALL.start,
    end: FOOTBALL.end,
  }));

  const provider = {
    listEvents: vi.fn(async () => events),
    listEventsForDate: vi.fn(async () => events),
    createEvent: vi.fn(),
    updateEvent,
    deleteEvent,
  } as unknown as CalendarProvider;

  return { provider, deleteEvent, updateEvent };
}

async function converse(turns: string[], events: CalendarEvent[]) {
  const { provider, deleteEvent, updateEvent } = stubProvider(events);
  let state: ConversationState = emptyConversation;
  const replies: string[] = [];

  for (const turn of turns) {
    const result = await handleTurn(turn, { provider, clock: CLOCK, state });
    state = result.state;
    replies.push(respond(result.outcome, CLOCK));
  }

  return { replies, deleteEvent, updateEvent, state };
}

describe('readSeriesScope', () => {
  it.each(['רק את זה', 'רק המופע הזה', 'הפעם', 'רק היום'])(
    'reads %s as this occurrence',
    (text) => {
      expect(readSeriesScope(text)).toBe('instance');
    },
  );

  it.each(['את כל הסדרה', 'הסדרה', 'הכל', 'תמיד'])('reads %s as the whole series', (text) => {
    expect(readSeriesScope(text)).toBe('series');
  });

  it.each(['אמממ', 'כן', 'רק', 'לא יודע'])('leaves %s unclear', (text) => {
    expect(readSeriesScope(text)).toBe('unclear');
  });

  it('is unclear when both readings are present at once', () => {
    expect(readSeriesScope('את כל הסדרה רק הפעם')).toBe('unclear');
  });
});

describe('deleting a repeating event', () => {
  it('asks about the scope instead of the usual yes/no', async () => {
    const { replies, deleteEvent } = await converse(['תבטל את חוג כדורגל מחר'], [FOOTBALL]);

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[0]).toContain('אירוע חוזר');
    expect(replies[0]).toContain('כל הסדרה');
  });

  it('deletes only the occurrence when asked for this one', async () => {
    const { deleteEvent, replies } = await converse(
      ['תבטל את חוג כדורגל מחר', 'רק את זה'],
      [FOOTBALL],
    );

    expect(deleteEvent).toHaveBeenCalledOnce();
    expect(deleteEvent).toHaveBeenCalledWith('football-20260914T170000Z');
    expect(replies[1]).not.toContain('הסדרה');
  });

  it('deletes the series when asked for all of it', async () => {
    const { deleteEvent, replies } = await converse(
      ['תבטל את חוג כדורגל מחר', 'את כל הסדרה'],
      [FOOTBALL],
    );

    expect(deleteEvent).toHaveBeenCalledOnce();
    expect(deleteEvent).toHaveBeenCalledWith('football-series');
    expect(replies[1]).toBe('מחקתי את כל הסדרה של חוג כדורגל.');
  });

  it('RE-ASKS rather than picking either reading', async () => {
    const { deleteEvent, replies } = await converse(
      ['תבטל את חוג כדורגל מחר', 'אמממ'],
      [FOOTBALL],
    );

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[1]).toContain('כל הסדרה');
  });

  it('DELETES NOTHING on a refusal', async () => {
    const { deleteEvent, replies } = await converse(
      ['תבטל את חוג כדורגל מחר', 'לא'],
      [FOOTBALL],
    );

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[1]).toBe('בסדר, לא מחקתי כלום.');
  });

  it('does not ask about scope for a one-off event', async () => {
    const { replies } = await converse(['תבטל את הפגישה עם דניאל מחר'], [DANIEL]);
    expect(replies[0]).not.toContain('אירוע חוזר');
  });
});

describe('renaming a repeating event', () => {
  const RENAME = 'תשנה את חוג כדורגל מחר מכדורגל לכדורסל';

  it('CHANGES NOTHING until the scope is settled', async () => {
    const { replies, updateEvent } = await converse([RENAME], [FOOTBALL]);

    expect(updateEvent).not.toHaveBeenCalled();
    expect(replies[0]).toContain('אירוע חוזר');
    expect(replies[0]).toContain('כל הסדרה');
  });

  it('changes only the occurrence when asked for this one', async () => {
    const { updateEvent } = await converse([RENAME, 'רק את זה'], [FOOTBALL]);

    expect(updateEvent).toHaveBeenCalledOnce();
    expect(updateEvent).toHaveBeenCalledWith('football-20260914T170000Z', {
      title: 'חוג כדורסל',
    });
  });

  it('changes the series when asked for all of it', async () => {
    const { updateEvent, replies } = await converse([RENAME, 'את כל הסדרה'], [FOOTBALL]);

    expect(updateEvent).toHaveBeenCalledOnce();
    expect(updateEvent).toHaveBeenCalledWith('football-series', { title: 'חוג כדורסל' });
    expect(replies[1]).toBe('שיניתי את כל הסדרה של חוג כדורגל לחוג כדורסל.');
  });

  it('RE-ASKS rather than picking either reading', async () => {
    const { updateEvent, replies } = await converse([RENAME, 'אמממ'], [FOOTBALL]);

    expect(updateEvent).not.toHaveBeenCalled();
    expect(replies[1]).toContain('כל הסדרה');
  });

  it('CHANGES NOTHING on a refusal', async () => {
    const { updateEvent, replies } = await converse([RENAME, 'לא'], [FOOTBALL]);

    expect(updateEvent).not.toHaveBeenCalled();
    expect(replies[1]).toBe('בסדר, לא שיניתי כלום.');
  });

  it('does not ask about scope for a one-off event', async () => {
    const { replies, updateEvent } = await converse(
      ['תשנה את הפגישה מחר מדניאל לאברהם'],
      [DANIEL],
    );

    expect(updateEvent).toHaveBeenCalledOnce();
    expect(replies[0]).not.toContain('אירוע חוזר');
  });
});

describe('moving a repeating event', () => {
  /**
   * Moving a whole series is deliberately NOT offered: shifting the master's start also
   * moves where the series begins, which is a bigger change than 'move tomorrow's'.
   */
  it('moves the single occurrence without asking about the series', async () => {
    const { updateEvent, replies } = await converse(
      ['תעביר את חוג כדורגל מחר ל-19:00'],
      [FOOTBALL],
    );

    expect(replies[0]).not.toContain('כל הסדרה');
    expect(updateEvent).toHaveBeenCalledOnce();
    expect(updateEvent.mock.calls[0]?.[0]).toBe('football-20260914T170000Z');
  });
});
