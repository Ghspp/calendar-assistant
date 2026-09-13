import { describe, expect, it, vi } from 'vitest';
import { handleTurn } from './handleTurn';
import { respond } from './responder';
import { readChoice, readConfirmation } from '../conversation/choices';
import { emptyConversation, type ConversationState } from '../conversation/ConversationManager';
import { timed } from '../conflict/eventFixtures';
import { fixedClock } from '../../utils/clock';
import { calendarError } from '../calendar/errors';
import type { CalendarProvider } from '../calendar/CalendarProvider';
import type { CalendarEvent } from '../../types/calendar';

/**
 * `deleteEvent` is a spy everywhere here. No test in this file can remove anything from
 * a real calendar, and every one of them asserts exactly whether it would have.
 */

const CLOCK = fixedClock('2026-09-13T09:00:00Z'); // Sunday, 12:00 Israel
const TZ = 'Asia/Jerusalem';

const DANIEL = timed('פגישה עם דניאל', '15:00', '16:00', { id: 'daniel-1' });
const DANIEL_MORNING = timed('פגישה עם דניאל', '09:00', '10:00', { id: 'daniel-2' });
const FOOTBALL = timed('חוג כדורגל', '17:00', '18:00', { id: 'football' });

function stubProvider(events: CalendarEvent[] = []) {
  const deleteEvent = vi.fn(async () => undefined);
  const provider: CalendarProvider = {
    listEvents: vi.fn(async () => events),
    listEventsForDate: vi.fn(async () => events),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent,
  };
  return { provider, deleteEvent };
}

/** Drive a conversation, returning every reply and whether anything was deleted. */
async function converse(turns: string[], events: CalendarEvent[] = [DANIEL]) {
  const { provider, deleteEvent } = stubProvider(events);
  let state: ConversationState = emptyConversation;
  const replies: string[] = [];

  for (const turn of turns) {
    const result = await handleTurn(turn, { provider, clock: CLOCK, state });
    state = result.state;
    replies.push(respond(result.outcome, CLOCK));
  }

  return { replies, deleteEvent, state };
}

describe('deleting always asks first', () => {
  it('DELETES NOTHING on the first turn, however clear the request', async () => {
    const { replies, deleteEvent } = await converse(['תבטל את הפגישה עם דניאל מחר']);

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[0]).toBe('למחוק את פגישה עם דניאל מחר בין 15:00 ל־16:00?');
  });

  it('describes the event fully, so a wrong match is visible before it is destroyed', async () => {
    const { replies } = await converse(['תבטל את הפגישה עם דניאל מחר']);
    expect(replies[0]).toContain('פגישה עם דניאל');
    expect(replies[0]).toContain('15:00');
    expect(replies[0]).toContain('מחר');
  });

  it('deletes after an explicit yes', async () => {
    const { replies, deleteEvent } = await converse(['תבטל את הפגישה עם דניאל מחר', 'כן']);

    expect(deleteEvent).toHaveBeenCalledOnce();
    expect(deleteEvent).toHaveBeenCalledWith('daniel-1');
    expect(replies[1]).toBe('מחקתי את פגישה עם דניאל מחר בין 15:00 ל־16:00.');
  });

  it.each(['כן', 'אישור', 'בטח', 'אוקיי'])('accepts %s as consent', async (answer) => {
    const { deleteEvent } = await converse(['תבטל את הפגישה עם דניאל מחר', answer]);
    expect(deleteEvent).toHaveBeenCalledOnce();
  });

  it.each(['לא', 'עזוב', 'תשכח'])('treats %s as a refusal', async (answer) => {
    const { replies, deleteEvent } = await converse(['תבטל את הפגישה עם דניאל מחר', answer]);
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[1]).toBe('בסדר, לא מחקתי כלום.');
  });

  it('RE-ASKS rather than treating an unclear answer as consent', async () => {
    const { replies, deleteEvent } = await converse([
      'תבטל את הפגישה עם דניאל מחר',
      'אמממ',
    ]);
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[1]).toContain('למחוק את');
  });

  it('forgets the confirmation once it has been answered', async () => {
    const { state } = await converse(['תבטל את הפגישה עם דניאל מחר', 'כן']);
    expect(state.action).toBeUndefined();
  });

  it('a second yes does not delete again', async () => {
    const { deleteEvent } = await converse(['תבטל את הפגישה עם דניאל מחר', 'כן', 'כן']);
    expect(deleteEvent).toHaveBeenCalledOnce();
  });
});

