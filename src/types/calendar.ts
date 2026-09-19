/**
 * Provider-neutral calendar types.
 *
 * Nothing here mentions Google. Stage 3 maps the Google Calendar API response onto
 * these shapes, so the conflict detector never learns where its events came from and
 * another provider could be added without touching it.
 */

import type { Recurrence } from '../services/parser/recurrence';

/** A half-open interval [start, end) of absolute instants. */
export interface TimeInterval {
  start: Date;
  end: Date;
}

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';

/** 'transparent' is Google's wording for an event that does not mark you busy. */
export type EventTransparency = 'opaque' | 'transparent';

export type AttendeeResponse = 'accepted' | 'declined' | 'tentative' | 'needsAction';

interface CalendarEventBase {
  id: string;
  title: string;
  status?: EventStatus;
  transparency?: EventTransparency;
  /** The user's own response, when they were invited by someone else. */
  responseStatus?: AttendeeResponse;
  /**
   * Set on an expanded instance of a recurring event.
   *
   * Instances are ordinary events as far as this code is concerned — they block
   * exactly like any other. The caller is responsible for asking the provider to
   * expand recurrences (`singleEvents=true`); an unexpanded master carries no usable
   * times and would silently never conflict.
   */
  recurringEventId?: string;
}

/** An event with real start and end instants. */
export interface TimedCalendarEvent extends CalendarEventBase {
  kind: 'timed';
  /** ISO 8601 with an offset or Z. */
  start: string;
  end: string;
}

/**
 * An all-day event. Held as local dates, with an EXCLUSIVE end, matching the way
 * Google represents them: a single-day event on the 14th ends on the 15th.
 */
export interface AllDayCalendarEvent extends CalendarEventBase {
  kind: 'allDay';
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, exclusive. */
  endDateExclusive: string;
}

export type CalendarEvent = TimedCalendarEvent | AllDayCalendarEvent;

/**
 * A fully validated event, ready to be written to a calendar.
 *
 * Reaching this type means every slot was present, every hour was unambiguous and the
 * interval is real. Nothing downstream needs to re-check those things.
 */
export interface StructuredEvent {
  title: string;
  /** YYYY-MM-DD in `timeZone`. */
  date: string;
  /** HH:mm in `timeZone`. */
  startTime: string;
  /** HH:mm in `timeZone`. May be earlier than startTime for an event past midnight. */
  endTime: string;
  durationMinutes: number;
  timeZone: string;
  /** The same event as absolute instants — what conflict detection compares. */
  interval: TimeInterval;
  /** Repetition rule, when the event is a series rather than a one-off. */
  recurrence?: Recurrence;
}
