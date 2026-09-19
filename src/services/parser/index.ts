/**
 * Hebrew command parser — entry point.
 *
 * parseCommand is a PURE function of (text, clock):
 *   - no fetch, no calendar access, no localStorage, no DOM
 *   - no `new Date()` / `Date.now()` — the current instant arrives via the Clock
 *
 * It emits a ParsedCommand and nothing else. It never decides to create, move or delete
 * anything; validation (Stage 2) and the conversation layer (Stage 6) act on its output.
 */

import { detectIntent, type IntentMatch } from './intent';
import { findDate } from './dateParser';
import { findRecurrence } from './recurrence';
import { findDuration } from './durationParser';
import { findMessageBody, findRecipient } from './messageParser';
import { findTimes, questionFor, type TimeExpression } from './timeParser';
import {
  hasAnyStem,
  matchForm,
  matchPhrase,
  normalizeText,
  tokenAt,
  tokenize,
  type Token,
} from './normalize';
import {
  DAY_PARTS,
  DAY_PART_DAYS,
  FIRST_FREE_PHRASES,
  MAIL_WORDS,
  MESSAGE_NOUNS,
  RECIPIENT_SKIP,
  WHATSAPP_WORDS,
} from './lexicon';
import { extractTitle } from './titleExtractor';
import type { Clock } from '../../utils/clock';
import type { Ambiguity, Intent, ParsedCommand, SlotName } from '../../types/parser';

export { normalizeText, tokenize } from './normalize';
export type { Token, TokenForm } from './normalize';

/**
 * Longest event we are willing to infer from a bare end hour.
 *
 * Used only to resolve an end time against an already-known start, never to guess a
 * start. In 'ב-10 בבוקר עד 11' the readings 11:00 and 23:00 both fall after 10:00, but
 * 23:00 would be a 13-hour meeting, so 11:00 is the only sane reading and the parser can
 * resolve it without asking. This is a constraint, not an AM/PM heuristic.
 */
const MAX_INFERRED_EVENT_MINUTES = 12 * 60;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number.parseInt(hours ?? '0', 10) * 60 + Number.parseInt(minutes ?? '0', 10);
}

