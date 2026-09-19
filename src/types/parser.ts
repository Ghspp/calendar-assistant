/**
 * Structured output of the Hebrew command parser.
 *
 * The parser is a PURE function of (text, clock). It performs no I/O and never
 * touches the calendar. Everything here is data for the validation layer (Stage 2)
 * and the conversation layer (Stage 6) to act on.
 */

import type { Recurrence } from '../services/parser/recurrence';

export type Intent = 'CREATE' | 'QUERY' | 'FIND_FREE' | 'UPDATE' | 'DELETE' | 'UNKNOWN';

/** Slots that can be reported as missing and asked about in follow-up questions. */
export type SlotName = 'title' | 'date' | 'startTime' | 'duration';

/**
 * An hour the parser refused to resolve.
 *
 * This is the core safety mechanism: a bare 1-12 hour with no day-part qualifier is
 * NEVER guessed. `candidates` holds both readings and `question` is the Hebrew the
 * assistant should ask. While an ambiguity is present the corresponding time slot is
 * left `undefined`, so downstream code cannot accidentally use a guessed value.
 */
export interface Ambiguity {
  slot: 'startTime' | 'endTime';
  /** Both readings in HH:mm, earliest first, e.g. ['08:00', '20:00']. */
  candidates: string[];
  /** Hebrew question to put to the user, e.g. 'בבוקר או בערב?'. */
  question: string;
}

/** An inclusive span of dates, used by QUERY/FIND_FREE for 'השבוע' and 'שבוע הבא'. */
export interface DateRange {
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
}

export interface ParsedCommand {
  intent: Intent;
  /** Event title, e.g. 'פגישה עם דניאל'. Absent when nothing was left over. */
  title?: string;
  /** YYYY-MM-DD in Asia/Jerusalem. */
  date?: string;
  /** Set instead of `date` for week-wide expressions. */
  dateRange?: DateRange;
  /** HH:mm. Absent while an hour is ambiguous — check `ambiguities`. */
  startTime?: string;
  /** HH:mm. Derived from an explicit 'עד' or from start + duration. */
  endTime?: string;
  durationMinutes?: number;
  /**
   * The user asked for the earliest opening rather than naming an hour.
   *
   * The start time is then chosen from the calendar instead of from the utterance —
   * which is not a guess about what they meant, but a computation they asked for.
   */
  useFirstFreeSlot?: boolean;
  /**
   * How the event repeats, when the user said 'כל …'.
   *
   * The date slot still holds the FIRST occurrence; this is only the rule that
   * follows it.
   */
  recurrence?: Recurrence;
  /** Slots with no information at all. Drives 'באיזו שעה לקבוע?' style questions. */
  missing: SlotName[];
  /** Slots that had information the parser refused to resolve. */
  ambiguities: Ambiguity[];
  /** Rough 0..1 signal of how much of the command was understood. */
  confidence: number;
  rawText: string;
  normalizedText: string;
}
