/**
 * Google Calendar API v3, read-only.
 *
 * The API is reached with plain fetch and a bearer token — the REST endpoints are
 * CORS-enabled, so no SDK is needed. Both the token source and fetch itself are
 * injected, which is what lets the tests exercise the whole provider against recorded
 * Google responses without ever touching the network.
 */

import type { CalendarEvent, StructuredEvent } from '../../types/calendar';
import type {
  CalendarProvider,
  CreateEventOptions,
  CreatedEvent,
  EventChanges,
  TimeRangeQuery,
} from './CalendarProvider';
import { buildReminders } from '../notifications/reminders';
import { calendarError, kindFromStatus } from './errors';
import { mapGoogleEvents, type GoogleEventsResponse } from './googleMapping';
import { APP_TIME_ZONE } from '../../utils/clock';
import { dayBoundsInZone } from '../../utils/time';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/** The user's default calendar. Google resolves the literal id 'primary'. */
const PRIMARY_CALENDAR_ID = 'primary';

/** Google's per-page maximum is 2500; 250 keeps responses small and quick. */
const PAGE_SIZE = 250;

/** Guard against an unbounded paging loop if the API keeps handing back cursors. */
const MAX_PAGES = 10;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GoogleCalendarProviderOptions {
  /**
   * Supplies a bearer token. `interactive` is false for background refreshes, so the
   * provider never triggers a popup outside a user gesture.
   */
  getAccessToken: (options: { interactive: boolean }) => Promise<string>;
  /** Called when the API reports the token is dead, so the caller can drop it. */
  onAuthExpired?: () => void;
  fetchImpl?: FetchLike;
  timeZone?: string;
  calendarId?: string;
}

