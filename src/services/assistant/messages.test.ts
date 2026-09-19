/**
 * Sending a message, end to end through the conversation layer.
 *
 * `sendMail` is a spy in every test here, so nothing in this file can reach a real
 * inbox — and every test asserts whether it would have. The first two describe blocks
 * are the ones that matter: they pin the rule that nothing is ever sent without the
 * user seeing the text first.
 */

import { describe, expect, it, vi } from 'vitest';
import { handleTurn } from './handleTurn';
import { respond } from './responder';
import { emptyConversation, type ConversationState } from '../conversation/ConversationManager';
import { fixedClock } from '../../utils/clock';
import { CalendarError } from '../calendar/errors';
import type { CalendarProvider } from '../calendar/CalendarProvider';
import type { Contact } from '../../storage/contacts';
import type { GmailChannel } from '../messaging/GmailChannel';

const CLOCK = fixedClock('2026-09-13T09:00:00Z');

const MUM: Contact = { id: 'c1', name: 'אמא', email: 'mum@example.com' };
const DANIEL: Contact = { id: 'c2', name: 'דניאל', phone: '972501234567' };
const RUTI: Contact = { id: 'c3', name: 'רותי' };

const CONTACTS = [MUM, DANIEL, RUTI];

function stub(contacts: readonly Contact[] = CONTACTS, failWith?: CalendarError) {
  const sendMail = vi.fn(async (to: string) => {
    if (failWith !== undefined) throw failWith;
    return { id: 'm1', to };
  });

  const gmail = { sendMail } as unknown as GmailChannel;

  const provider = {
    listEvents: vi.fn(async () => []),
    listEventsForDate: vi.fn(async () => []),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  } as unknown as CalendarProvider;

  return { provider, gmail, sendMail, contacts };
}

async function converse(turns: string[], setup = stub()) {
  let state: ConversationState = emptyConversation;
  const replies: string[] = [];

  for (const turn of turns) {
    const result = await handleTurn(turn, {
      provider: setup.provider,
      clock: CLOCK,
      state,
      messaging: { contacts: setup.contacts, gmail: setup.gmail },
    });
    state = result.state;
    replies.push(respond(result.outcome, CLOCK));
  }

  return { replies, sendMail: setup.sendMail, state };
}

describe('nothing is sent without confirmation', () => {
  it('SENDS NOTHING on the first turn, however clear the request', async () => {
    const { replies, sendMail } = await converse(['תשלח לאמא שאני מאחר']);

    expect(sendMail).not.toHaveBeenCalled();
    expect(replies[0]).toBe('לשלוח במייל לאמא: "אני מאחר"?');
  });

  it('reads the whole message back, so a misheard word is visible first', async () => {
    const { replies } = await converse(['תשלח לאמא שאני מאחר בעשרים דקות']);
    expect(replies[0]).toContain('אני מאחר בעשרים דקות');
    expect(replies[0]).toContain('אמא');
  });

  it('sends after an explicit yes', async () => {
    const { replies, sendMail } = await converse(['תשלח לאמא שאני מאחר', 'כן']);

    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledWith('mum@example.com', 'אני מאחר');
    expect(replies[1]).toBe('שלחתי לאמא.');
  });

  it.each(['לא', 'עזוב', 'תשכח'])('SENDS NOTHING on %s', async (answer) => {
    const { replies, sendMail } = await converse(['תשלח לאמא שאני מאחר', answer]);

    expect(sendMail).not.toHaveBeenCalled();
    expect(replies[1]).toBe('בסדר, לא שלחתי כלום.');
  });

  it('RE-ASKS rather than treating an unclear answer as consent', async () => {
    const { replies, sendMail } = await converse(['תשלח לאמא שאני מאחר', 'אמממ']);

    expect(sendMail).not.toHaveBeenCalled();
    expect(replies[1]).toContain('לשלוח');
  });

  it('sends exactly the text that was read back, not a re-parse', async () => {
    const { sendMail } = await converse(['תשלח לאמא שאני מאחר בעשרים דקות', 'כן']);
    expect(sendMail).toHaveBeenCalledWith('mum@example.com', 'אני מאחר בעשרים דקות');
  });
});

