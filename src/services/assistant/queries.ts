/**
 * Read-only calendar questions.
 *
 * Nothing in this module writes. It answers three shapes of question:
 *
 *   "מה יש לי מחר?"                  → the agenda for a day or a week
 *   "אני פנוי מחר בשש?"              → whether one slot is free
 *   "מצא לי שעה פנויה של שעתיים מחר" → gaps long enough to hold something
 *
 * plus "מתי יש לי את הפגישה עם דניאל?", which searches the coming days by name.
 */

import type { CalendarEvent } from '../../types/calendar';
import type { ParsedCommand } from '../../types/parser';
import type { Clock } from '../../utils/clock';
import { addDaysToDateString, dayBoundsInZone, zonedTimeToInstant } from '../../utils/time';
import { instantToZonedTime } from '../../utils/time';
import { detectConflicts } from '../conflict/detectConflicts';
import { findFreeSlots } from '../conflict/findFreeSlots';
import { readDayPart } from '../parser/timeParser';
import { normalizeText, tokenize } from '../parser/normalize';
import type { DayPart } from '../parser/lexicon';
import { findEventsByTitle } from './eventMatching';
import type { CalendarProvider } from '../calendar/CalendarProvider';
import type { AvailabilityReading, CommandOutcome } from './types';

export interface QueryOptions {
  provider: CalendarProvider;
  clock: Clock;
}

/** Assumed length when someone asks "am I free at six?" without saying for how long. */
const DEFAULT_AVAILABILITY_MINUTES = 60;

/** Assumed length when someone asks for a free slot without saying how long. */
const DEFAULT_SLOT_MINUTES = 60;

/** How far ahead "מתי יש לי…" looks. */
export const EVENT_SEARCH_DAYS = 14;

/** Search windows for a day part, and the Hebrew label to echo back. */
const DAY_PART_WINDOWS: Record<DayPart, { start: string; end: string; label: string }> = {
  morning: { start: '06:00', end: '12:00', label: 'בבוקר' },
  noon: { start: '11:00', end: '15:00', label: 'בצהריים' },
  afternoon: { start: '12:00', end: '18:00', label: 'אחר הצהריים' },
  evening: { start: '17:00', end: '23:00', label: 'בערב' },
  night: { start: '20:00', end: '23:59', label: 'בלילה' },
};

/** Today's date in the clock's zone. */
function today(clock: Clock): string {
  return instantToZonedTime(clock.now(), clock.timeZone()).date;
}

/**
 * A day-part word anywhere in the command, used to narrow a free-slot search.
 *
 * Scans the whole utterance rather than only after an hour, because 'מצא לי שעה פנויה
 * מחר בערב' has no hour for the qualifier to attach to.
 */
export function findDayPartWindow(
  text: string,
): { start: string; end: string; label: string } | undefined {
  const tokens = tokenize(normalizeText(text));
  for (let index = 0; index < tokens.length; index += 1) {
    const dayPart = readDayPart(tokens, index);
    if (dayPart !== undefined) return DAY_PART_WINDOWS[dayPart.part];
  }
  return undefined;
}

/** Events worth showing in an agenda. Cancelled and declined ones are not. */
function visibleInAgenda(event: CalendarEvent): boolean {
  return event.status !== 'cancelled' && event.responseStatus !== 'declined';
}

function sortByStart(events: CalendarEvent[], timeZone: string): CalendarEvent[] {
  const keyOf = (event: CalendarEvent): number => {
    if (event.kind === 'allDay') {
      // All-day events sort to the top of their day.
      const bounds = dayBoundsInZone(event.startDate, timeZone);
      return bounds?.start.getTime() ?? 0;
    }
    const start = new Date(event.start).getTime();
    return Number.isNaN(start) ? 0 : start;
  };

  return [...events].sort((a, b) => keyOf(a) - keyOf(b));
}

/**
 * Answer a QUERY.
 *
 * The parser gives every calendar question the same intent, so the shape is decided by
 * which slots came back: an hour means availability, a bare title means a name search,
 * anything else is an agenda.
 */
