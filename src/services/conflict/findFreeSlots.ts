/**
 * Free-slot finder. Pure, no I/O, current instant injected via Clock.
 *
 * Answers 'מצא לי שעה פנויה של שעתיים מחר' by subtracting busy intervals from a
 * search window and returning the gaps that are long enough.
 *
 * Gaps are returned WHOLE rather than sliced into duration-sized chunks: a caller
 * placing an event takes slot.start, while a caller answering 'באיזה שעה אני פנוי?'
 * wants to report the real extent of the free time.
 */

import type { CalendarEvent, TimeInterval } from '../../types/calendar';
import type { Clock } from '../../utils/clock';
import {
  differenceInMinutes,
  instantToZonedTime,
  intervalsOverlap,
  zonedTimeToInstant,
} from '../../utils/time';
import { timedEventInterval } from './detectConflicts';

/** Waking hours. Nobody wants 'you are free at 03:00' as an answer. */
export const DEFAULT_DAY_START = '08:00';
export const DEFAULT_DAY_END = '22:00';

export interface FreeSlot {
  /** HH:mm in the search time zone. */
  startTime: string;
  endTime: string;
  start: Date;
  end: Date;
  /** Length of the whole gap, which may exceed the requested duration. */
  durationMinutes: number;
}

export interface FindFreeSlotsOptions {
  /** YYYY-MM-DD to search within. */
  date: string;
  events: readonly CalendarEvent[];
  /** Minimum gap length to report. */
  durationMinutes: number;
  /** Search window, defaulting to waking hours. 'מחר בערב' narrows these. */
  dayStart?: string;
  dayEnd?: string;
  /** Include gaps that have already passed. Off by default. */
  includePast?: boolean;
}

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeInterval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];

    // Touching intervals merge too: 17:00-18:00 and 18:00-19:00 are one busy block.
    if (last !== undefined && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end.getTime() > last.end.getTime()) {
        merged[merged.length - 1] = { start: last.start, end: interval.end };
      }
      continue;
    }

    merged.push({ start: interval.start, end: interval.end });
  }

  return merged;
}

/**
 * Busy intervals within the window.
 *
 * Applies exactly the same exclusions as conflict detection — cancelled, transparent
 * and declined events are not busy, and all-day events do not consume hours — so the
 * two modules can never disagree about whether a slot is free.
 */
function busyIntervals(
  events: readonly CalendarEvent[],
  window: TimeInterval,
): TimeInterval[] {
  const busy: TimeInterval[] = [];

  for (const event of events) {
    if (event.status === 'cancelled') continue;
    if (event.transparency === 'transparent') continue;
    if (event.responseStatus === 'declined') continue;

    // All-day events are informational and consume no hours, consistent with
    // detectConflicts. A day marked 'חופשה' does not make every hour unavailable.
    if (event.kind === 'allDay') continue;

    const interval = timedEventInterval(event);
    if (interval === undefined) continue;
    if (!intervalsOverlap(window, interval)) continue;

    busy.push({
      start: new Date(Math.max(interval.start.getTime(), window.start.getTime())),
      end: new Date(Math.min(interval.end.getTime(), window.end.getTime())),
    });
  }

  return mergeIntervals(busy);
}

function toSlot(start: Date, end: Date, timeZone: string): FreeSlot {
  return {
    startTime: instantToZonedTime(start, timeZone).time,
    endTime: instantToZonedTime(end, timeZone).time,
    start,
    end,
    durationMinutes: differenceInMinutes(end, start),
  };
}

export function findFreeSlots(options: FindFreeSlotsOptions, clock: Clock): FreeSlot[] {
  const timeZone = clock.timeZone();
  const dayStart = options.dayStart ?? DEFAULT_DAY_START;
  const dayEnd = options.dayEnd ?? DEFAULT_DAY_END;

  if (options.durationMinutes <= 0) return [];

  const windowStart = zonedTimeToInstant(options.date, dayStart, timeZone);
  const windowEnd = zonedTimeToInstant(options.date, dayEnd, timeZone);
  if (windowStart === undefined || windowEnd === undefined) return [];
  if (windowEnd.getTime() <= windowStart.getTime()) return [];

  // Do not offer time that has already gone.
  const effectiveStart =
    options.includePast === true
      ? windowStart
      : new Date(Math.max(windowStart.getTime(), clock.now().getTime()));

  if (effectiveStart.getTime() >= windowEnd.getTime()) return [];

  const window: TimeInterval = { start: effectiveStart, end: windowEnd };
  const busy = busyIntervals(options.events, window);

  const slots: FreeSlot[] = [];
  let cursor = window.start;

  for (const block of busy) {
    if (block.start.getTime() > cursor.getTime()) {
      slots.push(toSlot(cursor, block.start, timeZone));
    }
    if (block.end.getTime() > cursor.getTime()) {
      cursor = block.end;
    }
  }

  if (cursor.getTime() < window.end.getTime()) {
    slots.push(toSlot(cursor, window.end, timeZone));
  }

  return slots.filter((slot) => slot.durationMinutes >= options.durationMinutes);
}

/** First gap long enough to hold the event — 'תקבע את זה בזמן הפנוי הראשון'. */
export function findFirstFreeSlot(
  options: FindFreeSlotsOptions,
  clock: Clock,
): FreeSlot | undefined {
  return findFreeSlots(options, clock)[0];
}