function fromMinutes(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Narrow an ambiguous end time using the resolved start.
 *
 * Returns the single surviving reading, or undefined if the choice is still open.
 */
function resolveEndAgainstStart(end: TimeExpression, startTime: string): string | undefined {
  const startMinutes = toMinutes(startTime);

  const viable = end.candidates.filter((candidate) => {
    const length = toMinutes(candidate) - startMinutes;
    return length > 0 && length <= MAX_INFERRED_EVENT_MINUTES;
  });

  return viable.length === 1 ? viable[0] : undefined;
}

/**
 * Narrow an ambiguous START using a resolved END — the mirror of the rule above.
 *
 * This is what makes 'משמונה עד עשר בבוקר' work: one qualifier at the end of a range
 * governs both halves, and only 08:00 can precede a 10:00 finish by a sane amount.
 * Constraint-based, not a guess: if more than one reading survives, it stays ambiguous.
 */
function resolveStartAgainstEnd(start: TimeExpression, endTime: string): string | undefined {
  const endMinutes = toMinutes(endTime);

  const viable = start.candidates.filter((candidate) => {
    const length = endMinutes - toMinutes(candidate);
    return length > 0 && length <= MAX_INFERRED_EVENT_MINUTES;
  });

  return viable.length === 1 ? viable[0] : undefined;
}

function computeMissing(
  intent: Intent,
  slots: {
    title: string | undefined;
    date: string | undefined;
    dateRange: unknown;
    hasTimeExpression: boolean;
    startTime: string | undefined;
    endTime: string | undefined;
    durationMinutes: number | undefined;
  },
): SlotName[] {
  const missing: SlotName[] = [];
  const hasDate = slots.date !== undefined || slots.dateRange !== undefined;

  switch (intent) {
    case 'CREATE':
      if (slots.title === undefined) missing.push('title');
      if (!hasDate) missing.push('date');
      // An ambiguous hour is NOT missing — the information is there, it just needs
      // disambiguating. It is reported through `ambiguities` instead.
      if (!slots.hasTimeExpression) missing.push('startTime');
      if (slots.durationMinutes === undefined && slots.endTime === undefined) {
        missing.push('duration');
      }
      break;

    case 'UPDATE':
      if (slots.title === undefined) missing.push('title');
      if (!slots.hasTimeExpression && !hasDate) missing.push('startTime');
      break;

    case 'DELETE':
      if (slots.title === undefined) missing.push('title');
      break;

    case 'QUERY':
    case 'FIND_FREE':
      if (!hasDate) missing.push('date');
      break;

    // Handled entirely by buildSendMessage, which never reaches this switch. The case
    // is here so the day someone removes that early return, this is a visible gap
    // rather than a silent empty list.
    case 'SEND_MESSAGE':
    case 'UNKNOWN':
      break;
  }

  return missing;
}

function computeConfidence(
  intent: Intent,
  hasDate: boolean,
  hasTime: boolean,
  hasDuration: boolean,
  hasTitle: boolean,
): number {
  let score = intent === 'UNKNOWN' ? 0.1 : 0.35;
  if (hasDate) score += 0.2;
  if (hasTime) score += 0.2;
  if (hasDuration) score += 0.1;
  if (hasTitle) score += 0.15;
  return Math.min(1, Number(score.toFixed(2)));
}

/**
 * Assemble a send request.
 *
 * Kept separate from the scheduling pipeline entirely — it shares the tokenizer and
 * nothing else, because none of the calendar slots mean anything here.
 */
function buildSendMessage(
  rawText: string,
  normalizedText: string,
  tokens: Token[],
  intentMatch: IntentMatch | undefined,
  clock: Clock,
): ParsedCommand {
  const verbEnd = intentMatch === undefined ? 0 : Math.max(...intentMatch.tokens) + 1;

  const recipient = findRecipient(tokens, verbEnd);
  const bodyFrom = recipient === undefined ? verbEnd : Math.max(...recipient.tokens) + 1;
  const body = findMessageBody(tokens, normalizedText, bodyFrom);

  // Everything the user said between the recipient and the start of the message. It used
  // to be dropped on the floor: 'תשלח לאמא מחר בבוקר שאני מאחר' lost 'מחר בבוקר' entirely,
  // and the message went out with no hint that a timing instruction had been ignored.
  const bodyStart = body === undefined ? tokens.length : Math.min(...body.tokens);
  const gap = readGap(tokens, bodyFrom, bodyStart, clock);

  // A stray word beside the name is usually the name: 'לדני אל' is one misheard 'לדניאל',
  // and 'לאמא של דניאל' is one person. Resolution against the contact book decides.
  const name =
    recipient === undefined
      ? undefined
      : [recipient.name, ...gap.nameWords].join(' ').trim();

  const missing: SlotName[] = [];
  if (name === undefined) missing.push('recipient');
  if (body === undefined) missing.push('messageBody');

  let confidence = 0.35;
  if (name !== undefined) confidence += 0.3;
  if (body !== undefined) confidence += 0.3;

  return {
    intent: 'SEND_MESSAGE',
    ...(name !== undefined ? { recipient: name } : {}),
    ...(body !== undefined ? { messageBody: body.text } : {}),
    ...(gap.channel !== undefined ? { channel: gap.channel } : {}),
    ...(gap.scheduleAttempt ? { scheduleAttempt: true as const } : {}),
    missing,
    // Free text has nothing to disambiguate — there is no second reading of a sentence.
    ambiguities: [],
    confidence: Number(confidence.toFixed(2)),
    rawText,
    normalizedText,
  };
}

interface GapReading {
  channel?: 'gmail' | 'whatsapp';
  /** The user asked for it to go out later — which this app cannot do. */
  scheduleAttempt: boolean;
  /** Words that belong to the recipient's name. */
  nameWords: string[];
}

/**
 * Account for every token between the recipient and the message.
 *
 * Consumed in a fixed order, the same tactic the main pipeline uses: a named channel
 * first, then anything that looks like a time, and whatever survives is part of the name.
 * Nothing is allowed to fall through unclaimed — silently discarding what someone said is
 * the one outcome this function exists to prevent.
 */
function readGap(
  tokens: Token[],
  from: number,
  toExclusive: number,
  clock: Clock,
): GapReading {
  const reading: GapReading = { scheduleAttempt: false, nameWords: [] };
  if (from >= toExclusive) return reading;

  const claimed = new Set<number>();

  // Everything outside the gap is off limits, so the date and time matchers below read
  // only these tokens rather than rediscovering the whole utterance.
  const outside = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (index < from || index >= toExclusive) outside.add(index);
  }

  for (let index = from; index < toExclusive; index += 1) {
    const token = tokenAt(tokens, index);
    if (token === undefined) continue;

    if (hasAnyStem(token, MAIL_WORDS) !== undefined) {
      reading.channel = 'gmail';
      claimed.add(index);
      continue;
    }
    if (hasAnyStem(token, WHATSAPP_WORDS) !== undefined) {
      reading.channel = 'whatsapp';
      claimed.add(index);
      continue;
    }
    // A bare day-part carries no hour, so neither findDate nor findTimes below will
    // claim it — but 'בבוקר' is plainly about when, not about who.
    if (
      matchForm(token, DAY_PARTS) !== undefined ||
      DAY_PART_DAYS.has(token.raw)
    ) {
      reading.scheduleAttempt = true;
      claimed.add(index);
      continue;
    }

    // 'הודעה' names the thing being sent, not the person.
    if (hasAnyStem(token, MESSAGE_NOUNS) !== undefined) claimed.add(index);
  }

  const dateMatch = findDate(tokens, outside, clock);
  dateMatch?.tokens.forEach((index) => {
    reading.scheduleAttempt = true;
    claimed.add(index);
  });

  findTimes(tokens, new Set([...outside, ...claimed])).forEach((expression) => {
    expression.tokens.forEach((index) => {
      reading.scheduleAttempt = true;
      claimed.add(index);
    });
  });

  for (let index = from; index < toExclusive; index += 1) {
    if (claimed.has(index)) continue;
    const token = tokenAt(tokens, index);
    if (token === undefined) continue;
    if (RECIPIENT_SKIP.has(token.raw)) continue;
    reading.nameWords.push(token.raw);
  }

  return reading;
}

