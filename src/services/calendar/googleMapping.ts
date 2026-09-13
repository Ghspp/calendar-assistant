/**
 * Mapping from the Google Calendar API wire format onto our internal CalendarEvent.
 *
 * Pure and separately testable: everything that could be got wrong about Google's
 * representation lives here, and the conflict detector never sees a Google shape.
 *
 * The mapping deliberately preserves the fields the Stage 2 conflict rules depend on —
 * status, transparency, the user's own response and the all-day distinction — so those
 * rules keep working unchanged against real data.
 */

import type { CalendarEvent, AttendeeResponse, EventStatus } from '../../types/calendar';

/** The subset of Google's event resource we consume. */
export interface GoogleEvent {
  id?: string;
  summary?: string;
  status?: string;
  transparency?: string;
  eventType?: string;
  recurringEventId?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  attendees?: GoogleAttendee[];
}

export interface GoogleEventDateTime {
  /** RFC3339 with offset, for timed events. */
  dateTime?: string;
  /** YYYY-MM-DD, for all-day events. Google's end date is EXCLUSIVE. */
  date?: string;
  timeZone?: string;
}

export interface GoogleAttendee {
  email?: string;
  self?: boolean;
  responseStatus?: string;
}

export interface GoogleEventsResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

const EVENT_STATUSES = new Set<string>(['confirmed', 'tentative', 'cancelled']);
const RESPONSE_STATUSES = new Set<string>([
  'accepted',
  'declined',
  'tentative',
  'needsAction',
]);

/**
 * Event types that never make the user busy.
 *
 * Google emits workingLocation entries for 'working from home' style markers. They
 * occupy the whole day and would wipe out every free slot if treated as busy, so they
 * are mapped to transparent and the existing rules then ignore them.
 */
const NON_BLOCKING_EVENT_TYPES = new Set(['workingLocation']);

function toStatus(value: string | undefined): EventStatus | undefined {
  return value !== undefined && EVENT_STATUSES.has(value) ? (value as EventStatus) : undefined;
}

function toResponseStatus(value: string | undefined): AttendeeResponse | undefined {
  return value !== undefined && RESPONSE_STATUSES.has(value)
    ? (value as AttendeeResponse)
    : undefined;
}

/** The user's own response, taken from the attendee flagged `self`. */
function selfResponse(event: GoogleEvent): AttendeeResponse | undefined {
  const self = event.attendees?.find((attendee) => attendee.self === true);
  return toResponseStatus(self?.responseStatus);
}

/**
 * Map one Google event.
 *
 * Returns undefined for anything unusable — no id, or neither a dateTime nor a date —
 * rather than inventing times. A dropped event is safer than a wrong one, but note it
 * means a malformed event cannot block a booking; that is why Stage 4 will re-check
 * conflicts immediately before writing.
 */
export function mapGoogleEvent(event: GoogleEvent): CalendarEvent | undefined {
  const id = event.id;
  if (id === undefined || id.length === 0) return undefined;

  const title = event.summary !== undefined && event.summary.length > 0
    ? event.summary
    : '(ללא כותרת)';

  const status = toStatus(event.status);
  const responseStatus = selfResponse(event);

  const transparency =
    event.transparency === 'transparent' ||
    (event.eventType !== undefined && NON_BLOCKING_EVENT_TYPES.has(event.eventType))
      ? ('transparent' as const)
      : undefined;

  const common = {
    id,
    title,
    ...(status !== undefined ? { status } : {}),
    ...(transparency !== undefined ? { transparency } : {}),
    ...(responseStatus !== undefined ? { responseStatus } : {}),
    ...(event.recurringEventId !== undefined
      ? { recurringEventId: event.recurringEventId }
      : {}),
  };

  const startDateTime = event.start?.dateTime;
  const endDateTime = event.end?.dateTime;
  if (startDateTime !== undefined && endDateTime !== undefined) {
    return { kind: 'timed', ...common, start: startDateTime, end: endDateTime };
  }

  const startDate = event.start?.date;
  const endDate = event.end?.date;
  if (startDate !== undefined && endDate !== undefined) {
    // Google already stores the end date as exclusive, matching our type.
    return { kind: 'allDay', ...common, startDate, endDateExclusive: endDate };
  }

  return undefined;
}

/** Map a page of events, silently dropping unusable entries. */
export function mapGoogleEvents(events: readonly GoogleEvent[]): CalendarEvent[] {
  const mapped: CalendarEvent[] = [];
  for (const event of events) {
    const result = mapGoogleEvent(event);
    if (result !== undefined) mapped.push(result);
  }
  return mapped;
}
