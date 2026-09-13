/**
 * Speech recognition via the browser's Web Speech API.
 *
 * Free, unlimited, and good at Hebrew on Android Chrome — which is the target device.
 * Firefox has no implementation at all; desktop Safari and iOS are partial. The
 * provider reports that honestly through `isSupported` so the UI can fall back to the
 * text input rather than presenting a dead button.
 *
 * The recognition constructor is injected, so the whole provider is testable in Node
 * with no browser and no microphone.
 */

import {
  HEBREW_LANG,
  speechError,
  type SpeechHandlers,
  type SpeechProvider,
  type SpeechSession,
  type SpeechStartOptions,
} from './types';

/* ------------------------------------------------------------------ *
 * Minimal Web Speech typings.
 *
 * Declared locally rather than relying on lib.dom, whose coverage of this API varies
 * by TypeScript version and which has never included the webkit-prefixed name.
 * ------------------------------------------------------------------ */

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** Map the API's error strings onto our taxonomy. */
function mapErrorCode(code: string) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission-denied' as const;
    case 'no-speech':
      return 'no-speech' as const;
    case 'audio-capture':
      return 'audio-capture' as const;
    case 'network':
      return 'network' as const;
    case 'aborted':
      return 'aborted' as const;
    default:
      return 'unknown' as const;
  }
}

/** Find the constructor under either its standard or webkit-prefixed name. */
export function findRecognitionConstructor(
  scope: unknown = globalThis,
): SpeechRecognitionConstructor | undefined {
  if (typeof scope !== 'object' || scope === null) return undefined;
  const holder = scope as Record<string, unknown>;
  const candidate = holder['SpeechRecognition'] ?? holder['webkitSpeechRecognition'];
  return typeof candidate === 'function'
    ? (candidate as SpeechRecognitionConstructor)
    : undefined;
}

export interface WebSpeechProviderOptions {
  recognitionCtor?: SpeechRecognitionConstructor | undefined;
  /** Defaults to the real value. Injected so the check is testable. */
  isSecureContext?: boolean;
}

export function createWebSpeechProvider(
  options: WebSpeechProviderOptions = {},
): SpeechProvider {
  const ctor = options.recognitionCtor ?? findRecognitionConstructor();
  const secure =
    options.isSecureContext ??
    (typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : true);

  // Report the more actionable problem first: telling someone on Firefox to use HTTPS
  // would send them chasing the wrong thing.
  const unsupportedReason =
    ctor === undefined
      ? speechError('unsupported')
      : !secure
        ? speechError('insecure-context')
        : undefined;

  const isSupported = unsupportedReason === undefined;

  function start(handlers: SpeechHandlers, startOptions?: SpeechStartOptions): SpeechSession {
    if (ctor === undefined || unsupportedReason !== undefined) {
      handlers.onError(unsupportedReason ?? speechError('unsupported'));
      handlers.onEnd();
      return { stop: () => undefined, abort: () => undefined };
    }

    const recognition = new ctor();
    recognition.lang = startOptions?.lang ?? HEBREW_LANG;
    // One utterance per tap. Continuous mode on Android keeps the mic open and drains
    // the battery, and this assistant is tap-to-talk by design.
    recognition.continuous = false;
    // Interim results drive the live transcript, so the user sees it is working.
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    /** Guards against onend firing after an error has already been reported. */
    let finished = false;

    recognition.onstart = () => handlers.onStart?.();

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result === undefined) continue;

        const alternative = result[0];
        if (alternative === undefined) continue;

        handlers.onResult({
          transcript: alternative.transcript,
          isFinal: result.isFinal,
          ...(typeof alternative.confidence === 'number'
            ? { confidence: alternative.confidence }
            : {}),
        });
      }
    };

    recognition.onerror = (event) => {
      if (finished) return;
      finished = true;
      handlers.onError(speechError(mapErrorCode(event.error)));
    };

    recognition.onend = () => {
      if (finished) {
        handlers.onEnd();
        return;
      }
      finished = true;
      handlers.onEnd();
    };

    try {
      recognition.start();
    } catch (error) {
      // start() throws if called while already listening.
      finished = true;
      handlers.onError(speechError('unknown'));
      handlers.onEnd();
      void error;
    }

    return {
      stop: () => recognition.stop(),
      abort: () => recognition.abort(),
    };
  }

  return {
    isSupported,
    ...(unsupportedReason !== undefined ? { unsupportedReason } : {}),
    start,
  };
}
