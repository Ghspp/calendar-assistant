/**
 * Parsing a send request.
 *
 * The recurring theme of these tests is that a message is TEXT, not slots: words that
 * would be a date, an hour or a duration anywhere else must survive inside it exactly
 * as spoken. Most of the assertions below are really about what the parser did NOT do.
 */

import { describe, expect, it } from 'vitest';
import { parseCommand } from './index';
import { fixedClock } from '../../utils/clock';

/** Sunday 2026-09-13, 12:00 Israel local time. */
const CLOCK = fixedClock('2026-09-13T09:00:00Z');

function parse(text: string) {
  return parseCommand(text, CLOCK);
}

describe('recognising a send request', () => {
  it.each([
    'תשלח לאמא שאני מאחר',
    'שלח לדניאל הודעה שאני בדרך',
    'שלח הודעה לדניאל שאני בדרך',
    'תשלח לרותי תודה רבה על היום',
    'תגיד לאמא שאני לא מגיע לארוחת ערב',
    'אפשר לשלוח לאמא שאני מאחר',
    'תכתוב לדניאל שהפגישה בוטלה',
    'תמסור לאמא שהכל בסדר',
  ])('reads %s as a message', (text) => {
    expect(parse(text).intent).toBe('SEND_MESSAGE');
  });

  it('leaves a bare discourse opener as the question it is', () => {
    // 'תגיד' only means "send" when it takes an object. Without the gate, leftmost-wins
    // would turn this whole sentence into a message.
    expect(parse('תגיד מה יש לי מחר').intent).not.toBe('SEND_MESSAGE');
  });

  it.each([
    ['תקבע לי פגישה עם דניאל מחר בשש בערב לשעה', 'CREATE'],
    ['תבטל את הפגישה מחר', 'DELETE'],
    ['תעביר את הפגישה לשעה 8', 'UPDATE'],
    ['מה יש לי מחר', 'QUERY'],
  ])('leaves %s alone', (text, intent) => {
    expect(parse(text).intent).toBe(intent);
  });
});

describe('the recipient', () => {
  it.each([
    ['תשלח לאמא שאני מאחר', 'אמא'],
    ['תשלח לדניאל שאני מאחר', 'דניאל'],
    ['שלח הודעה לרותי שאני מאחר', 'רותי'],
    ['תגיד לאבא שאני בדרך', 'אבא'],
  ])('%s → %s', (text, recipient) => {
    expect(parse(text).recipient).toBe(recipient);
  });

  it('accepts a name that collides with a Hebrew keyword', () => {
    // 'שני' is not a weekday unless preceded by 'יום', so it is free to be a person.
    expect(parse('תשלח לשני שאני מאחר').recipient).toBe('שני');
  });

  it('does not mistake the politeness particle for a person', () => {
    expect(parse('תשלח לי הודעה שאני מאחר').recipient).not.toBe('י');
  });

  it('reports a missing recipient rather than inventing one', () => {
    const parsed = parse('שלח הודעה שאני מאחר');
    expect(parsed.recipient).toBeUndefined();
    expect(parsed.missing).toContain('recipient');
  });
});

