import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthError,
  getAuthState,
  requestAccessToken,
  revokeAccess,
  signOut,
  subscribeToAuthState,
  type AuthState,
} from '../services/calendar/auth';
import { createGoogleCalendarProvider } from '../services/calendar/GoogleCalendarProvider';
import { handleTurn } from '../services/assistant/handleTurn';
import { respond } from '../services/assistant/responder';
import { systemClock } from '../utils/clock';
import { emptyConversation, type ConversationState } from '../services/conversation/ConversationManager';
import type { CommandOutcome } from '../services/assistant/types';

/**
 * Drives the text-command assistant.
 *
 * Stage 5 adds speech on top of this by feeding a transcript into `send` — the hook
 * itself does not care where the text came from.
 */

export type AssistantConnection = 'unconfigured' | 'disconnected' | 'connecting' | 'connected';

export interface AssistantMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Set on a success, so the user can jump to the event in Google Calendar. */
  link?: string;
  /** Outcome kind, used to colour the bubble. */
  outcome?: CommandOutcome['kind'];
}

export interface UseAssistantResult {
  connection: AssistantConnection;
  authState: AuthState;
  messages: AssistantMessage[];
  sending: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  forgetPermission: () => void;
  send: (text: string) => Promise<void>;
  clear: () => void;
}

export function useAssistant(): UseAssistantResult {
  const [authState, setAuthState] = useState<AuthState>(() => getAuthState());
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const nextId = useRef(1);
  /** Ref rather than state: the guard must be correct within a single tick. */
  const inFlight = useRef(false);
  /**
   * Short-term conversation memory, carried from turn to turn.
   *
   * A ref, not state: it must be read at the moment a turn starts, not at the render
   * that scheduled it, or two quick answers would both see the same stale pending
   * request.
   */
  const conversation = useRef<ConversationState>(emptyConversation);

  useEffect(() => subscribeToAuthState(() => setAuthState(getAuthState())), []);

  const provider = useMemo(
    () =>
      createGoogleCalendarProvider({
        getAccessToken: requestAccessToken,
        onAuthExpired: signOut,
      }),
    [],
  );

  const append = useCallback((message: Omit<AssistantMessage, 'id'>) => {
    setMessages((current) => [...current, { ...message, id: nextId.current++ }]);
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      await requestAccessToken({ interactive: true });
    } catch (error) {
      append({
        role: 'assistant',
        text:
          error instanceof GoogleAuthError
            ? error.hebrewMessage
            : 'ההתחברות ל-Google לא הושלמה.',
        outcome: 'failed',
      });
    } finally {
      setConnecting(false);
    }
  }, [append]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      // Guards against a double submit creating the event twice. A duplicate would
      // not be caught by conflict detection, since an exact duplicate of an event
      // created moments ago is exactly what the second request would look like.
      if (inFlight.current) return;
      inFlight.current = true;

      append({ role: 'user', text: trimmed });
      setSending(true);

      try {
        const { outcome, state } = await handleTurn(trimmed, {
          provider,
          clock: systemClock,
          state: conversation.current,
        });
        conversation.current = state;

        append({
          role: 'assistant',
          text: respond(outcome, systemClock),
          outcome: outcome.kind,
          ...(outcome.kind === 'created' && outcome.created.htmlLink !== undefined
            ? { link: outcome.created.htmlLink }
            : {}),
        });
      } finally {
        setSending(false);
        inFlight.current = false;
      }
    },
    [append, provider],
  );

  const connection: AssistantConnection =
    authState === 'unconfigured'
      ? 'unconfigured'
      : connecting
        ? 'connecting'
        : authState === 'signed-in'
          ? 'connected'
          : 'disconnected';

  return {
    connection,
    authState,
    messages,
    sending,
    connect,
    disconnect: signOut,
    forgetPermission: revokeAccess,
    send,
    clear: useCallback(() => {
      setMessages([]);
      // Clearing the visible log must clear the invisible state too, or the next
      // utterance would be folded into a request the user can no longer see.
      conversation.current = emptyConversation;
    }, []),
  };
}
