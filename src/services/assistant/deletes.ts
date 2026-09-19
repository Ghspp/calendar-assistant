/**
 * Deleting an event.
 *
 * This is the only irreversible operation the assistant performs, and it is guarded
 * more tightly than anything else:
 *
 *   1. **Never on an ambiguous match.** Zero matches is reported; more than one is
 *      listed and the user is asked which. The app never picks.
 *   2. **Never without confirmation.** Even a single unmistakable match is described
 *      back and waits for a yes. Creating and renaming go straight through; deleting
 *      does not, because a mistaken delete cannot be undone from inside this app.
 *   3. **Never in bulk.** There is no "delete all of them" path, by construction.
 */

import type { CalendarEvent, TimedCalendarEvent } from '../../types/calendar';
import type { ParsedCommand } from '../../types/parser';
import type { Clock } from '../../utils/clock';
import { addDaysToDateString, dayBoundsInZone, instantToZonedTime } from '../../utils/time';
import { findEventsByTitle } from './eventMatching';
import type { CalendarProvider } from '../calendar/CalendarProvider';
import type { CommandOutcome } from './types';

export interface DeleteOptions {
  provider: CalendarProvider;
  clock: Clock;
}

/** How far ahead to look when the user did not say which day. */
export const DELETE_SEARCH_DAYS = 14;

function deletable(event: CalendarEvent): event is TimedCalendarEvent {
  return (
    event.kind === 'timed' &&
    event.status !== 'cancelled' &&
    event.responseStatus !== 'declined'
  );
}

async function loadCandidates(
  targetDate: string | undefined,
  options: DeleteOptions,
): Promise<CalendarEvent[]> {
  const { clock, provider } = options;
  const timeZone = clock.timeZone();

  if (targetDate !== undefined) return provider.listEventsForDate(targetDate);

  const today = instantToZonedTime(clock.now(), timeZone).date;
  const lastDay = addDaysToDateString(today, DELETE_SEARCH_DAYS);

  const from = dayBoundsInZone(today, timeZone);
  const to = lastDay === undefined ? undefined : dayBoundsInZone(lastDay, timeZone);
  if (from === undefined || to === undefined) return [];

  return provider.listEvents({ timeMin: from.start, timeMax: to.end });
}

/**
 * Begin a deletion: find the event and ask for confirmation.
 *
 * NOTHING is deleted here. The caller stores the returned pending confirmation and
 * only `confirmDelete` actually removes anything.
 */
export async function startDelete(
  parsed: ParsedCommand,
  options: DeleteOptions,
): Promise<CommandOutcome> {
  const { clock } = options;
  const timeZone = clock.timeZone();

  const target = parsed.title?.trim();
  if (target === undefined || target.length === 0) {
    return { kind: 'delete-unclear' };
  }

  const events = await loadCandidates(parsed.date, options);
  const matches = findEventsByTitle(events.filter(deletable), target).filter(deletable);

  if (matches.length === 0) {
    return { kind: 'delete-not-found', timeZone, target };
  }

  if (matches.length > 1) {
    // Rule 1: never choose which event to destroy.
    return { kind: 'delete-ambiguous', timeZone, target, matches };
  }

  const event = matches[0];
  if (event === undefined) return { kind: 'delete-not-found', timeZone, target };

  // A repeating event needs a fourth question before the other three mean anything:
  // deleting 'the football class' could mean tomorrow's, or every one from now on.
  // Guessing either way is destructive, so it is asked outright — and the answer
  // doubles as the confirmation, since it says exactly what will go.
  if (event.recurringEventId !== undefined) {
    return { kind: 'delete-scope', timeZone, event };
  }

  // Rule 2: describe it and wait.
  return { kind: 'delete-confirm', timeZone, event };
}

/**
 * Actually delete. Only ever reached after an explicit yes.
 *
 * `scope` decides which id is sent: the instance's own, or the series it belongs to.
 * Google treats those as different resources, which is the whole mechanism.
 */
export async function confirmDelete(
  event: TimedCalendarEvent,
  options: DeleteOptions,
  scope: 'instance' | 'series' = 'instance',
): Promise<CommandOutcome> {
  const targetId =
    scope === 'series' && event.recurringEventId !== undefined
      ? event.recurringEventId
      : event.id;

  await options.provider.deleteEvent(targetId);
  return { kind: 'deleted', timeZone: options.clock.timeZone(), event, scope };
}
