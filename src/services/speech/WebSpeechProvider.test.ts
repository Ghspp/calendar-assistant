import { describe, expect, it, vi } from 'vitest';
import {
  createWebSpeechProvider,
  findRecognitionConstructor,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
} from './WebSpeechProvider';
import type { SpeechError, SpeechResult } from './types';

/**
 * A stand-in for the browser's SpeechRecognition, driven by hand from the tests.
 * Nothing here touches a microphone or a network.
 */
class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | undefined;

  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;

  onstart: (() => void) | null = null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;

  started = 0;
  stopped = 0;
  aborted = 0;
  /** Set to make start() throw, as the real API does when already listening. */
  throwOnStart = false;

  constructor() {
    FakeRecognition.last = this;
  }

  start(): void {
    if (this.throwOnStart) throw new Error('already started');
    this.started += 1;
    this.onstart?.();
  }

  stop(): void {
    this.stopped += 1;
  }

  abort(): void {
    this.aborted += 1;
  }

  /* -------- test drivers -------- */

  emitResult(transcript: string, isFinal: boolean, confidence = 0.9): void {
    this.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: { length: 1, isFinal, 0: { transcript, confidence } },
      },
    });
  }

  emitError(code: string): void {
    this.onerror?.({ error: code });
  }

  emitEnd(): void {
    this.onend?.();
  }
}

function harness(overrides: { isSecureContext?: boolean } = {}) {
  const results: SpeechResult[] = [];
  const errors: SpeechError[] = [];
  const ends: number[] = [];
  const starts: number[] = [];

  const provider = createWebSpeechProvider({
    recognitionCtor: FakeRecognition,
    isSecureContext: overrides.isSecureContext ?? true,
  });

  const session = provider.start({
    onResult: (result) => results.push(result),
    onError: (error) => errors.push(error),
    onEnd: () => ends.push(1),
    onStart: () => starts.push(1),
  });

  return { provider, session, results, errors, ends, starts, recognition: FakeRecognition.last };
}

describe('support detection', () => {
  it('is supported when a constructor exists in a secure context', () => {
    const provider = createWebSpeechProvider({
      recognitionCtor: FakeRecognition,
      isSecureContext: true,
    });
    expect(provider.isSupported).toBe(true);
    expect(provider.unsupportedReason).toBeUndefined();
  });

  it('is unsupported when the browser has no implementation', () => {
    const provider = createWebSpeechProvider({
      recognitionCtor: undefined,
      isSecureContext: true,
    });
    expect(provider.isSupported).toBe(false);
    expect(provider.unsupportedReason?.kind).toBe('unsupported');
    expect(provider.unsupportedReason?.message).toContain('לא תומך בזיהוי דיבור');
  });

  it('reports an insecure context', () => {
    const provider = createWebSpeechProvider({
      recognitionCtor: FakeRecognition,
      isSecureContext: false,
    });
    expect(provider.isSupported).toBe(false);
    expect(provider.unsupportedReason?.kind).toBe('insecure-context');
  });

  it('reports the missing API rather than HTTPS when both are wrong', () => {
    // Telling a Firefox user to switch to HTTPS would send them chasing the wrong thing.
    const provider = createWebSpeechProvider({
      recognitionCtor: undefined,
      isSecureContext: false,
    });
    expect(provider.unsupportedReason?.kind).toBe('unsupported');
  });

  it('finds the webkit-prefixed constructor', () => {
    expect(findRecognitionConstructor({ webkitSpeechRecognition: FakeRecognition })).toBe(
      FakeRecognition,
    );
  });

  it('prefers the unprefixed constructor', () => {
    class Other {}
    expect(
      findRecognitionConstructor({
        SpeechRecognition: FakeRecognition,
        webkitSpeechRecognition: Other,
      }),
    ).toBe(FakeRecognition);
  });

  it('returns undefined when neither name exists', () => {
    expect(findRecognitionConstructor({})).toBeUndefined();
    expect(findRecognitionConstructor(null)).toBeUndefined();
  });
});

