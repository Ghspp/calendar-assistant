import { describe, expect, it, vi } from 'vitest';
import { createGoogleCalendarProvider, type FetchLike } from './GoogleCalendarProvider';
import { CalendarError } from './errors';
import { detectConflicts } from '../conflict/detectConflicts';
import { findFreeSlots } from '../conflict/findFreeSlots';
import { fixedClock } from '../../utils/clock';
import { zonedTimeToInstant } from '../../utils/time';
import type { GoogleEvent, GoogleEventsResponse } from './googleMapping';

/**
 * Every test here runs against a fake fetch. Nothing in this file can reach Google:
 * the provider's only route to the network is the injected fetchImpl.
 */

const TZ = 'Asia/Jerusalem';
const CLOCK = fixedClock('2026-09-13T09:00:00Z');

function jsonResponse(body: GoogleEventsResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, reason?: string, message = 'boom'): Response {
  return new Response(
    JSON.stringify({
      error: { code: status, message, errors: reason !== undefined ? [{ reason }] : [] },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function googleTimed(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: 'evt-1',
    summary: 'חוג כדורגל',
    status: 'confirmed',
    start: { dateTime: '2026-09-14T17:00:00+03:00' },
    end: { dateTime: '2026-09-14T18:00:00+03:00' },
    ...overrides,
  };
}

function makeProvider(fetchImpl: FetchLike, onAuthExpired?: () => void) {
  return createGoogleCalendarProvider({
    getAccessToken: async () => 'fake-token',
    fetchImpl,
    timeZone: TZ,
    ...(onAuthExpired !== undefined ? { onAuthExpired } : {}),
  });
}

const DAY_RANGE = {
  timeMin: new Date('2026-09-13T21:00:00Z'),
  timeMax: new Date('2026-09-14T21:00:00Z'),
};

describe('request construction', () => {
  it('expands recurring events with singleEvents=true', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    await makeProvider(fetchImpl).listEvents(DAY_RANGE);

    const url = new URL(fetchImpl.mock.calls[0]?.[0] ?? '');
    // Without this, a weekly class arrives as a rule and never registers as busy.
    expect(url.searchParams.get('singleEvents')).toBe('true');
  });

  it('orders by start time', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    await makeProvider(fetchImpl).listEvents(DAY_RANGE);
    const url = new URL(fetchImpl.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('orderBy')).toBe('startTime');
  });

  it('queries the primary calendar', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    await makeProvider(fetchImpl).listEvents(DAY_RANGE);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/calendars/primary/events');
  });

  it('sends the range as RFC3339 instants', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    await makeProvider(fetchImpl).listEvents(DAY_RANGE);
    const url = new URL(fetchImpl.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('timeMin')).toBe('2026-09-13T21:00:00.000Z');
    expect(url.searchParams.get('timeMax')).toBe('2026-09-14T21:00:00.000Z');
  });

  it('asks for Israel time and excludes deleted events', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    await makeProvider(fetchImpl).listEvents(DAY_RANGE);
    const url = new URL(fetchImpl.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('timeZone')).toBe('Asia/Jerusalem');
    expect(url.searchParams.get('showDeleted')).toBe('false');
  });

  it('sends the bearer token', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    await makeProvider(fetchImpl).listEvents(DAY_RANGE);
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer fake-token');
  });

  it('never asks for an interactive token during a background read', async () => {
    const getAccessToken = vi.fn(async () => 'fake-token');
    const provider = createGoogleCalendarProvider({
      getAccessToken,
      fetchImpl: async () => jsonResponse({ items: [] }),
      timeZone: TZ,
    });
    await provider.listEvents(DAY_RANGE);
    expect(getAccessToken).toHaveBeenCalledWith({ interactive: false });
  });

  it('does not call the API at all for an inverted range', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    const events = await makeProvider(fetchImpl).listEvents({
      timeMin: DAY_RANGE.timeMax,
      timeMax: DAY_RANGE.timeMin,
    });
    expect(events).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('listEventsForDate', () => {
  it('covers local midnight to local midnight', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    await makeProvider(fetchImpl).listEventsForDate('2026-09-14');

    const url = new URL(fetchImpl.mock.calls[0]?.[0] ?? '');
    // 00:00 Israel on the 14th is 21:00Z on the 13th (IDT, +03:00).
    expect(url.searchParams.get('timeMin')).toBe('2026-09-13T21:00:00.000Z');
    expect(url.searchParams.get('timeMax')).toBe('2026-09-14T21:00:00.000Z');
  });

  it('uses the winter offset in December', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    await makeProvider(fetchImpl).listEventsForDate('2026-12-14');
    const url = new URL(fetchImpl.mock.calls[0]?.[0] ?? '');
    // 00:00 Israel is 22:00Z the previous day (IST, +02:00).
    expect(url.searchParams.get('timeMin')).toBe('2026-12-13T22:00:00.000Z');
  });

  it('returns nothing for an invalid date without calling the API', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    expect(await makeProvider(fetchImpl).listEventsForDate('2026-02-30')).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('mapping a real-shaped response', () => {
  it('returns internal CalendarEvents', async () => {
    const provider = makeProvider(async () => jsonResponse({ items: [googleTimed()] }));
    const events = await provider.listEvents(DAY_RANGE);

    expect(events).toEqual([
      {
        kind: 'timed',
        id: 'evt-1',
        title: 'חוג כדורגל',
        status: 'confirmed',
        start: '2026-09-14T17:00:00+03:00',
        end: '2026-09-14T18:00:00+03:00',
      },
    ]);
  });

  it('handles a response with no items field', async () => {
    const provider = makeProvider(async () => jsonResponse({}));
    expect(await provider.listEvents(DAY_RANGE)).toEqual([]);
  });
});

describe('pagination', () => {
  it('follows nextPageToken and concatenates pages', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      const token = new URL(url).searchParams.get('pageToken');
      if (token === null) {
        return jsonResponse({ items: [googleTimed({ id: 'a' })], nextPageToken: 'page-2' });
      }
      return jsonResponse({ items: [googleTimed({ id: 'b' })] });
    });

    const events = await makeProvider(fetchImpl).listEvents(DAY_RANGE);
    expect(events.map((event) => event.id)).toEqual(['a', 'b']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops at the page cap rather than looping forever', async () => {
    // A server that always returns a cursor must not hang the app.
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ items: [googleTimed()], nextPageToken: 'always' }),
    );
    await makeProvider(fetchImpl).listEvents(DAY_RANGE);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });
});

