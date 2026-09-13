import { describe, expect, it } from 'vitest';
import { mapGoogleEvent, mapGoogleEvents, type GoogleEvent } from './googleMapping';

/** A realistic Google timed event, shaped as the API actually returns it. */
function googleTimed(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: 'evt-1',
    summary: 'חוג כדורגל',
    status: 'confirmed',
    start: { dateTime: '2026-09-14T17:00:00+03:00', timeZone: 'Asia/Jerusalem' },
    end: { dateTime: '2026-09-14T18:00:00+03:00', timeZone: 'Asia/Jerusalem' },
    ...overrides,
  };
}

describe('timed events', () => {
  it('maps the basic fields', () => {
    const mapped = mapGoogleEvent(googleTimed());
    expect(mapped).toEqual({
      kind: 'timed',
      id: 'evt-1',
      title: 'חוג כדורגל',
      status: 'confirmed',
      start: '2026-09-14T17:00:00+03:00',
      end: '2026-09-14T18:00:00+03:00',
    });
  });

  it('falls back to a placeholder title for an event with no summary', () => {
    // Google omits `summary` entirely for an untitled event.
    const untitled: GoogleEvent = {
      id: 'evt-1',
      start: { dateTime: '2026-09-14T17:00:00+03:00' },
      end: { dateTime: '2026-09-14T18:00:00+03:00' },
    };
    expect(mapGoogleEvent(untitled)?.title).toBe('(ללא כותרת)');
    expect(mapGoogleEvent(googleTimed({ summary: '' }))?.title).toBe('(ללא כותרת)');
  });

  it('preserves a cancelled status so conflict detection can ignore it', () => {
    expect(mapGoogleEvent(googleTimed({ status: 'cancelled' }))?.status).toBe('cancelled');
  });

  it('preserves a tentative status, which still blocks', () => {
    expect(mapGoogleEvent(googleTimed({ status: 'tentative' }))?.status).toBe('tentative');
  });

  it('ignores a status value Google should never send', () => {
    expect(mapGoogleEvent(googleTimed({ status: 'nonsense' }))?.status).toBeUndefined();
  });
});

describe('transparency', () => {
  it('maps a transparent event', () => {
    const mapped = mapGoogleEvent(googleTimed({ transparency: 'transparent' }));
    expect(mapped?.transparency).toBe('transparent');
  });

  it('leaves transparency unset when the event is opaque', () => {
    // Google omits the field entirely for opaque events.
    expect(mapGoogleEvent(googleTimed())?.transparency).toBeUndefined();
    expect(mapGoogleEvent(googleTimed({ transparency: 'opaque' }))?.transparency).toBeUndefined();
  });

  it('treats a workingLocation event as transparent', () => {
    // These span whole days and would otherwise wipe out every free slot.
    const mapped = mapGoogleEvent(googleTimed({ eventType: 'workingLocation' }));
    expect(mapped?.transparency).toBe('transparent');
  });

  it('leaves an ordinary default event type blocking', () => {
    expect(mapGoogleEvent(googleTimed({ eventType: 'default' }))?.transparency).toBeUndefined();
  });
});

describe('attendee response', () => {
  it('takes the response from the attendee flagged self', () => {
    const mapped = mapGoogleEvent(
      googleTimed({
        attendees: [
          { email: 'other@example.com', responseStatus: 'accepted' },
          { email: 'me@example.com', self: true, responseStatus: 'declined' },
        ],
      }),
    );
    expect(mapped?.responseStatus).toBe('declined');
  });

  it('ignores other attendees when none is flagged self', () => {
    const mapped = mapGoogleEvent(
      googleTimed({ attendees: [{ email: 'other@example.com', responseStatus: 'declined' }] }),
    );
    expect(mapped?.responseStatus).toBeUndefined();
  });

  it('maps every valid response status', () => {
    for (const status of ['accepted', 'declined', 'tentative', 'needsAction']) {
      const mapped = mapGoogleEvent(
        googleTimed({ attendees: [{ self: true, responseStatus: status }] }),
      );
      expect(mapped?.responseStatus).toBe(status);
    }
  });

  it('drops an unrecognised response status', () => {
    const mapped = mapGoogleEvent(
      googleTimed({ attendees: [{ self: true, responseStatus: 'maybe' }] }),
    );
    expect(mapped?.responseStatus).toBeUndefined();
  });
});

describe('all-day events', () => {
  it('maps start.date and end.date, keeping the end exclusive', () => {
    const mapped = mapGoogleEvent({
      id: 'holiday',
      summary: 'חופשה',
      status: 'confirmed',
      start: { date: '2026-09-14' },
      end: { date: '2026-09-15' },
    });

    expect(mapped).toEqual({
      kind: 'allDay',
      id: 'holiday',
      title: 'חופשה',
      status: 'confirmed',
      startDate: '2026-09-14',
      endDateExclusive: '2026-09-15',
    });
  });

  it('maps a multi-day span', () => {
    const mapped = mapGoogleEvent({
      id: 'trip',
      summary: 'טיול',
      start: { date: '2026-09-14' },
      end: { date: '2026-09-17' },
    });
    expect(mapped).toMatchObject({ kind: 'allDay', endDateExclusive: '2026-09-17' });
  });
});

describe('recurring instances', () => {
  it('preserves recurringEventId on an expanded instance', () => {
    const mapped = mapGoogleEvent(
      googleTimed({ id: 'series_20260914T140000Z', recurringEventId: 'series' }),
    );
    expect(mapped?.recurringEventId).toBe('series');
    expect(mapped?.id).toBe('series_20260914T140000Z');
  });

  it('gives each instance its own distinct id', () => {
    const instances = mapGoogleEvents([
      googleTimed({ id: 'series_1', recurringEventId: 'series' }),
      googleTimed({ id: 'series_2', recurringEventId: 'series' }),
    ]);
    expect(instances.map((event) => event.id)).toEqual(['series_1', 'series_2']);
  });
});

describe('unusable events', () => {
  it('drops an event with no id', () => {
    const noId: GoogleEvent = {
      summary: 'חוג כדורגל',
      start: { dateTime: '2026-09-14T17:00:00+03:00' },
      end: { dateTime: '2026-09-14T18:00:00+03:00' },
    };
    expect(mapGoogleEvent(noId)).toBeUndefined();
  });

  it('drops an event with neither a dateTime nor a date', () => {
    expect(mapGoogleEvent({ id: 'x', summary: 'לא ברור' })).toBeUndefined();
  });

  it('drops an event with a start but no end', () => {
    expect(
      mapGoogleEvent({ id: 'x', start: { dateTime: '2026-09-14T17:00:00+03:00' } }),
    ).toBeUndefined();
  });

  it('skips unusable entries while keeping the rest of the page', () => {
    const mapped = mapGoogleEvents([
      googleTimed({ id: 'good-1' }),
      { id: 'broken' },
      googleTimed({ id: 'good-2' }),
    ]);
    expect(mapped.map((event) => event.id)).toEqual(['good-1', 'good-2']);
  });

  it('returns an empty array for an empty page', () => {
    expect(mapGoogleEvents([])).toEqual([]);
  });
});
