/**
 * Reading a choice or a yes/no answer.
 *
 * Pure. Used when the assistant has listed several matching events and asked which one,
 * or has asked whether to go ahead with a deletion.
 *
 * Ordinal words collide with weekday names — 'השני' is both 'the second' and 'Monday'.
 * That is harmless here because these functions are only ever called while a choice is
 * outstanding, where the ordinal reading is the only sensible one.
 */

import { MAIL_WORDS, TITLE_FILLERS, WHATSAPP_WORDS } from '../parser/lexicon';
import { normalizeText, tokenize } from '../parser/normalize';
import { instantToZonedTime } from '../../utils/time';
import type { TimedCalendarEvent } from '../../types/calendar';

/** Ordinal stems, 1-based. */
const ORDINALS = new Map<string, number>([
  ['ראשון', 1],
  ['ראשונה', 1],
  ['שני', 2],
  ['שניה', 2],
  ['שנייה', 2],
  ['שלישי', 3],
  ['שלישית', 3],
  ['רביעי', 4],
  ['רביעית', 4],
  ['חמישי', 5],
  ['חמישית', 5],
]);

const YES_WORDS = new Set(['כן', 'אישור', 'אשר', 'תאשר', 'בטח', 'נכון', 'אוקיי', 'אוקי', 'יאללה']);
const NO_WORDS = new Set(['לא', 'עזוב', 'ביטול', 'תשכח', 'אל', 'עצור']);

export type Confirmation = 'yes' | 'no' | 'unclear';

/** Whether an action on a repeating event applies to one occurrence or all of them. */
export type SeriesScope = 'instance' | 'series' | 'unclear';

const INSTANCE_WORDS = new Set(['זה', 'הזה', 'הפעם', 'המופע', 'אחד', 'היום', 'מחר']);
const SERIES_WORDS = new Set(['הסדרה', 'סדרה', 'הכל', 'הכול', 'כולם', 'תמיד', 'כולן']);

/** Which way to send a message, when the contact can be reached both ways. */
export type ChannelChoice = 'gmail' | 'whatsapp' | 'unclear';


/**
 * Read an answer to 'this occurrence, or the whole series?'.
 *
 * 'רק' on its own is not enough — it appears in both answers ('רק את זה', 'רק הסדרה'),
 * so the distinguishing noun has to be present. Anything else is unclear, and the
 * caller asks again rather than picking the more destructive reading.
 */
export function readSeriesScope(text: string): SeriesScope {
  const tokens = tokenize(normalizeText(text));

  const has = (words: ReadonlySet<string>): boolean =>
    tokens.some((token) => token.forms.some((form) => words.has(form.stem)));

  // 'כל' only means the series when it is not part of 'כל אחד' or similar; pairing it
  // with the series nouns keeps it unambiguous.
  const saysSeries = has(SERIES_WORDS) || tokens.some((token) => token.raw === 'הסדרה');
  const saysInstance = has(INSTANCE_WORDS);

  if (saysSeries && !saysInstance) return 'series';
  if (saysInstance && !saysSeries) return 'instance';
  return 'unclear';
}

/**
 * Read 'במייל' or 'בוואטסאפ' as an answer.
 *
 * Naming a channel is itself the confirmation to send, so this deliberately does NOT
 * fall back to either side: mentioning both, or neither, is 'unclear' and the
 * assistant asks again rather than choosing where someone's message goes.
 */
export function readChannelChoice(text: string): ChannelChoice {
  const tokens = tokenize(normalizeText(text));

  const has = (words: ReadonlySet<string>): boolean =>
    tokens.some((token) => token.forms.some((form) => words.has(form.stem)));

  const saysMail = has(MAIL_WORDS);
  const saysWhatsApp = has(WHATSAPP_WORDS);

  if (saysMail && !saysWhatsApp) return 'gmail';
  if (saysWhatsApp && !saysMail) return 'whatsapp';
  return 'unclear';
}

/**
 * A 'no' that also says what the right answer was.
 *
 * 'לא, לאברהם' and 'לא, שאני מאחר' are one turn doing two jobs: rejecting what was read
 * back, and supplying the correction. Today `readConfirmation` stops at the first NO
 * token and the rest of the sentence is never looked at, so the whole request is thrown
 * away and the user starts over.
 *
 * Returns the substantive remainder after the negation, or undefined when there is
 * nothing after it — a bare 'לא' keeps its ordinary meaning everywhere.
 *
 * This is deliberately only consulted at CONFIRMATION steps, where the expected answer
 * is yes or no. It is never consulted while the assistant is asking 'מה לכתוב?', where
 * every word is message text and 'לא, שאני מאחר' is a message someone might mean to send.
 */