describe('choosing the recipient', () => {
  it('finds a contact whose name is an ordinary Hebrew word', async () => {
    // Regression: contact matching reused the event-title matcher, which strips filler
    // words. A contact called 'אני' filtered down to nothing and was unreachable.
    const self = stub([{ id: 'me', name: 'אני', email: 'me@example.com' }]);
    const { replies, sendMail } = await converse(['תשלח לאני שזאת בדיקה'], self);

    expect(replies[0]).toBe('לשלוח במייל לאני: "זאת בדיקה"?');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('SENDS NOTHING when no contact matches', async () => {
    const { replies, sendMail } = await converse(['תשלח ליוסי שאני מאחר']);

    expect(sendMail).not.toHaveBeenCalled();
    expect(replies[0]).toContain('לא מצאתי איש קשר');
  });

  it('SENDS NOTHING when the name is ambiguous, and lists them', async () => {
    const twins = stub([
      { id: 'a', name: 'דני כהן', email: 'a@example.com' },
      { id: 'b', name: 'דני לוי', email: 'b@example.com' },
    ]);
    const { replies, sendMail } = await converse(['תשלח לדני שאני מאחר'], twins);

    expect(sendMail).not.toHaveBeenCalled();
    expect(replies[0]).toContain('דני כהן');
    expect(replies[0]).toContain('דני לוי');
  });

  it('SENDS NOTHING to a contact with no email and no phone', async () => {
    const { replies, sendMail } = await converse(['תשלח לרותי שאני מאחר']);

    expect(sendMail).not.toHaveBeenCalled();
    expect(replies[0]).toContain('אין מייל או טלפון');
  });
});

describe('the WhatsApp fallback', () => {
  it('hands off instead of sending, and says so honestly', async () => {
    const { replies, sendMail } = await converse(['תשלח לדניאל שאני בדרך', 'כן']);

    expect(sendMail).not.toHaveBeenCalled();
    expect(replies[0]).toContain('בוואטסאפ');
    // Not 'שלחתי' — the user still has to press send.
    expect(replies[1]).not.toContain('שלחתי');
    expect(replies[1]).toContain('לחץ שלח');
  });

  it('builds a link to the right chat with the text ready', async () => {
    let state: ConversationState = emptyConversation;
    const setup = stub();

    for (const turn of ['תשלח לדניאל שאני בדרך', 'כן']) {
      const result = await handleTurn(turn, {
        provider: setup.provider,
        clock: CLOCK,
        state,
        messaging: { contacts: setup.contacts, gmail: setup.gmail },
      });
      state = result.state;

      if (result.outcome.kind === 'message-handoff') {
        expect(result.outcome.url).toBe(
          `https://wa.me/972501234567?text=${encodeURIComponent('אני בדרך')}`,
        );
        return;
      }
    }

    throw new Error('expected a handoff outcome');
  });
});

describe('when something goes wrong', () => {
  it('reports a refused scope as a mail problem, not a calendar one', async () => {
    const denied = new CalendarError('permission-denied', 'אין הרשאה לשלוח מייל. ההודעה לא נשלחה.');
    const { replies } = await converse(
      ['תשלח לאמא שאני מאחר', 'כן'],
      stub(CONTACTS, denied),
    );

    expect(replies[1]).toContain('לשלוח מייל');
    expect(replies[1]).not.toContain('יומן');
  });

  it('refuses BEFORE asking when the mail scope was not granted', async () => {
    // Google lets the user grant the calendar and refuse Gmail. Catching it here means
    // the user is told to reconnect, rather than confirming a send that cannot work.
    const setup = stub();
    const result = await handleTurn('תשלח לאמא שאני מאחר', {
      provider: setup.provider,
      clock: CLOCK,
      state: emptyConversation,
      messaging: { contacts: setup.contacts, gmail: setup.gmail, canSendMail: false },
    });

    expect(setup.sendMail).not.toHaveBeenCalled();
    expect(respond(result.outcome, CLOCK)).toContain('הרשאה');
  });

  it('still allows WhatsApp when only the mail scope was refused', async () => {
    const setup = stub();
    const result = await handleTurn('תשלח לדניאל שאני בדרך', {
      provider: setup.provider,
      clock: CLOCK,
      state: emptyConversation,
      messaging: { contacts: setup.contacts, gmail: setup.gmail, canSendMail: false },
    });

    expect(result.outcome.kind).toBe('message-confirm');
  });

  it('declines cleanly when messaging is not wired up at all', async () => {
    const setup = stub();
    const result = await handleTurn('תשלח לאמא שאני מאחר', {
      provider: setup.provider,
      clock: CLOCK,
      state: emptyConversation,
    });

    expect(setup.sendMail).not.toHaveBeenCalled();
    expect(result.outcome.kind).toBe('message-unclear');
  });
});

describe('a pending send does not swallow the next command', () => {
  it('lets a new command through instead of reading it as an answer', async () => {
    const { sendMail, replies } = await converse([
      'תשלח לאמא שאני מאחר',
      'מה יש לי מחר',
    ]);

    expect(sendMail).not.toHaveBeenCalled();
    expect(replies[1]).not.toContain('לשלוח');
  });
});
