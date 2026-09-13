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

import { detectIntent } from './intent';
import { findDate } from './dateParser';
import { findDuration } from './durationParser';
import { findTimes, questionFor, type TimeExpression } from './timeParser';
import { normalizeText, tokenize } from './normalize';
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

export function parseCommand(rawText: string, clock: Clock): ParsedCommand {
  const normalizedText = normalizeText(rawText);
  const tokens = tokenize(normalizedText);
  const consumed = new Set<number>();

  const intentMatch = detectIntent(tokens);
  const intent: Intent = intentMatch?.intent ?? 'UNKNOWN';
  intentMatch?.tokens.forEach((index) => consumed.add(index));

  const dateMatch = findDate(tokens, consumed, clock);
  dateMatch?.tokens.forEach((index) => consumed.add(index));

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
    hasTimeExpression: startExpression !== undefined || dateMatch?.startTime !== undefined,
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
    missing,
    ambiguities,
    confidence,
    rawText,
    normalizedText,
  };
}