describe('the message body is verbatim', () => {
  it.each([
    ['תשלח לאמא שאני מאחר בעשרים דקות', 'אני מאחר בעשרים דקות'],
    ['שלח לדניאל הודעה שאני בדרך', 'אני בדרך'],
    ['תגיד לאמא שאני לא מגיע לארוחת ערב', 'אני לא מגיע לארוחת ערב'],
    ['שלח הודעה לדניאל שהפגישה מחר נדחית', 'הפגישה מחר נדחית'],
    ['תשלח לרותי תודה רבה על היום', 'תודה רבה על היום'],
  ])('%s → %s', (text, body) => {
    expect(parse(text).messageBody).toBe(body);
  });

  it('keeps words the title extractor would have thrown away', () => {
    // TITLE_FILLERS contains 'תודה', 'אני', 'מה' and 'זה'. Re-joining unconsumed tokens
    // instead of slicing would silently gut the message.
    expect(parse('תשלח לאמא תודה על הכל').messageBody).toBe('תודה על הכל');
    expect(parse('תשלח לאמא שאני רוצה לדעת מה קורה').messageBody).toBe(
      'אני רוצה לדעת מה קורה',
    );
  });

  it('does not drag a trailing full stop into the message', () => {
    // tokenize keeps punctuation inside [start,end) but strips it from `raw`, so a
    // naive slice on the raw offsets picks the period up.
    expect(parse('תשלח לאמא שאני מאחר.').messageBody).toBe('אני מאחר');
  });

  it.each([
    ['תשלח לאני שזאת בדיקה', 'זאת בדיקה'],
    ['תשלח לאמא שזו טעות', 'זו טעות'],
    ['תשלח לדניאל שכבר יצאתי', 'כבר יצאתי'],
    ['תשלח לאמא שהיה כיף', 'היה כיף'],
    ['תשלח לדניאל שמשהו קרה', 'משהו קרה'],
  ])('strips the complementizer in %s', (text, body) => {
    expect(parse(text).messageBody).toBe(body);
  });

  it.each([
    ['תשלח לדניאל שלום', 'שלום'],
    ['תשלח לדניאל שאלה', 'שאלה'],
    ['תשלח לאמא שבת שלום', 'שבת שלום'],
  ])('does not strip a ש that is part of the word in %s', (text, body) => {
    expect(parse(text).messageBody).toBe(body);
  });

  it('is always a substring of the normalized text', () => {
    for (const text of [
      'תשלח לאמא שאני מאחר בעשרים דקות',
      'תשלח לרותי תודה רבה על היום',
      'שלח הודעה לדניאל שהפגישה מחר נדחית',
      'תשלח לדניאל שלום',
    ]) {
      const parsed = parse(text);
      expect(parsed.messageBody).toBeDefined();
      expect(parsed.normalizedText).toContain(parsed.messageBody);
    }
  });

  it('reports a missing body rather than sending an empty one', () => {
    const parsed = parse('תשלח לאמא');
    expect(parsed.messageBody).toBeUndefined();
    expect(parsed.missing).toContain('messageBody');
  });
});

describe('scheduling words inside a message are left alone', () => {
  it('does not read a date out of the message', () => {
    const parsed = parse('שלח הודעה לדניאל שהפגישה מחר נדחית');
    expect(parsed.messageBody).toContain('מחר');
    expect(parsed.date).toBeUndefined();
  });

  it('does not read an hour out of the message', () => {
    const parsed = parse('תשלח לדניאל שהפגישה ב-15:00 נדחית');
    expect(parsed.messageBody).toContain('15:00');
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.ambiguities).toEqual([]);
  });

  it('does not read a duration out of the message', () => {
    const parsed = parse('תשלח לאמא שאני מאחר בעשרים דקות');
    expect(parsed.durationMinutes).toBeUndefined();
  });

  it('does not read a repetition rule out of the message', () => {
    const parsed = parse('תשלח לדניאל שכל יום שני יש אימון');
    expect(parsed.recurrence).toBeUndefined();
  });

  it('never produces an event title', () => {
    // A title here would mean the scheduling pipeline ran, which is the bug this
    // whole code path is shaped to prevent.
    for (const text of [
      'תשלח לאמא שאני מאחר בעשרים דקות',
      'שלח הודעה לדניאל שהפגישה מחר נדחית',
      'תשלח לרותי תודה רבה על היום',
    ]) {
      expect(parse(text).title).toBeUndefined();
    }
  });

  it('is not fooled by a command verb inside the message', () => {
    // 'מבטל' strips מ to 'בטל', a DELETE verb — but 'תשלח' already won at index 0.
    const parsed = parse('תשלח לאמא שאני מבטל את הפגישה');
    expect(parsed.intent).toBe('SEND_MESSAGE');
    expect(parsed.messageBody).toBe('אני מבטל את הפגישה');
  });
});
