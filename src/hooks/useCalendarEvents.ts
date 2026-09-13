import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAuthState,
  requestAccessToken,
  signOut,
  subscribeToAuthState,
  type AuthState,
} from '../services/calendar/auth';
import { createGoogleCalendarProvider } from '../services/calendar/GoogleCalendarProvider';
import { executeCommand } from '../services/assistant/handleCommand';
import { confirmDelete } from '../services/assistant/deletes';
import { CalendarError } from '../services/calendar/errors';
import { APP_TIME_ZONE, systemClock } from '../utils/clock';
import { addDaysToDateString, dayBoundsInZone } from '../utils/time';
import type { CalendarEvent, TimedCalendarEvent } from '../types/calendar';
import type { CommandOutcome } from '../services/assistant/types';

/**
 * Events for the visual calendar, plus the manual create and delete it needs.
 *
 * Manual actions deliberately go through `executeCommand` — the same path a spoken
 * command takes — so a tapped event is validated and conflict-checked by exactly the
 * same rules. There is no second, looser route to the calendar for the UI.
 */

export type CalendarRange = 'day' | 'week';

export interface UseCalendarEventsResult {
  authState: AuthState;
  events: CalendarEvent[];
  loading: boolean;
  error?: string;
  reload: () => Promise<void>;
  connect: () => Promise<void>;
  createEvent: (input: {
    title: string;
    date: string;
    startTime: string;
    durationMinutes: number;
  }) => Promise<CommandOutcome>;
  deleteEvent: (event: TimedCalendarEvent) => Promise<CommandOutcome>;
}

export function useCalendarEvents(
  anchorDate: string,
  range: CalendarRange,
): UseCalendarEventsResult {
  const [authState, setAuthState] = useState<AuthState>(() => getAuthState());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const sequence = useRef(0);

  useEffect(() => subscribeToAuthState(() => setAuthState(getAuthState())), []);

  const provider = useMemo(
    () =>
      createGoogleCalendarProvider({
        getAccessToken: requestAccessToken,
        onAuthExpired: signOut,
      }),
    [],
  );

  const reload = useCallback(async () => {
    if (getAuthState() !== 'signed-in') {
      setEvents([]);
      return;
    }

    const current = sequence.current + 1;
    sequence.current = current;
    setLoading(true);
    setError(undefined);

    try {
      const lastDate = range === 'week' ? (addDaysToDateString(anchorDate, 6) ?? anchorDate) : anchorDate;
      const from = dayBoundsInZone(anchorDate, APP_TIME_ZONE);
      const to = dayBoundsInZone(lastDate, APP_TIME_ZONE);
      if (from === undefined || to === undefined) return;

      const loaded = await provider.listEvents({ timeMin: from.start, timeMax: to.end });
      if (sequence.current !== current) return;
      setEvents(loaded);
    } catch (failure) {
      if (sequence.current !== current) return;
      setError(
        failure instanceof CalendarError ? failure.hebrewMessage : 'לא ניתן לטעון את היומן.',
      );
      setEvents([]);
    } finally {
      if (sequence.current === current) setLoading(false);
    }
  }, [anchorDate, provider, range]);

  useEffect(() => {
    void reload();
  }, [reload, authState]);

  const connect = useCallback(async () => {
    try {
      await requestAccessToken({ interactive: true });
    } catch {
      setError('ההתחברות ל-Google לא הושלמה.');
    }
  }, []);

  const createEvent = useCallback<UseCalendarEventsResult['createEvent']>(
    async (input) => {
      // Built as an ordinary command so validation and conflict detection apply
      // unchanged — a tap must not be able to book something speech could not.
      const outcome = await executeCommand(
        {
          intent: 'CREATE',
          title: input.title,
          date: input.date,
          startTime: input.startTime,
          durationMinutes: input.durationMinutes,
          missing: [],
          ambiguities: [],
          confidence: 1,
          rawText: input.title,
          normalizedText: input.title,
        },
        { provider, clock: systemClock },
      );

      if (outcome.kind === 'created') await reload();
      return outcome;
    },
    [provider, reload],
  );

  const removeEvent = useCallback<UseCalendarEventsResult['deleteEvent']>(
    async (event) => {
      // The event was tapped, so which one is meant is not in question. The
      // confirmation still happens — in the sheet, before this is called.
      try {
        const outcome = await confirmDelete(event, { provider, clock: systemClock });
        await reload();
        return outcome;
      } catch (failure) {
        return {
          kind: 'failed',
          errorKind: failure instanceof CalendarError ? failure.kind : 'unknown',
          message:
            failure instanceof CalendarError ? failure.hebrewMessage : 'המחיקה נכשלה.',
        };
      }
    },
    [provider, reload],
  );

  return {
    authState,
    events,
    loading,
    ...(error !== undefined ? { error } : {}),
    reload,
    connect,
    createEvent,
    deleteEvent: removeEvent,
  };
}
