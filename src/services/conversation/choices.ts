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

const MAIL_WORDS = new Set(['מייל', 'אימייל', 'מיל', 'דואר', 'איימייל', 'mail', 'email', 'gmail']);

/**
 * WhatsApp, spelled every way Hebrew speech recognition renders it.
 *
 * The transcriber is inconsistent about the צ/ט and about how many vavs it uses, and
 * a spelling that is missing here reads as 'unclear' and makes the assistant ask
 * again — so the list is deliberately generous.
 */
const WHATSAPP_WORDS = new Set([
  'וואטסאפ',
  'ווטסאפ',
  'וואצאפ',
  'ווצאפ',
  'ואטסאפ',
  'ואצאפ',
  'וואטסאף',
  'וואטס',
  'ווטס',
  'whatsapp',
  'wa',
]);

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
