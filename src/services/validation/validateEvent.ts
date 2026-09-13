/**
 * Event validation — the safety gate.
 *
 * Nothing reaches the calendar without passing through here. In particular this is
 * where the Stage 1 ambiguity contract is ENFORCED rather than merely reported: a
 * command carrying an unresolved hour is rejected outright, so an unanswered
 * 'בבוקר או בערב?' can never turn into a booked event.
 *
 * Pure: no I/O, and the current instant arrives via the injected Clock.
 */

import type { ParsedCommand, SlotName } from '../../types/parser';
import type { StructuredEvent } from '../../types/calendar';
import type { Clock } from '../../utils/clock';
import {
  MINUTES_PER_DAY,
  addMinutes,
  isValidDateString,
  minutesToTimeString,
  parseTimeString,
  zonedTimeToInstant,
} from '../../utils/time';

export type ValidationErrorCode =
  | 'UNSUPPORTED_INTENT'
  | 'AMBIGUOUS_TIME'
  | 'MISSING_SLOT'
  | 'INVALID_DATE'
  | 'INVALID_TIME'
  | 'INVALID_DURATION'
  | 'TIME_IN_PAST';

export interface ValidationError {
  code: ValidationErrorCode;
  /** Which slot the problem belongs to, where that makes sense. */
  slot?: SlotName | 'endTime';
  /** Hebrew, ready to show or speak. */
  message: string;
  /** For AMBIGUOUS_TIME: the readings the parser refused to choose between. */
  candidates?: string[];
}

export type ValidationResult =
  | { ok: true; event: StructuredEvent }
  | { ok: false; errors: ValidationError[] };

/** Longest event we accept. Anything beyond this is far more likely a parse error. */
export const MAX_EVENT_MINUTES = MINUTES_PER_DAY;

const MISSING_SLOT_MESSAGES: Record<SlotName, string> = {
  title: 'לא הבנתי מה לקבוע.',
  date: 'באיזה תאריך לקבוע?',
  startTime: 'באיזו שעה לקבוע?',
  duration: 'ולכמה זמן?',
};

/**
 * Validate a parsed command as a schedulable event.
 *
 * Scoped to CREATE. UPDATE reuses the primitives (buildInterval, detectConflicts)
 * directly in Stage 8, because moving an event validates against a different set of
 * rules — the title refers to something that already exists.
 */
export function validateEvent(command: ParsedCommand, clock: Clock): ValidationResult {
  const timeZone = clock.timeZone();

  if (command.intent !== 'CREATE') {
    return {
      ok: false,
      errors: [
        {
          code: 'UNSUPPORTED_INTENT',
          message: 'הפקודה אינה בקשה לקביעת אירוע.',
        },
      ],
    };
  }

  // An unresolved hour blocks everything. Checked before anything else so the caller
  // asks the disambiguating question rather than a cascade of range complaints.
  if (command.ambiguities.length > 0) {
    return {
      ok: false,
      errors: command.ambiguities.map((ambiguity) => ({
        code: 'AMBIGUOUS_TIME' as const,
        slot: ambiguity.slot,
        message: ambiguity.question,
        candidates: ambiguity.candidates,
      })),
    };
  }

  if (command.missing.length > 0) {
    return {
      ok: false,
      errors: command.missing.map((slot) => ({
        code: 'MISSING_SLOT' as const,
        slot,
        message: MISSING_SLOT_MESSAGES[slot],
      })),
    };
  }

  const errors: ValidationError[] = [];

  const { title, date, startTime } = command;

  // computeMissing already guarantees these, but a defensive check keeps this function
  // total rather than relying on an invariant held in another module.
  if (title === undefined) {
    errors.push({ code: 'MISSING_SLOT', slot: 'title', message: MISSING_SLOT_MESSAGES.title });
  }
  if (date === undefined) {
    errors.push({ code: 'MISSING_SLOT', slot: 'date', message: MISSING_SLOT_MESSAGES.date });
  }
  if (startTime === undefined) {
    errors.push({
      code: 'MISSING_SLOT',
      slot: 'startTime',
      message: MISSING_SLOT_MESSAGES.startTime,
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  if (title === undefined || date === undefined || startTime === undefined) {
    return { ok: false, errors };
  }

  if (!isValidDateString(date)) {
    errors.push({ code: 'INVALID_DATE', slot: 'date', message: 'התאריך אינו תקין.' });
  }

  const startMinutes = parseTimeString(startTime);
  if (startMinutes === undefined) {
    errors.push({ code: 'INVALID_TIME', slot: 'startTime', message: 'שעת ההתחלה אינה תקינה.' });
  }

  if (command.endTime !== undefined && parseTimeString(command.endTime) === undefined) {
    errors.push({ code: 'INVALID_TIME', slot: 'endTime', message: 'שעת הסיום אינה תקינה.' });
  }

  if (errors.length > 0) return { ok: false, errors };
  if (startMinutes === undefined) return { ok: false, errors };

  const durationMinutes = resolveDuration(command, startMinutes);

  if (durationMinutes === undefined) {
    return {
      ok: false,
      errors: [
        { code: 'MISSING_SLOT', slot: 'duration', message: MISSING_SLOT_MESSAGES.duration },
      ],
    };
  }

  if (durationMinutes <= 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'INVALID_DURATION',
          slot: 'duration',
          message: 'משך האירוע חייב להיות גדול מאפס.',
        },
      ],
    };
  }

  if (durationMinutes > MAX_EVENT_MINUTES) {
    return {
      ok: false,
      errors: [
        {
          code: 'INVALID_DURATION',
          slot: 'duration',
          message: 'משך האירוע ארוך מדי.',
        },
      ],
    };
  }

  const start = zonedTimeToInstant(date, startTime, timeZone);
  if (start === undefined) {
    return {
      ok: false,
      errors: [{ code: 'INVALID_DATE', slot: 'date', message: 'התאריך אינו תקין.' }],
    };
  }

  // End is derived by adding absolute minutes to the start, never by resolving the end
  // wall-clock time against the same date — that would run backwards for an event
  // crossing midnight, and would be wrong across a DST change.
  const end = addMinutes(start, durationMinutes);

  if (start.getTime() < clock.now().getTime()) {
    return {
      ok: false,
      errors: [
        {
          code: 'TIME_IN_PAST',
          slot: 'startTime',
          message: 'הזמן שביקשת כבר עבר.',
        },
      ],
    };
  }

  return {
    ok: true,
    event: {
      title,
      date,
      startTime,
      endTime: minutesToTimeString(startMinutes + durationMinutes),
      durationMinutes,
      timeZone,
      interval: { start, end },
    },
  };
}

/**
 * Work out the duration in minutes.
 *
 * Prefers an explicit duration. Falling back to an end time wraps across midnight, so
 * '23:00 עד 01:00' is two hours rather than a negative span.
 */
function resolveDuration(command: ParsedCommand, startMinutes: number): number | undefined {
  if (command.durationMinutes !== undefined) return command.durationMinutes;

  if (command.endTime !== undefined) {
    const endMinutes = parseTimeString(command.endTime);
    if (endMinutes === undefined) return undefined;
    const span = endMinutes - startMinutes;
    return span > 0 ? span : span + MINUTES_PER_DAY;
  }

  return undefined;
}