describe('error states', () => {
  it('reports a dead token as not-authenticated and notifies the caller', async () => {
    const onAuthExpired = vi.fn();
    const provider = makeProvider(async () => errorResponse(401), onAuthExpired);

    await expect(provider.listEvents(DAY_RANGE)).rejects.toMatchObject({
      kind: 'not-authenticated',
      hebrewMessage: 'נדרשת התחברות ל-Google Calendar.',
    });
    expect(onAuthExpired).toHaveBeenCalledOnce();
  });

  it('reports a missing scope as permission-denied', async () => {
    const provider = makeProvider(async () => errorResponse(403, 'insufficientPermissions'));
    await expect(provider.listEvents(DAY_RANGE)).rejects.toMatchObject({
      kind: 'permission-denied',
    });
  });

  it('distinguishes a 403 quota error from a permission error', async () => {
    const provider = makeProvider(async () => errorResponse(403, 'rateLimitExceeded'));
    await expect(provider.listEvents(DAY_RANGE)).rejects.toMatchObject({
      kind: 'rate-limited',
    });
  });

  it('reports 429 as rate-limited', async () => {
    const provider = makeProvider(async () => errorResponse(429));
    await expect(provider.listEvents(DAY_RANGE)).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('reports a server error as an API error', async () => {
    const provider = makeProvider(async () => errorResponse(500));
    await expect(provider.listEvents(DAY_RANGE)).rejects.toMatchObject({ kind: 'api' });
  });

  it('reports a transport failure as a network error', async () => {
    const provider = makeProvider(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(provider.listEvents(DAY_RANGE)).rejects.toMatchObject({
      kind: 'network',
      hebrewMessage: 'אין חיבור לשרתי Google. בדוק את חיבור האינטרנט.',
    });
  });

  it('reports malformed JSON as an API error', async () => {
    const provider = makeProvider(
      async () => new Response('<html>not json</html>', { status: 200 }),
    );
    await expect(provider.listEvents(DAY_RANGE)).rejects.toMatchObject({ kind: 'api' });
  });

  it('does not call onAuthExpired for an unrelated failure', async () => {
    const onAuthExpired = vi.fn();
    const provider = makeProvider(async () => errorResponse(500), onAuthExpired);
    await expect(provider.listEvents(DAY_RANGE)).rejects.toThrow(CalendarError);
    expect(onAuthExpired).not.toHaveBeenCalled();
  });

  it('propagates a failure to obtain a token', async () => {
    const provider = createGoogleCalendarProvider({
      getAccessToken: async () => {
        throw new Error('no token');
      },
      fetchImpl: async () => jsonResponse({ items: [] }),
      timeZone: TZ,
    });
    await expect(provider.listEvents(DAY_RANGE)).rejects.toThrow('no token');
  });
});

describe('Stage 2 rules still hold against Google-shaped data', () => {
  /** A day of events as Google would return them, covering every exclusion rule. */
  const items: GoogleEvent[] = [
    googleTimed({ id: 'football', summary: 'חוג כדורגל', recurringEventId: 'series' }),
    googleTimed({
      id: 'cancelled',
      summary: 'פגישה מבוטלת',
      status: 'cancelled',
      start: { dateTime: '2026-09-14T19:00:00+03:00' },
      end: { dateTime: '2026-09-14T20:00:00+03:00' },
    }),
    googleTimed({
      id: 'free',
      summary: 'תזכורת',
      transparency: 'transparent',
      start: { dateTime: '2026-09-14T20:00:00+03:00' },
      end: { dateTime: '2026-09-14T21:00:00+03:00' },
    }),
    googleTimed({
      id: 'declined',
      summary: 'ישיבת צוות',
      attendees: [{ self: true, responseStatus: 'declined' }],
      start: { dateTime: '2026-09-14T21:00:00+03:00' },
      end: { dateTime: '2026-09-14T22:00:00+03:00' },
    }),
    {
      id: 'holiday',
      summary: 'חופשה',
      status: 'confirmed',
      start: { date: '2026-09-14' },
      end: { date: '2026-09-15' },
    },
  ];

  async function loadDay() {
    const provider = makeProvider(async () => jsonResponse({ items }));
    return provider.listEventsForDate('2026-09-14');
  }

  function slot(startTime: string, endTime: string) {
    const start = zonedTimeToInstant('2026-09-14', startTime, TZ);
    const end = zonedTimeToInstant('2026-09-14', endTime, TZ);
    if (start === undefined || end === undefined) throw new Error('bad fixture');
    return { start, end };
  }

  it('blocks on the recurring instance', async () => {
    const events = await loadDay();
    const report = detectConflicts(slot('17:30', '18:30'), events, TZ);
    expect(report.hasConflict).toBe(true);
    expect(report.conflicts[0]?.event.title).toBe('חוג כדורגל');
  });

  it('allows the touching boundary right after it', async () => {
    const events = await loadDay();
    expect(detectConflicts(slot('18:00', '19:00'), events, TZ).hasConflict).toBe(false);
  });

  it('ignores the cancelled, transparent and declined events', async () => {
    const events = await loadDay();
    for (const [start, end] of [
      ['19:00', '20:00'],
      ['20:00', '21:00'],
      ['21:00', '22:00'],
    ] as const) {
      expect(detectConflicts(slot(start, end), events, TZ).hasConflict).toBe(false);
    }
  });

  it('treats the all-day event as informational only', async () => {
    const events = await loadDay();
    const report = detectConflicts(slot('17:30', '18:30'), events, TZ);
    expect(report.informational.map((event) => event.title)).toEqual(['חופשה']);
  });

  it('leaves the day free apart from the football class', async () => {
    const events = await loadDay();
    const free = findFreeSlots(
      { date: '2026-09-14', events, durationMinutes: 60 },
      CLOCK,
    );
    expect(free.map((entry) => `${entry.startTime}-${entry.endTime}`)).toEqual([
      '08:00-17:00',
      '18:00-22:00',
    ]);
  });
});


describe('createEvent', () => {
  const EVENT = {
    title: 'פגישה עם דניאל',
    date: '2026-09-14',
    startTime: '18:00',
    endTime: '19:00',
    durationMinutes: 60,
    timeZone: TZ,
    interval: {
      start: new Date('2026-09-14T15:00:00Z'),
      end: new Date('2026-09-14T16:00:00Z'),
    },
  };

  function createdResponse(): Response {
    return new Response(
      JSON.stringify({
        id: 'created-123',
        htmlLink: 'https://calendar.google.com/event?eid=abc',
        summary: 'פגישה עם דניאל',
        start: { dateTime: '2026-09-14T18:00:00+03:00' },
        end: { dateTime: '2026-09-14T19:00:00+03:00' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function bodyOf(fetchImpl: ReturnType<typeof vi.fn>): Record<string, unknown> {
    const raw = fetchImpl.mock.calls[0]?.[1]?.body;
    return JSON.parse(String(raw)) as Record<string, unknown>;
  }

  it('POSTs to the events collection', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => createdResponse());
    await makeProvider(fetchImpl).createEvent(EVENT);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('sends the title and both instants with an explicit time zone', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => createdResponse());
    await makeProvider(fetchImpl).createEvent(EVENT);

    expect(bodyOf(fetchImpl)).toMatchObject({
      summary: 'פגישה עם דניאל',
      start: { dateTime: '2026-09-14T15:00:00.000Z', timeZone: 'Asia/Jerusalem' },
      end: { dateTime: '2026-09-14T16:00:00.000Z', timeZone: 'Asia/Jerusalem' },
    });
  });

  it('attaches the default reminder', async () => {
    // This is how the app gets a reliable notification with no push server: the
    // native Google Calendar app fires it, even when this app is closed.
    const fetchImpl = vi.fn<FetchLike>(async () => createdResponse());
    await makeProvider(fetchImpl).createEvent(EVENT);

    expect(bodyOf(fetchImpl)['reminders']).toEqual({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 10 }],
    });
  });

  it('honours custom reminders', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => createdResponse());
    await makeProvider(fetchImpl).createEvent(EVENT, {
      reminders: [{ method: 'popup', minutes: 30 }],
    });

    expect(bodyOf(fetchImpl)['reminders']).toEqual({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }],
    });
  });

  it('sends a JSON content type', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => createdResponse());
    await makeProvider(fetchImpl).createEvent(EVENT);
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer fake-token');
  });

  it('returns the created event with its id and link', async () => {
    const created = await makeProvider(async () => createdResponse()).createEvent(EVENT);
    expect(created).toEqual({
      id: 'created-123',
      htmlLink: 'https://calendar.google.com/event?eid=abc',
      title: 'פגישה עם דניאל',
      start: '2026-09-14T18:00:00+03:00',
      end: '2026-09-14T19:00:00+03:00',
    });
  });

  it('may request an interactive token, since a write follows a user action', async () => {
    const getAccessToken = vi.fn(async () => 'fake-token');
    const provider = createGoogleCalendarProvider({
      getAccessToken,
      fetchImpl: async () => createdResponse(),
      timeZone: TZ,
    });
    await provider.createEvent(EVENT);
    expect(getAccessToken).toHaveBeenCalledWith({ interactive: true });
  });

  it('reports a missing write scope as permission-denied', async () => {
    const provider = makeProvider(async () => errorResponse(403, 'insufficientPermissions'));
    await expect(provider.createEvent(EVENT)).rejects.toMatchObject({
      kind: 'permission-denied',
    });
  });

  it('reports a transport failure as a network error', async () => {
    const provider = makeProvider(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(provider.createEvent(EVENT)).rejects.toMatchObject({ kind: 'network' });
  });

  it('rejects a response with no id rather than pretending it worked', async () => {
    const provider = makeProvider(
      async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(provider.createEvent(EVENT)).rejects.toBeInstanceOf(CalendarError);
  });

  it('sends no body on a read, so a GET is never mistaken for a write', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ items: [] }));
    await makeProvider(fetchImpl).listEvents(DAY_RANGE);
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
});
