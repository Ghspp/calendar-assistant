/**
 * Command orchestration: Hebrew text in, calendar outcome out.
 *
 * This is the only place in the codebase that decides to write to a calendar, and it
 * does so through a fixed sequence:
 *
 *     parse  →  validate  →  fetch the day  →  detect conflicts  →  create or refuse
 *
 * Two invariants this function exists to guarantee:
 *
 *   1. The conflict check runs against events fetched IN THIS CALL, immediately before
 *      the write. Stale data is how double-bookings happen.
 *   2. A single early return separates "safe to write" from everything else. There is
 *      no path to createEvent that skips validation or the conflict check.
 *
 * The pipeline stages themselves stay pure; only this orchestrator performs I/O.
 */

import type { Clock } from '../../utils/clock';
import type { CalendarProvider, CreateEventOptions } from '../calendar/CalendarProvider';
import { CalendarError } from '../calendar/errors';
import { GoogleAuthError } from '../calendar/auth';
import { detectConflicts } from '../conflict/detectConflicts';
import { findFreeSlots } from '../conflict/findFreeSlots';
import { parseCommand } from '../parser';
import { validateEvent } from '../validation/validateEvent';
import { answerFindFree, answerQuery } from './queries';
import { applyUpdate } from './updates';
import { startDelete } from './deletes';
import type { ParsedCommand } from '../../types/parser';
import type { CalendarEvent } from '../../types/calendar';
import type { FreeSlot } from '../conflict/findFreeSlots';
import type { CommandOutcome } from './types';

export interface HandleCommandOptions {
  provider: CalendarProvider;
  clock: Clock;
  create?: CreateEventOptions;
}

/** Intents Stage 4 acts on. Everything else is understood but declined, not guessed at. */
const ACTIONABLE_INTENTS = new Set(['CREATE']);

export async function handleCommand(
  text: string,
  options: HandleCommandOptions,
): Promise<CommandOutcome> {
  return executeCommand(parseCommand(text, options.clock), options);
}

/**
 * Run an already-parsed command through the pipeline.
 *
 * Separated from parsing so the conversation layer can assemble a command across
 * several turns and still go through this one, identical path — there is no second
 * route to the calendar for multi-turn requests.
 */
export async function executeCommand(
  parsed: ParsedCommand,
  options: HandleCommandOptions,
): Promise<CommandOutcome> {
  const { provider, clock } = options;
  const timeZone = clock.timeZone();

  // Read-only questions. These never write and so need no validation gate — but they
  // are still wrapped, so an API failure surfaces as a Hebrew message rather than a
  // rejected promise.
  if (parsed.intent === 'QUERY' || parsed.intent === 'FIND_FREE') {
    try {
      return parsed.intent === 'QUERY'
        ? await answerQuery(parsed, { provider, clock })
        : await answerFindFree(parsed, { provider, clock });
    } catch (error) {
      return toFailure(error);
    }
  }

  // Changing an existing event. Deleting is still absent — it is the one irreversible
  // operation and waits for the full Stage 8 treatment.
  if (parsed.intent === 'UPDATE') {
    try {
      return await applyUpdate(parsed, { provider, clock });
    } catch (error) {
      return toFailure(error);
    }
  }

  // Deleting. This only ever gets as far as asking for confirmation — the actual
  // removal happens in the conversation layer, after an explicit yes.
  if (parsed.intent === 'DELETE') {
    try {
      return await startDelete(parsed, { provider, clock });
    } catch (error) {
      return toFailure(error);
    }
  }

  if (!ACTIONABLE_INTENTS.has(parsed.intent)) {
    return { kind: 'unsupported', parsed };
  }

  try {
    // 'בזמן הפנוי הראשון' — the hour comes from the calendar rather than the
    // utterance. Resolved before validation, which insists on a concrete start.
    const command = parsed.useFirstFreeSlot
      ? await resolveFirstFreeSlot(parsed, options)
      : parsed;

    if (command === undefined) {
      return { kind: 'no-free-slot', date: parsed.date ?? '', timeZone };
    }

    // The safety gate. An ambiguous hour or a missing slot stops here.
    const validation = validateEvent(command, clock);
    if (!validation.ok) {
      return { kind: 'needs-input', parsed: command, errors: validation.errors };
    }

    const event = validation.event;

    // Fetch fresh. An event created on the phone a minute ago must be seen.
    const existing = await provider.listEventsForDate(event.date);
    const report = detectConflicts(event.interval, existing, timeZone);

    if (report.hasConflict) {
      // NOTHING is written, and the event is never relocated on its own. Offering an
      // alternative is not the same as taking one: the suggestion is inert until the
      // user says yes.
      const suggestion = suggestAlternative(event, existing, options);
      return {
        kind: 'conflict',
        event,
        conflicts: report.conflicts,
        ...(suggestion !== undefined ? { suggestion } : {}),
      };
    }

    const created = await provider.createEvent(event, options.create);

    return { kind: 'created', event, created, informational: report.informational };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Fill in the start time from the earliest gap that fits.
 *
 * Returns undefined when the day has no opening long enough, which the caller reports
 * rather than booking something that does not fit.
 */
async function resolveFirstFreeSlot(
  parsed: ParsedCommand,
  options: HandleCommandOptions,
): Promise<ParsedCommand | undefined> {
  const { provider, clock } = options;

  const date = parsed.date;
  const durationMinutes = parsed.durationMinutes;
  if (date === undefined || durationMinutes === undefined) return parsed;

  const events = await provider.listEventsForDate(date);
  const slot = findFreeSlots({ date, events, durationMinutes }, clock)[0];
  if (slot === undefined) return undefined;

  return { ...parsed, startTime: slot.startTime, ambiguities: [], missing: [] };
}

/**
 * The earliest gap that would have worked instead.
 *
 * Prefers a slot after the time that was asked for, since someone who wanted 17:30
 * is more likely to accept 19:00 than 09:00. Falls back to the first of the day.
 */
function suggestAlternative(
  event: { date: string; durationMinutes: number; startTime: string },
  events: readonly CalendarEvent[],
  options: HandleCommandOptions,
): FreeSlot | undefined {
  const slots = findFreeSlots(
    { date: event.date, events, durationMinutes: event.durationMinutes },
    options.clock,
  );

  const after = slots.find((slot) => slot.startTime >= event.startTime);
  return after ?? slots[0];
}

function toFailure(error: unknown): CommandOutcome {
  if (error instanceof CalendarError) {
    return { kind: 'failed', errorKind: error.kind, message: error.hebrewMessage };
  }
  if (error instanceof GoogleAuthError) {
    return { kind: 'failed', errorKind: 'unknown', message: error.hebrewMessage };
  }
  return { kind: 'failed', errorKind: 'unknown', message: 'אירעה שגיאה בלתי צפויה.' };
}
