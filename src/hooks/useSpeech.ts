import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWebSpeechProvider } from '../services/speech/WebSpeechProvider';
import type { SpeechError, SpeechSession } from '../services/speech/types';

/**
 * Microphone state for the UI.
 *
 * A final transcript is delivered through the `onFinal` callback rather than left in
 * state, because the caller needs to act on it exactly once — re-rendering with a
 * transcript sitting in state invites sending the same command twice.
 */

export type ListeningState = 'idle' | 'listening' | 'unsupported';

export interface UseSpeechOptions {
  onFinal: (transcript: string) => void;
}

export interface UseSpeechResult {
  state: ListeningState;
  isSupported: boolean;
  /** Live partial text while speaking. Cleared when the session ends. */
  interim: string;
  error?: SpeechError;
  start: () => void;
  stop: () => void;
  clearError: () => void;
}

export function useSpeech({ onFinal }: UseSpeechOptions): UseSpeechResult {
  const provider = useMemo(() => createWebSpeechProvider(), []);

  const [state, setState] = useState<ListeningState>(() =>
    provider.isSupported ? 'idle' : 'unsupported',
  );
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<SpeechError | undefined>(
    () => provider.unsupportedReason,
  );

  const session = useRef<SpeechSession | undefined>(undefined);
  /** Keeps the latest callback without restarting a live session. */
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  // Abort a live session if the component goes away mid-listen.
  useEffect(
    () => () => {
      session.current?.abort();
      session.current = undefined;
    },
    [],
  );

  const start = useCallback(() => {
    if (!provider.isSupported) return;
    if (session.current !== undefined) return;

    setError(undefined);
    setInterim('');

    session.current = provider.start({
      onStart: () => setState('listening'),

      onResult: (result) => {
        if (result.isFinal) {
          setInterim('');
          // Fire before onEnd so the UI never shows an empty idle state in between.
          onFinalRef.current(result.transcript);
          return;
        }
        setInterim(result.transcript);
      },

      onError: (speechFailure) => {
        // Stopping on purpose is not worth an error message.
        if (speechFailure.kind !== 'aborted') setError(speechFailure);
      },

      onEnd: () => {
        session.current = undefined;
        setInterim('');
        setState(provider.isSupported ? 'idle' : 'unsupported');
      },
    });
  }, [provider]);

  const stop = useCallback(() => {
    session.current?.stop();
  }, []);

  return {
    state,
    isSupported: provider.isSupported,
    interim,
    ...(error !== undefined ? { error } : {}),
    start,
    stop,
    clearError: useCallback(() => setError(undefined), []),
  };
}
