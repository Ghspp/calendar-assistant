import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notifyCalendarChanged,
  onCalendarChanged,
  resetCalendarChangeListeners,
  withChangeNotifications,
  type CalendarChangeKind,
} from './changes';
import { calendarError } from './errors';
import type { CalendarProvider } from './CalendarProvider';
import type { StructuredEvent } from '../../types/calendar';

afterEach(() => resetCalendarChangeListeners());

const EVENT: StructuredEvent = {
  title: 'פגישה',
  date: '2026-09-14',
  startTime: '18:00',
  endTime: '19:00',
  durationMinutes: 60,
  timeZone: 'Asia/Jerusalem',
  interval: {
    start: new Date('2026-09-14T15:00:00Z'),
    end: new Date('2026-09-14T16:00:00Z'),
  },
};

function stubProvider(overrides: Partial<CalendarProvider> = {}): CalendarProvider {
  return {
    listEvents: vi.fn(async () => []),
    listEventsForDate: vi.fn(async () => []),
    createEvent: vi.fn(async () => ({ id: 'x', title: 'פגישה', start: '', end: '' })),
    updateEvent: vi.fn(async () => ({ id: 'x', title: 'פגישה', start: '', end: '' })),
    deleteEvent: vi.fn(async () => undefined),
    ...overrides,
  };
}

function record() {
  const seen: CalendarChangeKind[] = [];
  onCalendarChanged((kind) => seen.push(kind));
  return seen;
}

describe('announcing writes', () => {
  it('announces a creation', async () => {
    const seen = record();
    await withChangeNotifications(stubProvider()).createEvent(EVENT);
    expect(seen).toEqual(['created']);
  });

  it('announces an update', async () => {
    const seen = record();
    await withChangeNotifications(stubProvider()).updateEvent('x', { title: 'חדש' });
    expect(seen).toEqual(['updated']);
  });

  it('announces a deletion', async () => {
    const seen = record();
    await withChangeNotifications(stubProvider()).deleteEvent('x');
    expect(seen).toEqual(['deleted']);
  });

  it('stays silent on reads', async () => {
    const seen = record();
    const provider = withChangeNotifications(stubProvider());

    await provider.listEvents({ timeMin: new Date(), timeMax: new Date() });
    await provider.listEventsForDate('2026-09-14');

    expect(seen).toEqual([]);
  });

  it('stays silent when a write fails', async () => {
    // Nothing changed, so a reload would only hide the error behind a refresh.
    const seen = record();
    const provider = withChangeNotifications(
      stubProvider({
        createEvent: vi.fn(async () => {
          throw calendarError('permission-denied');
        }),
      }),
    );

    await expect(provider.createEvent(EVENT)).rejects.toThrow();
    expect(seen).toEqual([]);
  });

  it('passes the result through unchanged', async () => {
    const created = await withChangeNotifications(stubProvider()).createEvent(EVENT);
    expect(created.id).toBe('x');
  });

  it('forwards the arguments it was given', async () => {
    const inner = stubProvider();
    await withChangeNotifications(inner).updateEvent('abc', { title: 'חדש' });
    expect(inner.updateEvent).toHaveBeenCalledWith('abc', { title: 'חדש' });
  });
});

describe('subscriptions', () => {
  it('notifies every listener', () => {
    const first: CalendarChangeKind[] = [];
    const second: CalendarChangeKind[] = [];
    onCalendarChanged((kind) => first.push(kind));
    onCalendarChanged((kind) => second.push(kind));

    notifyCalendarChanged('created');

    expect(first).toEqual(['created']);
    expect(second).toEqual(['created']);
  });

  it('stops notifying after unsubscribe', () => {
    const seen: CalendarChangeKind[] = [];
    const unsubscribe = onCalendarChanged((kind) => seen.push(kind));

    notifyCalendarChanged('created');
    unsubscribe();
    notifyCalendarChanged('deleted');

    expect(seen).toEqual(['created']);
  });

  it('survives a listener that throws', () => {
    // One screen failing to refresh must not break the write that caused it.
    const seen: CalendarChangeKind[] = [];
    onCalendarChanged(() => {
      throw new Error('listener exploded');
    });
    onCalendarChanged((kind) => seen.push(kind));

    expect(() => notifyCalendarChanged('created')).not.toThrow();
    expect(seen).toEqual(['created']);
  });

  it('tolerates a listener unsubscribing while being notified', () => {
    const seen: CalendarChangeKind[] = [];
    const unsubscribe = onCalendarChanged(() => unsubscribe());
    onCalendarChanged((kind) => seen.push(kind));

    expect(() => notifyCalendarChanged('updated')).not.toThrow();
    expect(seen).toEqual(['updated']);
  });
});