describe('never deleting an ambiguous match', () => {
  it('DELETES NOTHING and lists the candidates', async () => {
    const { replies, deleteEvent } = await converse(
      ['תבטל את הפגישה עם דניאל מחר'],
      [DANIEL, DANIEL_MORNING],
    );

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[0]).toContain('מצאתי 2 אירועים');
    expect(replies[0]).toContain('איזה מהם למחוק?');
  });

  it('still asks for confirmation after the user picks one', async () => {
    // Picking is not consent: choosing narrows it down, the yes authorises it.
    const { replies, deleteEvent } = await converse(
      ['תבטל את הפגישה עם דניאל מחר', 'השני'],
      [DANIEL_MORNING, DANIEL],
    );

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[1]).toContain('למחוק את');
    expect(replies[1]).toContain('15:00');
  });

  it('deletes the chosen one, and only after a yes', async () => {
    const { deleteEvent } = await converse(
      ['תבטל את הפגישה עם דניאל מחר', 'השני', 'כן'],
      [DANIEL_MORNING, DANIEL],
    );

    expect(deleteEvent).toHaveBeenCalledOnce();
    expect(deleteEvent).toHaveBeenCalledWith('daniel-1');
  });

  it('picks by ordinal, number or time alike', async () => {
    for (const answer of ['הראשון', '1', '09:00']) {
      const { deleteEvent } = await converse(
        ['תבטל את הפגישה עם דניאל מחר', answer, 'כן'],
        [DANIEL_MORNING, DANIEL],
      );
      expect(deleteEvent, `answer: ${answer}`).toHaveBeenCalledWith('daniel-2');
    }
  });

  it('reports when nothing matches', async () => {
    const { replies, deleteEvent } = await converse(['תבטל את האימון מחר'], [DANIEL]);
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[0]).toContain('לא מצאתי אירוע');
  });

  it('does not count a cancelled event as a second match', async () => {
    const { replies } = await converse(
      ['תבטל את הפגישה עם דניאל מחר'],
      [DANIEL, timed('פגישה עם דניאל', '09:00', '10:00', { id: 'x', status: 'cancelled' })],
    );
    expect(replies[0]).toContain('למחוק את');
  });

  it('abandons the choice on a refusal', async () => {
    const { replies, deleteEvent, state } = await converse(
      ['תבטל את הפגישה עם דניאל מחר', 'לא'],
      [DANIEL, DANIEL_MORNING],
    );
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[1]).toContain('לא שיניתי כלום');
    expect(state.action).toBeUndefined();
  });
});

describe('a pending confirmation cannot swallow other commands', () => {
  it('does not delete when the next utterance is a new command', async () => {
    const { deleteEvent, replies } = await converse([
      'תבטל את הפגישה עם דניאל מחר',
      'מה יש לי מחר',
    ]);
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(replies[1]).toContain('יש לך');
  });

  it('does not delete when the user starts scheduling instead', async () => {
    const { deleteEvent } = await converse([
      'תבטל את הפגישה עם דניאל מחר',
      'תקבע לי אימון מחר ב-08:00 לשעה',
    ]);
    expect(deleteEvent).not.toHaveBeenCalled();
  });
});