export function readCorrection(text: string): string | undefined {
  const normalized = normalizeText(text);
  const tokens = tokenize(normalized);

  const first = tokens[0];
  if (first === undefined) return undefined;

  // The negation has to lead. 'תגיד לו שלא באתי' is not a correction.
  const negated = first.forms.some((form) => NO_WORDS.has(form.stem));
  if (!negated) return undefined;

  const rest = tokens.slice(1);
  if (rest.length === 0) return undefined;

  // 'לא רוצה' and 'לא, לא רוצה' are refusals elaborated, not corrections. A correction
  // has to carry something that could actually BE the replacement, so the remainder
  // needs at least one word that is neither another refusal nor a filler.
  const substantive = rest.some(
    (token) =>
      !TITLE_FILLERS.has(token.raw) &&
      !token.forms.some((form) => NO_WORDS.has(form.stem)),
  );
  if (!substantive) return undefined;

  const start = rest[0];
  const last = rest[rest.length - 1];
  if (start === undefined || last === undefined) return undefined;

  return normalized.slice(start.start, last.end).trim();
}

/**
 * Read 'הראשון' or '2' as a position in a list the assistant just read out.
 *
 * Returns a zero-based index, or undefined when the answer does not name a position —
 * the caller then tries to read it as something else rather than guessing.
 */
export function readOrdinal(text: string, count: number): number | undefined {
  if (count === 0) return undefined;

  const normalized = normalizeText(text);

  for (const token of tokenize(normalized)) {
    for (const form of token.forms) {
      const ordinal = ORDINALS.get(form.stem);
      if (ordinal !== undefined && ordinal <= count) return ordinal - 1;

      if (/^\d+$/.test(form.stem)) {
        const index = Number.parseInt(form.stem, 10);
        if (index >= 1 && index <= count) return index - 1;
      }
    }
  }

  return undefined;
}

/** Read a yes/no answer. Anything unrecognised is 'unclear', never a silent yes. */
export function readConfirmation(text: string): Confirmation {
  const tokens = tokenize(normalizeText(text));

  for (const token of tokens) {
    for (const form of token.forms) {
      if (NO_WORDS.has(form.stem)) return 'no';
    }
  }
  for (const token of tokens) {
    for (const form of token.forms) {
      if (YES_WORDS.has(form.stem)) return 'yes';
    }
  }

  return 'unclear';
}

/**
 * Work out which of the listed events the user meant.
 *
 * Accepts an ordinal ('השני'), a plain number ('2'), or the event's start time
 * ('15:00' or 'של שלוש'). Returns undefined when the answer does not single one out —
 * the caller then asks again rather than picking.
 */
export function readChoice(
  text: string,
  matches: readonly TimedCalendarEvent[],
  timeZone: string,
): TimedCalendarEvent | undefined {
  if (matches.length === 0) return undefined;

  const normalized = normalizeText(text);
  const tokens = tokenize(normalized);

  // An ordinal or a bare index.
  for (const token of tokens) {
    for (const form of token.forms) {
      const ordinal = ORDINALS.get(form.stem);
      if (ordinal !== undefined && ordinal <= matches.length) {
        return matches[ordinal - 1];
      }

      if (/^\d+$/.test(form.stem)) {
        const index = Number.parseInt(form.stem, 10);
        // A bare number is only an index when it is in range; otherwise it is more
        // likely a time, handled below.
        if (index >= 1 && index <= matches.length && !normalized.includes(':')) {
          return matches[index - 1];
        }
      }
    }
  }

  // The event's own start time, which is what the assistant listed.
  const byTime = matches.filter((event) => {
    const start = new Date(event.start);
    if (Number.isNaN(start.getTime())) return false;
    const local = instantToZonedTime(start, timeZone);
    const hour = local.time.slice(0, 2);
    return (
      normalized.includes(local.time) ||
      normalized.includes(`${Number.parseInt(hour, 10)}:${local.time.slice(3)}`)
    );
  });

  return byTime.length === 1 ? byTime[0] : undefined;
}