describe('configuration', () => {
  it('asks for Hebrew by default', () => {
    const { recognition } = harness();
    expect(recognition?.lang).toBe('he-IL');
  });

  it('honours an explicit language', () => {
    const provider = createWebSpeechProvider({
      recognitionCtor: FakeRecognition,
      isSecureContext: true,
    });
    provider.start(
      { onResult: vi.fn(), onError: vi.fn(), onEnd: vi.fn() },
      { lang: 'en-US' },
    );
    expect(FakeRecognition.last?.lang).toBe('en-US');
  });

  it('listens for a single utterance rather than continuously', () => {
    // Continuous mode keeps the microphone open and drains an Android battery.
    const { recognition } = harness();
    expect(recognition?.continuous).toBe(false);
  });

  it('enables interim results so the user sees live feedback', () => {
    const { recognition } = harness();
    expect(recognition?.interimResults).toBe(true);
  });

  it('starts listening immediately', () => {
    const { recognition, starts } = harness();
    expect(recognition?.started).toBe(1);
    expect(starts).toHaveLength(1);
  });
});

describe('results', () => {
  it('reports an interim result as not final', () => {
    const { recognition, results } = harness();
    recognition?.emitResult('תקבע לי פגישה', false);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ transcript: 'תקבע לי פגישה', isFinal: false });
  });

  it('reports a final result', () => {
    const { recognition, results } = harness();
    recognition?.emitResult('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה', true);

    expect(results[0]?.isFinal).toBe(true);
    expect(results[0]?.transcript).toBe('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');
  });

  it('passes the confidence through', () => {
    const { recognition, results } = harness();
    recognition?.emitResult('שלום', true, 0.82);
    expect(results[0]?.confidence).toBeCloseTo(0.82);
  });

  it('delivers a sequence of interim results ending in a final one', () => {
    const { recognition, results } = harness();
    recognition?.emitResult('תקבע', false);
    recognition?.emitResult('תקבע לי', false);
    recognition?.emitResult('תקבע לי פגישה', true);

    expect(results.map((result) => result.isFinal)).toEqual([false, false, true]);
  });
});

describe('errors', () => {
  it.each([
    ['not-allowed', 'permission-denied'],
    ['service-not-allowed', 'permission-denied'],
    ['no-speech', 'no-speech'],
    ['audio-capture', 'audio-capture'],
    ['network', 'network'],
    ['aborted', 'aborted'],
    ['something-new', 'unknown'],
  ])('maps %s to %s', (code, expected) => {
    const { recognition, errors } = harness();
    recognition?.emitError(code);
    expect(errors[0]?.kind).toBe(expected);
  });

  it('carries a Hebrew message', () => {
    const { recognition, errors } = harness();
    recognition?.emitError('not-allowed');
    expect(errors[0]?.message).toBe('אין גישה למיקרופון. יש לאשר את ההרשאה בהגדרות הדפדפן.');
  });

  it('reports an error only once even if end follows', () => {
    const { recognition, errors, ends } = harness();
    recognition?.emitError('network');
    recognition?.emitEnd();

    expect(errors).toHaveLength(1);
    expect(ends).toHaveLength(1);
  });

  it('always calls onEnd, whether or not there was an error', () => {
    const { recognition, ends } = harness();
    recognition?.emitEnd();
    expect(ends).toHaveLength(1);
  });

  it('fails gracefully when start throws', () => {
    const provider = createWebSpeechProvider({
      recognitionCtor: class extends FakeRecognition {
        override start(): void {
          throw new Error('already started');
        }
      },
      isSecureContext: true,
    });

    const errors: SpeechError[] = [];
    const ends: number[] = [];
    expect(() =>
      provider.start({
        onResult: vi.fn(),
        onError: (error) => errors.push(error),
        onEnd: () => ends.push(1),
      }),
    ).not.toThrow();

    expect(errors[0]?.kind).toBe('unknown');
    expect(ends).toHaveLength(1);
  });
});

describe('starting on an unsupported browser', () => {
  it('reports the reason and ends, rather than throwing', () => {
    const provider = createWebSpeechProvider({
      recognitionCtor: undefined,
      isSecureContext: true,
    });

    const errors: SpeechError[] = [];
    const ends: number[] = [];
    const session = provider.start({
      onResult: vi.fn(),
      onError: (error) => errors.push(error),
      onEnd: () => ends.push(1),
    });

    expect(errors[0]?.kind).toBe('unsupported');
    expect(ends).toHaveLength(1);
    // The returned session must still be safe to call.
    expect(() => {
      session.stop();
      session.abort();
    }).not.toThrow();
  });
});

describe('session control', () => {
  it('stop keeps what was heard', () => {
    const { session, recognition } = harness();
    session.stop();
    expect(recognition?.stopped).toBe(1);
    expect(recognition?.aborted).toBe(0);
  });

  it('abort discards it', () => {
    const { session, recognition } = harness();
    session.abort();
    expect(recognition?.aborted).toBe(1);
  });
});