export async function answerQuery(
  parsed: ParsedCommand,
  options: QueryOptions,
): Promise<CommandOutcome> {
  const { clock } = options;
  const timeZone = clock.timeZone();

  const hasHour = parsed.startTime !== undefined || parsed.ambiguities.length > 0;
  if (hasHour) return answerAvailability(parsed, options);

  if (parsed.title !== undefined && parsed.date === undefined && parsed.dateRange === undefined) {
    return searchByName(parsed.title, options);
  }

  // An agenda for a range, or for a single day defaulting to today.
  if (parsed.dateRange !== undefined) {
    const from = dayBoundsInZone(parsed.dateRange.startDate, timeZone);
    const to = dayBoundsInZone(parsed.dateRange.endDate, timeZone);
    if (from === undefined || to === undefined) {
      return { kind: 'agenda', timeZone, dateRange: parsed.dateRange, events: [] };
    }

    const events = await options.provider.listEvents({ timeMin: from.start, timeMax: to.end });
    return {
      kind: 'agenda',
      timeZone,
      dateRange: parsed.dateRange,
      events: sortByStart(events.filter(visibleInAgenda), timeZone),
    };
  }

  const date = parsed.date ?? today(clock);
  const events = await options.provider.listEventsForDate(date);

  return {
    kind: 'agenda',
    timeZone,
    date,
    events: sortByStart(events.filter(visibleInAgenda), timeZone),
  };
}

/**
 * Answer "am I free at …?".
 *
 * When the hour is ambiguous this reports BOTH readings instead of asking. A question
 * changes nothing, so answering twice is more useful than a round trip — and it still
 * refuses to guess which reading was meant.
 */
async function answerAvailability(
  parsed: ParsedCommand,
  options: QueryOptions,
): Promise<CommandOutcome> {
  const { clock } = options;
  const timeZone = clock.timeZone();
  const date = parsed.date ?? today(clock);
  const durationMinutes = parsed.durationMinutes ?? DEFAULT_AVAILABILITY_MINUTES;

  const startTimes =
    parsed.startTime !== undefined
      ? [parsed.startTime]
      : (parsed.ambiguities.find((item) => item.slot === 'startTime')?.candidates ?? []);

  const events = await options.provider.listEventsForDate(date);

  const readings: AvailabilityReading[] = [];

  for (const startTime of startTimes) {
    const start = zonedTimeToInstant(date, startTime, timeZone);
    if (start === undefined) continue;

    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const report = detectConflicts({ start, end }, events, timeZone);

    readings.push({
      startTime,
      endTime: instantToZonedTime(end, timeZone).time,
      free: !report.hasConflict,
      conflicts: report.conflicts,
    });
  }

  return { kind: 'availability', timeZone, date, readings };
}

/** Answer "when do I have …?" by scanning the coming fortnight for a matching title. */
async function searchByName(query: string, options: QueryOptions): Promise<CommandOutcome> {
  const { clock } = options;
  const timeZone = clock.timeZone();

  const from = dayBoundsInZone(today(clock), timeZone);
  const lastDay = addDaysToDateString(today(clock), EVENT_SEARCH_DAYS);
  const to = lastDay === undefined ? undefined : dayBoundsInZone(lastDay, timeZone);

  if (from === undefined || to === undefined) {
    return { kind: 'event-search', timeZone, query, matches: [], daysSearched: EVENT_SEARCH_DAYS };
  }

  const events = await options.provider.listEvents({ timeMin: from.start, timeMax: to.end });
  const matches = findEventsByTitle(events.filter(visibleInAgenda), query);

  return {
    kind: 'event-search',
    timeZone,
    query,
    matches: sortByStart(matches, timeZone),
    daysSearched: EVENT_SEARCH_DAYS,
  };
}

/** Answer "find me a free slot". */
export async function answerFindFree(
  parsed: ParsedCommand,
  options: QueryOptions,
): Promise<CommandOutcome> {
  const { clock } = options;
  const timeZone = clock.timeZone();
  const date = parsed.date ?? today(clock);
  const durationMinutes = parsed.durationMinutes ?? DEFAULT_SLOT_MINUTES;

  const window = findDayPartWindow(parsed.normalizedText);
  const events = await options.provider.listEventsForDate(date);

  const slots = findFreeSlots(
    {
      date,
      events,
      durationMinutes,
      ...(window !== undefined ? { dayStart: window.start, dayEnd: window.end } : {}),
    },
    clock,
  );

  return {
    kind: 'free-slots',
    timeZone,
    date,
    durationMinutes,
    slots,
    ...(window !== undefined ? { dayPartLabel: window.label } : {}),
  };
}
