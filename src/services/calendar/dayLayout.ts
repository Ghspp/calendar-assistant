/**
 * Positioning events on an hour grid.
 *
 * Pure geometry, separated from the components so the tricky part — deciding how
 * overlapping events share the width — is testable without rendering anything.
 */

import type { CalendarEvent, TimedCalendarEvent } from '../../types/calendar';
import { instantToZonedTime, parseTimeString } from '../../utils/time';

export interface PositionedEvent {
  event: TimedCalendarEvent;
  /** Minutes from midnight, in the display time zone. */
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  /** Which of `columns` this event occupies, 0-based. */
  column: number;
  /** How many columns the overlapping group was split into. */
  columns: number;
  /** True when the event begins before the visible window. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface DayLayout {
  positioned: PositionedEvent[];
  /** All-day events, shown as a banner rather than on the grid. */
  allDay: CalendarEvent[];
}

/** Events that are not shown on the grid at all. */
function hidden(event: CalendarEvent): boolean {
  return event.status === 'cancelled' || event.responseStatus === 'declined';
}

/**
 * Lay out a day's events.
 *
 * Overlapping events are split into columns so none is hidden behind another. The
 * grouping is deliberately simple: any chain of mutually overlapping events shares a
 * width, which is what a person expects to see even if it is not the tightest packing.
 */
export function layoutDay(
  events: readonly CalendarEvent[],
  date: string,
  timeZone: string,
  window: { start: string; end: string },
): DayLayout {
  const windowStart = parseTimeString(window.start) ?? 0;
  const windowEnd = parseTimeString(window.end) ?? 24 * 60;

  const allDay: CalendarEvent[] = [];
  const timed: PositionedEvent[] = [];

  for (const event of events) {
    if (hidden(event)) continue;

    if (event.kind === 'allDay') {
      allDay.push(event);
      continue;
    }

    const start = new Date(event.start);
    const end = new Date(event.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    const startLocal = instantToZonedTime(start, timeZone);
    const endLocal = instantToZonedTime(end, timeZone);

    // An event may start the day before or end the day after; clamp it to this day so
    // a meeting running past midnight still appears, rather than vanishing.
    const rawStart =
      startLocal.date < date ? 0 : (parseTimeString(startLocal.time) ?? 0);
    const rawEnd =
      endLocal.date > date ? 24 * 60 : (parseTimeString(endLocal.time) ?? 0);

    if (rawEnd <= windowStart || rawStart >= windowEnd) continue;

    timed.push({
      event,
      startMinutes: Math.max(rawStart, windowStart),
      endMinutes: Math.min(rawEnd, windowEnd),
      startTime: startLocal.time,
      endTime: endLocal.time,
      column: 0,
      columns: 1,
      clippedStart: rawStart < windowStart,
      clippedEnd: rawEnd > windowEnd,
    });
  }

  timed.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  assignColumns(timed);

  return { positioned: timed, allDay };
}

/**
 * Split overlapping events into side-by-side columns.
 *
 * Walks the day in order, keeping a group of events that overlap each other. When a
 * gap appears the group is closed and everything in it gets the same column count, so
 * a row of concurrent meetings lines up evenly.
 */
function assignColumns(events: PositionedEvent[]): void {
  let group: PositionedEvent[] = [];
  let groupEnd = -1;

  const close = (): void => {
    for (const item of group) item.columns = Math.max(...group.map((e) => e.column + 1));
    group = [];
    groupEnd = -1;
  };

  for (const event of events) {
    if (group.length > 0 && event.startMinutes >= groupEnd) close();

    // The first column whose last event has already finished.
    const taken = new Set(
      group.filter((item) => item.endMinutes > event.startMinutes).map((item) => item.column),
    );
    let column = 0;
    while (taken.has(column)) column += 1;

    event.column = column;
    group.push(event);
    groupEnd = Math.max(groupEnd, event.endMinutes);
  }

  if (group.length > 0) close();
}

/** Hour marks to draw down the side of the grid. */
export function hourMarks(window: { start: string; end: string }): number[] {
  const startHour = Math.floor((parseTimeString(window.start) ?? 0) / 60);
  const endHour = Math.ceil((parseTimeString(window.end) ?? 1440) / 60);

  const hours: number[] = [];
  for (let hour = startHour; hour <= endHour; hour += 1) hours.push(hour);
  return hours;
}
