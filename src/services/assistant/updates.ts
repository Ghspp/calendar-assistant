/**
 * Changing an existing event.
 *
 * The safety rules here matter more than the feature, because unlike creating, this
 * modifies data the user already has:
 *
 *   1. **Never act on an ambiguous match.** Zero matches is reported; more than one is
 *      listed and the user is asked which. The app never picks for them.
 *   2. **A move re-checks conflicts** against freshly fetched events, excluding the
 *      event being moved — an event never conflicts with itself.
 *   3. **Only the named field is sent.** A rename cannot disturb the time, and a move
 *      cannot disturb the title.
 *   4. **The reply always states the change**, old and new, so a wrong match is
 *      visible immediately rather than discovered days later.
 */

import type { CalendarEvent, TimedCalendarEvent } from '../../types/calendar';
import type { ParsedCommand } from '../../types/parser';
import type { Clock } from '../../utils/clock';
import {
  addDaysToDateString,
  dayBoundsInZone,
  instantToZonedTime,
  zonedTimeToInstant,
} from '../../utils/time';
import { detectConflicts } from '../conflict/detectConflicts';
import { findEventsByTitle } from './eventMatching';
import {
  applySubstitution,
  applyTailReplacement,
  parseUpdate,
  type UpdateChange,
} from './updateParsing';
import type { CalendarProvider } from '../calendar/CalendarProvider';
import type { CommandOutcome } from './types';

export interface UpdateOptions {
  provider: CalendarProvider;
  clock: Clock;
}

/** How far ahead to look when the user did not say which day. */
export const UPDATE_SEARCH_DAYS = 14;

function isTimed(event: CalendarEvent): event is TimedCalendarEvent {
  return event.kind === 'timed';
}

/** Events that can be acted on: timed, not cancelled, not declined. */
function updatable(event: CalendarEvent): event is TimedCalendarEvent {
  return isTimed(event) && event.status !== 'cancelled' && event.responseStatus !== 'declined';
}

async function loadCandidates(
  targetDate: string | undefined,
  options: UpdateOptions,
): Promise<CalendarEvent[]> {
  const { clock, provider } = options;
  const timeZone = clock.timeZone();

  if (targetDate !== undefined) return provider.listEventsForDate(targetDate);

  const today = instantToZonedTime(clock.now(), timeZone).date;
  const lastDay = addDaysToDateString(today, UPDATE_SEARCH_DAYS);

  const from = dayBoundsInZone(today, timeZone);
  const to = lastDay === undefined ? undefined : dayBoundsInZone(lastDay, timeZone);
  if (from === undefined || to === undefined) return [];

  return provider.listEvents({ timeMin: from.start, timeMax: to.end });
}

/** Work out the new title, or explain why it cannot be worked out. */
function resolveNewTitle(
  change: UpdateChange,
  currentTitle: string,
): { title: string } | { problem: 'not-found' } | undefined {
  if (change.kind === 'retitle') return { title: change.newTitle };

  if (change.kind === 'substitute') {
    const next = applySubstitution(currentTitle, change.from, change.to);
    return next === undefined ? { problem: 'not-found' } : { title: next };
  }

  if (change.kind === 'replace-tail') {
    const next = applyTailReplacement(currentTitle, change.tail);
    return next === undefined ? { problem: 'not-found' } : { title: next };
  }

  return undefined;
}

