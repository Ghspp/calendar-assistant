import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthError,
  getAuthState,
  isConfigured,
  requestAccessToken,
  signOut,
  subscribeToAuthState,
  type AuthState,
} from '../services/calendar/auth';
import { createGoogleCalendarProvider } from '../services/calendar/GoogleCalendarProvider';
import { CalendarError, calendarError } from '../services/calendar/errors';
import type { CalendarEvent } from '../types/calendar';

/**
 * Google Calendar connection state for the UI.
 *
 * READ-ONLY. Exposes no way to write to the calendar, because Stage 3 does not request
 * a write scope.
 */

export type CalendarStatus = 'unconfigured' | 'disconnected' | 'connecting' | 'connected';

export interface UseGoogleCalendarResult {
  status: CalendarStatus;
  authState: AuthState;
  events: CalendarEvent[];
  /** True while a list request is in flight. */
  loading: boolean;
  /** Hebrew message for whatever went wrong, or undefined. */
  error?: string;
  errorKind?: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  loadRange: (timeMin: Date, timeMax: Date) => Promise<void>;
  loadDate: (date: string) => Promise<void>;
}

function describe(error: unknown): { message: string; kind: string } {
  if (error instanceof CalendarError) {
    return { message: error.hebrewMessage, kind: error.kind };
  }
  if (error instanceof GoogleAuthError) {
    return { message: error.hebrewMessage, kind: error.kind };
  }
  return { message: calendarError('unknown').hebrewMessage, kind: 'unknown' };
}

export function useGoogleCalendar(): UseGoogleCalendarResult {
  const [authState, setAuthState] = useState<AuthState>(() => getAuthState());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; kind: string } | undefined>();

  // Guards against a slow response overwriting a newer one.
  const requestSequence = useRef(0);

  useEffect(() => subscribeToAuthState(() => setAuthState(getAuthState())), []);

  const provider = useMemo(
    () =>
      createGoogleCalendarProvider({
        getAccessToken: requestAccessToken,
        onAuthExpired: signOut,
      }),
    [],
  );

  const connect = useCallback(async () => {
    setFailure(undefined);
    setConnecting(true);
    try {
      // Interactive: this runs from a click, so a popup is allowed.
      await requestAccessToken({ interactive: true });
    } catch (error) {
      setFailure(describe(error));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    signOut();
    setEvents([]);
    setFailure(undefined);
  }, []);

  const runQuery = useCallback(
    async (query: () => Promise<CalendarEvent[]>) => {
      if (!isConfigured()) {
        setFailure(describe(calendarError('not-configured')));
        return;
      }

      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;

      setLoading(true);
      setFailure(undefined);

      try {
        const result = await query();
        if (requestSequence.current !== sequence) return;
        setEvents(result);
      } catch (error) {
        if (requestSequence.current !== sequence) return;
        setFailure(describe(error));
        setEvents([]);
      } finally {
        if (requestSequence.current === sequence) setLoading(false);
      }
    },
    [],
  );

  const loadRange = useCallback(
    (timeMin: Date, timeMax: Date) => runQuery(() => provider.listEvents({ timeMin, timeMax })),
    [provider, runQuery],
  );

  const loadDate = useCallback(
    (date: string) => runQuery(() => provider.listEventsForDate(date)),
    [provider, runQuery],
  );

  const status: CalendarStatus =
    authState === 'unconfigured'
      ? 'unconfigured'
      : connecting
        ? 'connecting'
        : authState === 'signed-in'
          ? 'connected'
          : 'disconnected';

  return {
    status,
    authState,
    events,
    loading,
    ...(failure !== undefined ? { error: failure.message, errorKind: failure.kind } : {}),
    connect,
    disconnect,
    loadRange,
    loadDate,
  };
}