describe('choosing between events when updating', () => {
  it('applies the change to the chosen event', async () => {
    const { provider } = stubProvider([DANIEL_MORNING, DANIEL]);
    let state: ConversationState = emptyConversation;

    const first = await handleTurn('תשנה את הפגישה מחר מדניאל לאברהם', {
      provider,
      clock: CLOCK,
      state,
    });
    state = first.state;
    expect(provider.updateEvent).not.toHaveBeenCalled();

    const second = await handleTurn('השני', { provider, clock: CLOCK, state });
    expect(provider.updateEvent).toHaveBeenCalledOnce();
    expect(provider.updateEvent).toHaveBeenCalledWith('daniel-1', { title: 'פגישה עם אברהם' });
    expect(respond(second.outcome, CLOCK)).toContain('שיניתי');
  });
});

describe('failures leave the calendar alone', () => {
  it('reports an API failure during deletion', async () => {
    const provider: CalendarProvider = {
      listEvents: vi.fn(async () => [DANIEL]),
      listEventsForDate: vi.fn(async () => [DANIEL]),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(async () => {
        throw calendarError('permission-denied');
      }),
    };

    let state: ConversationState = emptyConversation;
    const first = await handleTurn('תבטל את הפגישה עם דניאל מחר', {
      provider,
      clock: CLOCK,
      state,
    });
    const second = await handleTurn('כן', { provider, clock: CLOCK, state: first.state });

    expect(second.outcome.kind).toBe('failed');
    expect(respond(second.outcome, CLOCK)).toContain('אין הרשאה');
  });
});

describe('readConfirmation', () => {
  it.each(['כן', 'אישור', 'בטח', 'אוקיי', 'נכון'])('reads %s as yes', (text) => {
    expect(readConfirmation(text)).toBe('yes');
  });

  it.each(['לא', 'עזוב', 'ביטול', 'עצור'])('reads %s as no', (text) => {
    expect(readConfirmation(text)).toBe('no');
  });

  it.each(['אמממ', 'מה', 'פגישה'])('reads %s as unclear', (text) => {
    expect(readConfirmation(text)).toBe('unclear');
  });

  it('prefers no when both appear, never silently consenting', () => {
    expect(readConfirmation('לא כן')).toBe('no');
  });
});

describe('readChoice', () => {
  const matches = [DANIEL_MORNING, DANIEL];

  it.each([
    ['הראשון', 'daniel-2'],
    ['ראשון', 'daniel-2'],
    ['השני', 'daniel-1'],
    ['1', 'daniel-2'],
    ['2', 'daniel-1'],
  ])('reads %s', (text, expected) => {
    expect(readChoice(text, matches, TZ)?.id).toBe(expected);
  });

  it('reads a start time', () => {
    expect(readChoice('15:00', matches, TZ)?.id).toBe('daniel-1');
    expect(readChoice('09:00', matches, TZ)?.id).toBe('daniel-2');
  });

  it('returns undefined for an out-of-range index', () => {
    expect(readChoice('7', matches, TZ)).toBeUndefined();
  });

  it('returns undefined for anything it cannot read', () => {
    expect(readChoice('אמממ', matches, TZ)).toBeUndefined();
  });

  it('returns undefined when there is nothing to choose from', () => {
    expect(readChoice('הראשון', [], TZ)).toBeUndefined();
  });

  it('does not resolve a time that matches several events', () => {
    const twins = [
      timed('א', '09:00', '10:00', { id: 'a' }),
      timed('ב', '09:00', '10:00', { id: 'b' }),
    ];
    expect(readChoice('09:00', twins, TZ)).toBeUndefined();
  });
});

describe('unrelated events are never at risk', () => {
  it('does not match a different event', async () => {
    const { deleteEvent, replies } = await converse(
      ['תבטל את חוג כדורגל מחר', 'כן'],
      [DANIEL, FOOTBALL],
    );
    expect(deleteEvent).toHaveBeenCalledWith('football');
    expect(replies[1]).toContain('חוג כדורגל');
  });
});