export async function applyUpdate(
  parsed: ParsedCommand,
  options: UpdateOptions,
): Promise<CommandOutcome> {
  const { clock } = options;
  const timeZone = clock.timeZone();

  const request = parseUpdate(parsed);
  if (request === undefined || request.target.trim().length === 0) {
    return { kind: 'update-unclear', reason: 'no-target' };
  }

  if (request.change.kind === 'unclear') {
    return { kind: 'update-unclear', reason: 'no-change', target: request.target };
  }

  // An unresolved hour blocks a move exactly as it blocks a creation.
  if (request.change.kind === 'move' && request.change.startTime === undefined) {
    const ambiguity = request.change.ambiguity;
    if (ambiguity !== undefined) {
      return {
        kind: 'needs-input',
        parsed,
        errors: [
          {
            code: 'AMBIGUOUS_TIME',
            slot: 'startTime',
            message: ambiguity.question,
            candidates: ambiguity.candidates,
          },
        ],
      };
    }
    return { kind: 'update-unclear', reason: 'no-change', target: request.target };
  }

  const events = await loadCandidates(request.targetDate, options);
  const matches = findEventsByTitle(events.filter(updatable), request.target).filter(isTimed);

  if (matches.length === 0) {
    return { kind: 'update-not-found', timeZone, target: request.target };
  }

  if (matches.length > 1) {
    // Rule 1: never choose on the user's behalf.
    return { kind: 'update-ambiguous', timeZone, target: request.target, matches };
  }

  const event = matches[0];
  if (event === undefined) return { kind: 'update-not-found', timeZone, target: request.target };

  return applyChangeToEvent(event, request.change, events, options);
}

/**
 * Act on ONE event that has already been singled out.
 *
 * Separated so the disambiguation flow can call it with the event the user picked,
 * rather than re-running the search and risking a different set of matches.
 */
export async function applyChangeToEvent(
  event: TimedCalendarEvent,
  change: UpdateChange,
  events: readonly CalendarEvent[],
  options: UpdateOptions,
): Promise<CommandOutcome> {
  const { clock, provider } = options;
  const timeZone = clock.timeZone();

  const previousTitle = event.title;
  const previousStart = new Date(event.start);
  const previousEnd = new Date(event.end);

  if (change.kind === 'move') {
    const startTime = change.startTime;
    if (startTime === undefined) {
      return { kind: 'update-unclear', reason: 'no-change', target: previousTitle };
    }

    const date = instantToZonedTime(previousStart, timeZone).date;
    const start = zonedTimeToInstant(date, startTime, timeZone);
    if (start === undefined) {
      return { kind: 'update-unclear', reason: 'no-change', target: previousTitle };
    }

    const durationMinutes =
      change.durationMinutes ??
      Math.max(1, Math.round((previousEnd.getTime() - previousStart.getTime()) / 60_000));

    const end = new Date(start.getTime() + durationMinutes * 60_000);

    // Rule 2: re-check conflicts, excluding the event being moved.
    const others = events.filter((candidate) => candidate.id !== event.id);
    const report = detectConflicts({ start, end }, others, timeZone);
    if (report.hasConflict) {
      return { kind: 'update-conflict', timeZone, event, conflicts: report.conflicts };
    }

    const updated = await provider.updateEvent(event.id, {
      interval: { start, end },
      timeZone,
    });

    return {
      kind: 'updated',
      timeZone,
      updated,
      previousTitle,
      newTitle: previousTitle,
      previousStart: previousStart.toISOString(),
      previousEnd: previousEnd.toISOString(),
      newStart: start.toISOString(),
      newEnd: end.toISOString(),
    };
  }

  const resolved = resolveNewTitle(change, previousTitle);
  if (resolved === undefined || 'problem' in resolved) {
    return {
      kind: 'update-unclear',
      reason: 'word-not-in-title',
      target: previousTitle,
      ...(change.kind === 'substitute' ? { word: change.from } : {}),
      ...(change.kind === 'replace-tail'
        ? { word: change.tail.split(' ')[0] ?? change.tail }
        : {}),
    };
  }

  if (resolved.title === previousTitle) {
    return { kind: 'update-unclear', reason: 'no-change', target: previousTitle };
  }

  // Rule 3: a rename sends only the title.
  const updated = await provider.updateEvent(event.id, { title: resolved.title });

  return {
    kind: 'updated',
    timeZone,
    updated,
    previousTitle,
    newTitle: resolved.title,
    previousStart: previousStart.toISOString(),
    previousEnd: previousEnd.toISOString(),
    newStart: previousStart.toISOString(),
    newEnd: previousEnd.toISOString(),
  };
}