export function parseCommand(rawText: string, clock: Clock): ParsedCommand {
  const normalizedText = normalizeText(rawText);
  const tokens = tokenize(normalizedText);
  const consumed = new Set<number>();

  const intentMatch = detectIntent(tokens);
  const intent: Intent = intentMatch?.intent ?? 'UNKNOWN';
  intentMatch?.tokens.forEach((index) => consumed.add(index));

  // A message has no date, hour or duration of its own — every word after the recipient
  // is text a human will read. Returning here is what protects the 'מחר' of
  // 'תשלח לאמא שהפגישה מחר נדחית': the scheduling matchers never run at all.
  //
  // Claiming the body up front and letting them run would NOT be equivalent. They check
  // `consumed` only at their loop head; their continuation readers (parseTimeAt,
  // readDurationBody, readNumber) read forward without consulting it, so a match
  // starting just before the body could straddle into it. Not running them removes the
  // class of bug rather than betting against it.
  //
  // The cost is that scheduled sends ('תשלח לאמא מחר בבוקר ש…') are out of scope: the
  // time lands in the body. Supporting them later means gating the block below on the
  // intent instead of returning, and bounding findDate to the left of the body.
  if (intent === 'SEND_MESSAGE') {
    return buildSendMessage(rawText, normalizedText, tokens, intentMatch, clock);
  }

  // Before the date: 'כל' is consumed here, while 'יום שני' is deliberately left so
  // the date parser can turn it into a concrete first occurrence.
  const recurrenceMatch = findRecurrence(tokens, consumed);
  recurrenceMatch?.tokens.forEach((index) => consumed.add(index));

  const dateMatch = findDate(tokens, consumed, clock);
  dateMatch?.tokens.forEach((index) => consumed.add(index));

  // Before the time parser: 'בשעה הפנויה הראשונה' starts with an hour marker, and
  // leaving it for findTimes would have it read as the beginning of a clock time.
  const useFirstFreeSlot = consumeFirstFreePhrase(tokens, consumed);

  // Times before durations: the time parser claims the 'לשעה' of 'תעביר לשעה 8' so the
  // duration parser cannot mistake it for a one-hour duration.
  const timeExpressions = findTimes(tokens, consumed);
  timeExpressions.forEach((expression) => {
    expression.tokens.forEach((index) => consumed.add(index));
  });

  const durationMatch = findDuration(tokens, consumed);
  durationMatch?.tokens.forEach((index) => consumed.add(index));

  const title = extractTitle(tokens, consumed);

  const startExpression = timeExpressions.find((expression) => !expression.isEnd);
  const endExpression = timeExpressions.find((expression) => expression.isEnd);

  const ambiguities: Ambiguity[] = [];

  // 'בעוד שעתיים' fixes an exact moment, so its time wins over anything the time
  // parser might have picked up elsewhere in the sentence.
  let startTime = dateMatch?.startTime ?? startExpression?.resolved;

  // A range shares one qualifier: 'משמונה עד עשר בבוקר' resolves the end, and the
  // start then follows from it.
  if (
    startTime === undefined &&
    startExpression !== undefined &&
    endExpression?.resolved !== undefined
  ) {
    startTime = resolveStartAgainstEnd(startExpression, endExpression.resolved);
  }

  if (startExpression !== undefined && startTime === undefined) {
    ambiguities.push({
      slot: 'startTime',
      candidates: startExpression.candidates,
      question: questionFor(startExpression.candidates),
    });
  }

  let endTime: string | undefined;
  if (endExpression !== undefined) {
    if (endExpression.resolved !== undefined) {
      endTime = endExpression.resolved;
    } else if (startTime !== undefined) {
      // Constraint-based, not a guess: only a reading that yields a sane event length.
      endTime = resolveEndAgainstStart(endExpression, startTime);
    }

    if (endTime === undefined) {
      ambiguities.push({
        slot: 'endTime',
        candidates: endExpression.candidates,
        question: questionFor(endExpression.candidates),
      });
    }
  }

  // Derive the missing half of the start/end/duration triangle where possible.
  let durationMinutes = durationMatch?.minutes;
  if (durationMinutes === undefined && startTime !== undefined && endTime !== undefined) {
    const span = toMinutes(endTime) - toMinutes(startTime);
    if (span > 0) durationMinutes = span;
  } else if (endTime === undefined && startTime !== undefined && durationMinutes !== undefined) {
    endTime = fromMinutes(toMinutes(startTime) + durationMinutes);
  }

  const missing = computeMissing(intent, {
    title,
    date: dateMatch?.date,
    dateRange: dateMatch?.range,
    hasTimeExpression:
      startExpression !== undefined || dateMatch?.startTime !== undefined || useFirstFreeSlot,
    startTime,
    endTime,
    durationMinutes,
  });

  const confidence = computeConfidence(
    intent,
    dateMatch !== undefined,
    startExpression !== undefined,
    durationMinutes !== undefined,
    title !== undefined,
  );

  // Built with conditional spreads: `exactOptionalPropertyTypes` is on, so an absent
  // slot must be genuinely absent rather than explicitly set to undefined.
  return {
    intent,
    ...(title !== undefined ? { title } : {}),
    ...(dateMatch?.date !== undefined ? { date: dateMatch.date } : {}),
    ...(dateMatch?.range !== undefined ? { dateRange: dateMatch.range } : {}),
    ...(startTime !== undefined ? { startTime } : {}),
    ...(endTime !== undefined ? { endTime } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(useFirstFreeSlot ? { useFirstFreeSlot: true } : {}),
    ...(recurrenceMatch !== undefined ? { recurrence: recurrenceMatch.recurrence } : {}),
    missing,
    ambiguities,
    confidence,
    rawText,
    normalizedText,
  };
}

/** Find and consume 'בזמן הפנוי הראשון' and its variants. */
function consumeFirstFreePhrase(
  tokens: ReturnType<typeof tokenize>,
  consumed: Set<number>,
): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    if (consumed.has(index)) continue;

    for (const phrase of FIRST_FREE_PHRASES) {
      const end = matchPhrase(tokens, index, phrase);
      if (end === undefined) continue;

      for (let i = index; i < end; i += 1) consumed.add(i);
      return true;
    }
  }
  return false;
}
