/**
 * Calendar provider abstraction.
 *
 * Reads, creates, updates and deletes events. Deleting is the one irreversible
 * operation, and the rules that guard it live in the assistant layer, not here.
 *
 * The interface exists so a non-Google provider could be substituted without touching
 * conflict detection or the UI.
 */

import type { CalendarEvent, StructuredEvent } from '../../types/calendar';
import type { EventReminder } from '../notifications/reminders';

export interface TimeRangeQuery {
  /** Inclusive lower bound. */
  timeMin: Date;
  /** Exclusive upper bound. */
  timeMax: Date;
}

export interface CreateEventOptions {
  /**
   * Reminders to attach. Defaults to a single popup ten minutes before.
   * This is how the app gets reliable notifications without a push server — see
   * services/notifications/reminders.ts.
   */
  reminders?: readonly EventReminder[];
}

/**
 * A partial change to an existing event.
 *
 * Every field is optional and only the ones present are sent, so renaming an event
 * cannot accidentally disturb its time, and moving it cannot disturb its title.
 */
export interface EventChanges {
  title?: string;
  /** New absolute interval. Supply with `timeZone`. */
  interval?: { start: Date; end: Date };
  timeZone?: string;
}

export interface CreatedEvent {
  /** Provider-assigned id. */
  id: string;
  /** Link to the event in the provider's own UI, when one is returned. */
  htmlLink?: string;
  title: string;
  start: string;
  end: string;
}

export interface CalendarProvider {
  /**
   * Events overlapping the range, as expanded instances.
   *
   * Recurring events MUST be expanded by the implementation — a caller receives
   * concrete instances with real times, never a recurrence rule. Conflict detection
   * depends on this: an unexpanded weekly class would never be seen as busy.
   *
   * Results are ordered by start time.
   */
  listEvents(query: TimeRangeQuery): Promise<CalendarEvent[]>;

  /** Convenience wrapper for a whole local day, in the provider's time zone. */
  listEventsForDate(date: string): Promise<CalendarEvent[]>;

  /**
   * Create a timed event.
   *
   * The provider does NOT check for conflicts — that is the caller's job, and it must
   * happen against freshly fetched events immediately before calling this. Putting the
   * check here would hide it from the tests that prove it happens.
   */
  createEvent(event: StructuredEvent, options?: CreateEventOptions): Promise<CreatedEvent>;

  /**
   * Change an existing event.
   *
   * Sends only the fields present in `changes`, so this is a patch and not a replace.
   * As with createEvent, conflict checking is the caller's job and must run against
   * freshly fetched events immediately before this is called.
   *
   * Deleting is deliberately still absent — it is the one irreversible operation and
   * waits for the full Stage 8 treatment.
   */
  updateEvent(eventId: string, changes: EventChanges): Promise<CreatedEvent>;

  /**
   * Delete an event.
   *
   * The only irreversible operation in this interface. Callers must have established a
   * single unambiguous match first — there is no "delete everything that matched".
   */
  deleteEvent(eventId: string): Promise<void>;
}
