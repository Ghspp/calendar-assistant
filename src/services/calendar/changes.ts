/**
 * A notification that the calendar has changed.
 *
 * The assistant and the visual calendar hold separate copies of the same data. Without
 * this, creating an event by voice leaves the calendar tab showing a stale day until
 * something incidental happens to reload it.
 *
 * The emitter is wired in by wrapping a provider rather than by calling it from each
 * screen, so a new write path cannot forget to announce itself.
 */

import type {
  CalendarProvider,
  CreateEventOptions,
  CreatedEvent,
  EventChanges,
} from './CalendarProvider';
import type { StructuredEvent } from '../../types/calendar';

export type CalendarChangeKind = 'created' | 'updated' | 'deleted';

type Listener = (kind: CalendarChangeKind) => void;

const listeners = new Set<Listener>();

/** Subscribe to writes. Returns an unsubscribe function. */
export function onCalendarChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyCalendarChanged(kind: CalendarChangeKind): void {
  // Copied first: a listener may unsubscribe while being notified.
  for (const listener of [...listeners]) {
    try {
      listener(kind);
    } catch {
      // One bad listener must not stop the others, nor fail the write that caused it.
    }
  }
}

/**
 * Wrap a provider so every successful write announces itself.
 *
 * Reads pass through untouched. A failed write announces nothing, because nothing
 * changed — a reload on failure would only hide the error behind a refresh.
 */
export function withChangeNotifications(provider: CalendarProvider): CalendarProvider {
  return {
    listEvents: (query) => provider.listEvents(query),
    listEventsForDate: (date) => provider.listEventsForDate(date),

    async createEvent(
      event: StructuredEvent,
      options?: CreateEventOptions,
    ): Promise<CreatedEvent> {
      const created = await provider.createEvent(event, options);
      notifyCalendarChanged('created');
      return created;
    },

    async updateEvent(eventId: string, changes: EventChanges): Promise<CreatedEvent> {
      const updated = await provider.updateEvent(eventId, changes);
      notifyCalendarChanged('updated');
      return updated;
    },

    async deleteEvent(eventId: string): Promise<void> {
      await provider.deleteEvent(eventId);
      notifyCalendarChanged('deleted');
    },
  };
}

/** Test seam: drop every subscription. */
export function resetCalendarChangeListeners(): void {
  listeners.clear();
}
