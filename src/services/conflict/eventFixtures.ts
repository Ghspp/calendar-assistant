/**
 * TEST-ONLY fixtures. Imported by the Stage 2 test suites, never by application code.
 */

import type {
  AllDayCalendarEvent,
  CalendarEvent,
  TimeInterval,
  TimedCalendarEvent,
} from '../../types/calendar';
import { zonedTimeToInstant } from '../../utils/time';

export const TZ = 'Asia/Jerusalem';

/** Monday 14 September 2026 — the day after the test clock's 'today'. */
export const DAY = '2026-09-14';

/** Resolve a local time on a date to an instant, failing loudly in tests. */
export function at(time: string, date: string = DAY): Date {
  const instant = zonedTimeToInstant(date, time, TZ);
  if (instant === undefined) {
    throw new Error(`fixture: could not resolve ${date} ${time}`);
  }
  return instant;
}

export function interval(startTime: string, endTime: string, date: string = DAY): TimeInterval {
  return { start: at(startTime, date), end: at(endTime, date) };
}

type EventOptions = Omit<TimedCalendarEvent, 'kind' | 'id' | 'title' | 'start' | 'end'>;

export function timed(
  title: string,
  startTime: string,
  endTime: string,
  options: EventOptions & { date?: string; id?: string } = {},
): TimedCalendarEvent {
  const { date = DAY, id = `${title}-${startTime}`, ...rest } = options;
  return {
    kind: 'timed',
    id,
    title,
    start: at(startTime, date).toISOString(),
    end: at(endTime, date).toISOString(),
    ...rest,
  };
}

export function allDay(
  title: string,
  startDate: string = DAY,
  endDateExclusive: string = '2026-09-15',
  options: Omit<AllDayCalendarEvent, 'kind' | 'id' | 'title' | 'startDate' | 'endDateExclusive'> = {},
): AllDayCalendarEvent {
  return {
    kind: 'allDay',
    id: `${title}-${startDate}`,
    title,
    startDate,
    endDateExclusive,
    ...options,
  };
}

/** Titles of the blocking conflicts, for compact assertions. */
export function conflictTitles(events: readonly CalendarEvent[]): string[] {
  return events.map((event) => event.title);
}
