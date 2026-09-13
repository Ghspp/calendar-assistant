/**
 * Conflict detection. Pure, no I/O.
 *
 * The overlap rule, and the only one:
 *
 *     newStart < existingEnd  AND  newEnd > existingStart
 *
 * Intervals are half-open, so events that merely touch at a boundary are allowed:
 * 17:00-18:00 followed by 18:00-19:00 is fine. Everything else that shares any real
 * time — partial overlaps, exact duplicates, an event inside another, an event that
 * swallows another — blocks.
 */

import type {
  CalendarEvent,
  TimeInterval,
  TimedCalendarEvent,
  AllDayCalendarEvent,
} from '../../types/calendar';
import { dayBoundsInZone, intervalsOverlap, zonedTimeToInstant } from '../../utils/time';

/** How a blocking event relates to the requested slot. */
export type ConflictKind = 'identical' | 'contained' | 'contains' | 'partial';

export interface Conflict {
  event: TimedCalendarEvent;
  kind: ConflictKind;
  /** The existing event's own interval, already resolved to instants. */
  interval: TimeInterval;
}

/** Why an event was disregarded. Surfaced mainly so tests can assert intent. */
export type IgnoreReason =
  | 'cancelled'
  | 'transparent'
  | 'declined'
  | 'all-day'
  | 'unparseable'
  | 'no-overlap';

export interface IgnoredEvent {
  event: CalendarEvent;
  reason: IgnoreReason;
}

export interface ConflictReport {
  hasConflict: boolean;
  /** Blocking overlaps, earliest first. */
  conflicts: Conflict[];
  /** Overlapping all-day events. Context for the user, never a blocker. */
  informational: AllDayCalendarEvent[];
  ignored: IgnoredEvent[];
}

/**
 * True when an event should not be considered busy at all.
 *
 * Cancelled events are tombstones. 'transparent' is how a calendar marks an event that
 * does not make you busy. A declined invitation is somebody else's meeting.
 */
function nonBlockingReason(event: CalendarEvent): IgnoreReason | undefined {
  if (event.status === 'cancelled') return 'cancelled';
  if (event.transparency === 'transparent') return 'transparent';
  if (event.responseStatus === 'declined') return 'declined';
  return undefined;
}

function classify(candidate: TimeInterval, existing: TimeInterval): ConflictKind {
  const candidateStart = candidate.start.getTime();
  const candidateEnd = candidate.end.getTime();
  const existingStart = existing.start.getTime();
  const existingEnd = existing.end.getTime();

  if (candidateStart === existingStart && candidateEnd === existingEnd) return 'identical';
  if (existingStart <= candidateStart && candidateEnd <= existingEnd) return 'contained';
  if (candidateStart <= existingStart && existingEnd <= candidateEnd) return 'contains';
  return 'partial';
}

/** Resolve a timed event's stored ISO strings into an interval, or fail. */
export function timedEventInterval(event: TimedCalendarEvent): TimeInterval | undefined {
  const start = new Date(event.start);
  const end = new Date(event.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;
  if (end.getTime() <= start.getTime()) return undefined;

  return { start, end };
}

/** Resolve an all-day event's local date range into instants in `timeZone`. */
export function allDayEventInterval(
  event: AllDayCalendarEvent,
  timeZone: string,
): TimeInterval | undefined {
  const bounds = dayBoundsInZone(event.startDate, timeZone);
  const end = zonedTimeToInstant(event.endDateExclusive, '00:00', timeZone);

  if (bounds === undefined || end === undefined) return undefined;
  if (end.getTime() <= bounds.start.getTime()) return undefined;

  return { start: bounds.start, end };
}

/**
 * Check a requested slot against existing calendar events.
 *
 * `events` are expected to be expanded instances — recurring events must already have
 * been flattened by the provider. An instance is treated exactly like any other event,
 * so a weekly class blocks its slot every week.
 */
export function detectConflicts(
  candidate: TimeInterval,
  events: readonly CalendarEvent[],
  timeZone: string,
): ConflictReport {
  const conflicts: Conflict[] = [];
  const informational: AllDayCalendarEvent[] = [];
  const ignored: IgnoredEvent[] = [];

  for (const event of events) {
    const skipReason = nonBlockingReason(event);
    if (skipReason !== undefined) {
      ignored.push({ event, reason: skipReason });
      continue;
    }

    if (event.kind === 'allDay') {
      const interval = allDayEventInterval(event, timeZone);
      if (interval === undefined) {
        ignored.push({ event, reason: 'unparseable' });
        continue;
      }
      // All-day events are informational: they say what kind of day it is, not that a
      // particular hour is taken. They never block.
      if (intervalsOverlap(candidate, interval)) {
        informational.push(event);
      } else {
        ignored.push({ event, reason: 'no-overlap' });
      }
      continue;
    }

    const interval = timedEventInterval(event);
    if (interval === undefined) {
      ignored.push({ event, reason: 'unparseable' });
      continue;
    }

    if (!intervalsOverlap(candidate, interval)) {
      ignored.push({ event, reason: 'no-overlap' });
      continue;
    }

    conflicts.push({ event, kind: classify(candidate, interval), interval });
  }

  conflicts.sort((a, b) => a.interval.start.getTime() - b.interval.start.getTime());

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    informational,
    ignored,
  };
}