interface GoogleCreatedEvent {
  id?: string;
  htmlLink?: string;
  summary?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

async function readErrorReason(response: Response): Promise<{ reason?: string; detail?: string }> {
  try {
    const body: unknown = await response.json();
    const parsed = body as GoogleErrorBody;
    const first = parsed.error?.errors?.[0];
    return {
      ...(first?.reason !== undefined ? { reason: first.reason } : {}),
      ...(parsed.error?.message !== undefined ? { detail: parsed.error.message } : {}),
    };
  } catch {
    return {};
  }
}

export function createGoogleCalendarProvider(
  options: GoogleCalendarProviderOptions,
): CalendarProvider {
  const timeZone = options.timeZone ?? APP_TIME_ZONE;
  const calendarId = options.calendarId ?? PRIMARY_CALENDAR_ID;
  const doFetch: FetchLike =
    options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));

  function buildUrl(query: TimeRangeQuery, pageToken?: string): string {
    const params = new URLSearchParams({
      timeMin: query.timeMin.toISOString(),
      timeMax: query.timeMax.toISOString(),
      // Expand recurring events into concrete instances. Conflict detection depends on
      // this: without it a weekly class arrives as a rule and never registers as busy.
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(PAGE_SIZE),
      showDeleted: 'false',
      // Ask Google to render times in Israel local time. Comparisons still run on
      // absolute instants, but it keeps the raw payload readable while debugging.
      timeZone,
    });

    if (pageToken !== undefined) params.set('pageToken', pageToken);

    return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
  }

  async function request<T>(
    url: string,
    token: string,
    init?: { method?: string; body?: unknown; expectNoContent?: boolean },
  ): Promise<T> {
    let response: Response;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      response = await doFetch(url, {
        ...(init?.method !== undefined ? { method: init.method } : {}),
        headers,
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (cause) {
      // fetch rejects only on a transport failure, never on an HTTP error status.
      throw calendarError('network', { cause });
    }

    if (!response.ok) {
      const { reason, detail } = await readErrorReason(response);
      const kind = kindFromStatus(response.status, reason);

      if (kind === 'not-authenticated') options.onAuthExpired?.();

      throw calendarError(kind, {
        status: response.status,
        ...(detail !== undefined ? { detail } : {}),
      });
    }

    // A successful DELETE answers 204 with an empty body.
    if (init?.expectNoContent === true || response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw calendarError('api', { detail: 'תשובת Google אינה JSON תקין', cause });
    }
  }

  async function listEvents(query: TimeRangeQuery): Promise<CalendarEvent[]> {
    if (query.timeMax.getTime() <= query.timeMin.getTime()) return [];

    const token = await options.getAccessToken({ interactive: false });

    const collected: CalendarEvent[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await request<GoogleEventsResponse>(buildUrl(query, pageToken), token);
      collected.push(...mapGoogleEvents(body.items ?? []));

      pageToken = body.nextPageToken;
      if (pageToken === undefined) break;
    }

    return collected;
  }

  async function listEventsForDate(date: string): Promise<CalendarEvent[]> {
    const bounds = dayBoundsInZone(date, timeZone);
    if (bounds === undefined) return [];
    return listEvents({ timeMin: bounds.start, timeMax: bounds.end });
  }

  /**
   * Create a timed event on the calendar.
   *
   * Times are sent as UTC instants alongside an explicit timeZone. The instant is what
   * actually fixes the moment; the timeZone tells Google which wall clock to display it
   * in, and is what makes a recurring copy of this event behave sensibly across DST.
   */
  async function createEvent(
    event: StructuredEvent,
    createOptions?: CreateEventOptions,
  ): Promise<CreatedEvent> {
    // Interactive: creating is always the direct result of a user action, so if the
    // token has lapsed it is legitimate to ask for a new one rather than fail.
    const token = await options.getAccessToken({ interactive: true });

    const body = {
      summary: event.title,
      start: { dateTime: event.interval.start.toISOString(), timeZone: event.timeZone },
      end: { dateTime: event.interval.end.toISOString(), timeZone: event.timeZone },
      reminders: buildReminders(createOptions?.reminders),
    };

    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
    const created = await request<GoogleCreatedEvent>(url, token, { method: 'POST', body });

    if (created.id === undefined) {
      throw calendarError('api', { detail: 'Google לא החזיר מזהה לאירוע שנוצר' });
    }

    return {
      id: created.id,
      ...(created.htmlLink !== undefined ? { htmlLink: created.htmlLink } : {}),
      title: created.summary ?? event.title,
      start: created.start?.dateTime ?? event.interval.start.toISOString(),
      end: created.end?.dateTime ?? event.interval.end.toISOString(),
    };
  }

  /**
   * Patch an existing event.
   *
   * PATCH rather than PUT: only the named fields are sent, so a rename leaves the
   * event's time, attendees, reminders and everything else exactly as they were.
   */
  async function updateEvent(eventId: string, changes: EventChanges): Promise<CreatedEvent> {
    if (eventId.length === 0) {
      throw calendarError('api', { detail: 'לא ניתן לעדכן אירוע ללא מזהה' });
    }

    const token = await options.getAccessToken({ interactive: true });
    const zone = changes.timeZone ?? timeZone;

    const body: Record<string, unknown> = {};
    if (changes.title !== undefined) body['summary'] = changes.title;
    if (changes.interval !== undefined) {
      body['start'] = { dateTime: changes.interval.start.toISOString(), timeZone: zone };
      body['end'] = { dateTime: changes.interval.end.toISOString(), timeZone: zone };
    }

    if (Object.keys(body).length === 0) {
      throw calendarError('api', { detail: 'אין מה לעדכן' });
    }

    const url =
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}` +
      `/events/${encodeURIComponent(eventId)}`;

    const updated = await request<GoogleCreatedEvent>(url, token, { method: 'PATCH', body });

    return {
      id: updated.id ?? eventId,
      ...(updated.htmlLink !== undefined ? { htmlLink: updated.htmlLink } : {}),
      title: updated.summary ?? changes.title ?? '',
      start: updated.start?.dateTime ?? changes.interval?.start.toISOString() ?? '',
      end: updated.end?.dateTime ?? changes.interval?.end.toISOString() ?? '',
    };
  }

  async function deleteEvent(eventId: string): Promise<void> {
    if (eventId.length === 0) {
      throw calendarError('api', { detail: 'לא ניתן למחוק אירוע ללא מזהה' });
    }

    const token = await options.getAccessToken({ interactive: true });
    const url =
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}` +
      `/events/${encodeURIComponent(eventId)}`;

    await request<void>(url, token, { method: 'DELETE', expectNoContent: true });
  }

  return { listEvents, listEventsForDate, createEvent, updateEvent, deleteEvent };
}
