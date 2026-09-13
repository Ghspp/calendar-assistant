/**
 * Slot bookkeeping for a half-finished request.
 *
 * Pure. This module knows what has been gathered so far and how to fold a short answer
 * into it. It does NOT decide what to ask — that is the validator's job, so the wording
 * of every question lives in exactly one place.
 *
 * The rule that makes multi-turn scheduling safe: **an answer never overwrites a slot
 * that is already resolved.** Answering 'בבוקר או בערב?' settles the hour and nothing
 * else; a date established two turns ago stays exactly as it was.
 */

import type { Ambiguity, ParsedCommand, SlotName } from '../../types/parser';
import { parseCommand } from '../parser';
import { applyDayPart, readDayPart, questionFor } from '../parser/timeParser';
import { tokenize, normalizeText } from '../parser/normalize';
import type { Clock } from '../../utils/clock';

/** Everything a CREATE command needs. */
export interface CommandSlots {
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  /** An hour that was heard but not resolved. */
  pendingAmbiguity?: Ambiguity;
}

/** Words that abandon the request outright. */
const CANCEL_PHRASES = ['עזוב', 'לא משנה', 'שכח מזה', 'עזבי', 'בטל את זה', 'לא חשוב'];

export function isCancellation(text: string): boolean {
  const normalized = normalizeText(text);
  return CANCEL_PHRASES.some((phrase) => normalized === phrase || normalized.includes(phrase));
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * Resolve an ambiguous hour from a day-part answer such as 'בערב'.
 *
 * Reconstructs the original 1-12 reading from the candidate pair and runs it through
 * the parser's own applyDayPart, so a one-word answer resolves exactly as an inline
 * qualifier would have.
 */
export function resolveAmbiguityFromAnswer(
  candidates: readonly string[],
  answer: string,
): string | undefined {
  const earliest = candidates[0];
  if (earliest === undefined) return undefined;

  const [hourText, minuteText] = earliest.split(':');
  if (hourText === undefined || minuteText === undefined) return undefined;

  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return undefined;

  // Candidates are ascending, so the earliest is the AM reading — except for twelve,
  // where the pair is 00:mm / 12:mm and the 1-12 reading is 12.
  const hour12 = hour === 0 ? 12 : hour;

  const tokens = tokenize(normalizeText(answer));

  // Scan the whole answer: 'בערב', 'ערב', and 'זה בערב' must all work.
  for (let index = 0; index < tokens.length; index += 1) {
    const dayPart = readDayPart(tokens, index);
    if (dayPart === undefined) continue;

    const resolved = `${pad2(applyDayPart(hour12, dayPart.part))}:${pad2(minute)}`;
    if (candidates.includes(resolved)) return resolved;
  }

  return undefined;
}

/**
 * Read a duration from a bare answer such as 'שעה' or 'חצי שעה'.
 *
 * The parser requires the ל particle to recognise a duration, because ב+שעה is a clock
 * time. A standalone answer has no particle, so it is re-parsed behind the explicit
 * marker 'למשך', which accepts a bare body and costs no new parsing rules.
 */
export function readBareDuration(answer: string, clock: Clock): number | undefined {
  const direct = parseCommand(answer, clock).durationMinutes;
  if (direct !== undefined) return direct;

  return parseCommand(`למשך ${normalizeText(answer)}`, clock).durationMinutes;
}

export interface MergeContext {
  /** The slot the outstanding question was about. */
  asking?: SlotName | 'ambiguity';
  /** Candidates of the outstanding ambiguity, when that is what we asked. */
  candidates?: readonly string[];
}

/**
 * Fold an answer into the slots gathered so far.
 *
 * Fills the slot that was asked about, then opportunistically fills any slot that is
 * still empty — so 'בשש בערב לשעה' can answer three questions at once. Slots that are
 * already set are never touched.
 */
export function mergeAnswer(
  slots: CommandSlots,
  answer: string,
  context: MergeContext,
  clock: Clock,
): CommandSlots {
  const fragment = parseCommand(answer, clock);
  const next: CommandSlots = { ...slots };

  // 1. An answer to a day-part question settles the hour and nothing else.
  if (context.asking === 'ambiguity' && context.candidates !== undefined) {
    const resolved =
      resolveAmbiguityFromAnswer(context.candidates, answer) ?? fragment.startTime;

    if (resolved !== undefined) {
      next.startTime = resolved;
      delete next.pendingAmbiguity;
    } else if (fragment.ambiguities.length > 0) {
      // The user restated the hour and it is still ambiguous — ask again about the new one.
      const restated = fragment.ambiguities.find((item) => item.slot === 'startTime');
      if (restated !== undefined) next.pendingAmbiguity = restated;
    }
  }

  // 2. An explicit hour in the answer always counts, even mid-conversation.
  if (fragment.startTime !== undefined && next.startTime === undefined) {
    next.startTime = fragment.startTime;
    delete next.pendingAmbiguity;
  }

  // 3. A newly heard but unresolved hour becomes the next question.
  if (next.startTime === undefined && next.pendingAmbiguity === undefined) {
    const heard = fragment.ambiguities.find((item) => item.slot === 'startTime');
    if (heard !== undefined) next.pendingAmbiguity = heard;
  }

  if (next.date === undefined && fragment.date !== undefined) next.date = fragment.date;

  if (next.durationMinutes === undefined) {
    const duration =
      context.asking === 'duration'
        ? readBareDuration(answer, clock)
        : fragment.durationMinutes;
    if (duration !== undefined) next.durationMinutes = duration;
  }

  if (next.endTime === undefined && fragment.endTime !== undefined) {
    next.endTime = fragment.endTime;
  }

  // 4. A title answer is taken literally — whatever was said is the event's name.
  if (next.title === undefined) {
    if (context.asking === 'title') {
      const literal = normalizeText(answer);
      if (literal.length > 0) next.title = literal;
    } else if (fragment.title !== undefined) {
      next.title = fragment.title;
    }
  }

  return next;
}

/** Seed the slots from a complete first utterance. */
export function slotsFromCommand(command: ParsedCommand): CommandSlots {
  const ambiguity = command.ambiguities.find((item) => item.slot === 'startTime');

  return {
    ...(command.title !== undefined ? { title: command.title } : {}),
    ...(command.date !== undefined ? { date: command.date } : {}),
    ...(command.startTime !== undefined ? { startTime: command.startTime } : {}),
    ...(command.endTime !== undefined ? { endTime: command.endTime } : {}),
    ...(command.durationMinutes !== undefined
      ? { durationMinutes: command.durationMinutes }
      : {}),
    ...(ambiguity !== undefined ? { pendingAmbiguity: ambiguity } : {}),
  };
}

/**
 * Which slots are still empty.
 *
 * Mirrors the parser's own rule for CREATE deliberately: an unresolved hour is NOT
 * missing — the information is there and only needs disambiguating, which is reported
 * through the ambiguity instead.
 */
export function missingSlots(slots: CommandSlots): SlotName[] {
  const missing: SlotName[] = [];
  if (slots.title === undefined) missing.push('title');
  if (slots.date === undefined) missing.push('date');
  if (slots.startTime === undefined && slots.pendingAmbiguity === undefined) {
    missing.push('startTime');
  }
  if (slots.durationMinutes === undefined && slots.endTime === undefined) {
    missing.push('duration');
  }
  return missing;
}

/**
 * Rebuild a ParsedCommand from the gathered slots.
 *
 * The result goes through the ordinary validator, so a multi-turn request is subject to
 * exactly the same gate as a single-shot one — including the rule that an unresolved
 * hour can never reach the calendar.
 */
export function toParsedCommand(slots: CommandSlots, rawText: string): ParsedCommand {
  const ambiguities: Ambiguity[] =
    slots.pendingAmbiguity !== undefined
      ? [
          {
            slot: 'startTime',
            candidates: slots.pendingAmbiguity.candidates,
            question: questionFor(slots.pendingAmbiguity.candidates),
          },
        ]
      : [];

  return {
    intent: 'CREATE',
    ...(slots.title !== undefined ? { title: slots.title } : {}),
    ...(slots.date !== undefined ? { date: slots.date } : {}),
    ...(slots.startTime !== undefined ? { startTime: slots.startTime } : {}),
    ...(slots.endTime !== undefined ? { endTime: slots.endTime } : {}),
    ...(slots.durationMinutes !== undefined
      ? { durationMinutes: slots.durationMinutes }
      : {}),
    missing: missingSlots(slots),
    ambiguities,
    confidence: 1,
    rawText,
    normalizedText: normalizeText(rawText),
  };
}
