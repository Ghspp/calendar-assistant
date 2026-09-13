/**
 * Text to speech, so the assistant answers out loud.
 *
 * Uses the browser's built-in speechSynthesis — free, offline on most devices, and
 * Android ships a Hebrew voice. The synthesiser is injected so this is testable
 * without a browser.
 *
 * Mobile browsers make this much harder than it looks, and three separate quirks all
 * have to be handled or the replies are simply silent with no error at all:
 *
 *   1. Speech must be UNLOCKED from a real user gesture before any later, asynchronous
 *      utterance is allowed through. See `prime`.
 *   2. Calling cancel() immediately before speak() kills the NEW utterance too on
 *      Android Chrome. So cancel only when something is actually speaking, and let the
 *      queue settle before starting the next one.
 *   3. Speaking the instant speech RECOGNITION ends fails while the audio session is
 *      still held, so callers pass a small delay after listening.
 */

import { HEBREW_LANG } from './types';

interface SpeechSynthesisVoiceLike {
  lang: string;
  name: string;
  default?: boolean;
}

interface SpeechSynthesisUtteranceLike {
  text: string;
  lang: string;
  voice: SpeechSynthesisVoiceLike | null;
  rate: number;
  pitch: number;
  volume: number;
  onend: (() => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
}

export interface SpeechSynthesisLike {
  speak: (utterance: SpeechSynthesisUtteranceLike) => void;
  cancel: () => void;
  getVoices: () => SpeechSynthesisVoiceLike[];
  addEventListener?: (type: string, listener: () => void) => void;
  /** True while an utterance is in progress. Absent on some older engines. */
  speaking?: boolean;
}

export type UtteranceConstructor = new (text: string) => SpeechSynthesisUtteranceLike;

/** What the last attempt to speak actually did. Surfaced so silence is explainable. */
export type TtsState =
  | 'idle'
  | 'primed'
  | 'speaking'
  | 'spoke'
  | 'no-voice'
  | 'error'
  | 'unsupported';

export interface TtsStatus {
  state: TtsState;
  /** Number of voices the engine reported, useful when nothing is installed. */
  voiceCount: number;
  /** True when a voice matching the requested language exists. */
  hasLanguageVoice: boolean;
  /** Language tags the engine actually offers, for diagnosing a bad match. */
  languages: string[];
  detail?: string;
}

export interface TtsService {
  readonly isSupported: boolean;
  speak: (text: string, options?: { lang?: string; delayMs?: number }) => void;
  cancel: () => void;
  /**
   * Unlock the synthesiser. MUST be called synchronously inside a user gesture.
   *
   * Mobile browsers refuse to speak unless the page has already spoken once from a
   * real tap. Replies arrive after an await, far from the tap that caused them, so
   * without this they are dropped in silence.
   */
  prime: () => void;
  /** What happened on the last attempt, for showing the user why it is quiet. */
  getStatus: () => TtsStatus;
}

export interface TtsOptions {
  synth?: SpeechSynthesisLike | undefined;
  utteranceCtor?: UtteranceConstructor | undefined;
  /** Injected so tests need no timers. Defaults to setTimeout. */
  schedule?: (run: () => void, delayMs: number) => void;
}

/** How long to let a cancelled queue drain before starting the next utterance. */
const CANCEL_SETTLE_MS = 150;

function findSynth(): SpeechSynthesisLike | undefined {
  const candidate = (globalThis as Record<string, unknown>)['speechSynthesis'];
  return typeof candidate === 'object' && candidate !== null
    ? (candidate as SpeechSynthesisLike)
    : undefined;
}

function findUtteranceCtor(): UtteranceConstructor | undefined {
  const candidate = (globalThis as Record<string, unknown>)['SpeechSynthesisUtterance'];
  return typeof candidate === 'function' ? (candidate as UtteranceConstructor) : undefined;
}

/**
 * Language codes that mean the same language.
 *
 * Hebrew's ISO code changed from 'iw' to 'he' decades ago, but plenty of Android TTS
 * engines still report their Hebrew voice as 'iw-IL'. Looking only for 'he' therefore
 * misses a Hebrew voice that is installed and working.
 */
const LANGUAGE_ALIASES: Record<string, readonly string[]> = {
  he: ['he', 'iw'],
  iw: ['he', 'iw'],
};

function baseOf(lang: string): string {
  return (lang.split('-')[0] ?? lang).toLowerCase();
}

/** The best voice for a language, or undefined to let the platform choose. */
export function selectVoice(
  voices: readonly SpeechSynthesisVoiceLike[],
  lang: string,
): SpeechSynthesisVoiceLike | undefined {
  const exact = voices.find((voice) => voice.lang === lang);
  if (exact !== undefined) return exact;

  const wanted = LANGUAGE_ALIASES[baseOf(lang)] ?? [baseOf(lang)];
  return voices.find((voice) => wanted.includes(baseOf(voice.lang)));
}

export function createTtsService(options: TtsOptions = {}): TtsService {
  const synth = options.synth ?? findSynth();
  const utteranceCtor = options.utteranceCtor ?? findUtteranceCtor();
  const isSupported = synth !== undefined && utteranceCtor !== undefined;
  const schedule =
    options.schedule ??
    ((run: () => void, delayMs: number) => {
      globalThis.setTimeout(run, delayMs);
    });

  let primed = false;
  let status: TtsStatus = {
    state: isSupported ? 'idle' : 'unsupported',
    voiceCount: 0,
    hasLanguageVoice: false,
    languages: [],
  };

  // Voices arrive asynchronously on most platforms. Asking once at startup usually
  // returns an empty list, so re-read them when the browser says they are ready.
  let voices: SpeechSynthesisVoiceLike[] = [];
  const refreshVoices = (): void => {
    try {
      voices = synth?.getVoices() ?? [];
    } catch {
      voices = [];
    }
  };
  refreshVoices();

  function setStatus(state: TtsState, detail?: string): void {
    status = {
      state,
      voiceCount: voices.length,
      hasLanguageVoice: selectVoice(voices, HEBREW_LANG) !== undefined,
      languages: [...new Set(voices.map((voice) => voice.lang))].sort(),
      ...(detail !== undefined ? { detail } : {}),
    };
  }

  synth?.addEventListener?.('voiceschanged', () => {
    refreshVoices();
    setStatus(status.state);
  });

  function build(text: string, lang: string, volume: number): SpeechSynthesisUtteranceLike {
    if (utteranceCtor === undefined) throw new Error('no utterance constructor');

    const utterance = new utteranceCtor(text);
    utterance.lang = lang;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = volume;

    if (voices.length === 0) refreshVoices();
    utterance.voice = selectVoice(voices, lang) ?? null;

    return utterance;
  }

  function prime(): void {
    if (primed || synth === undefined || utteranceCtor === undefined) return;

    try {
      // A single space at zero volume: inaudible, but it counts as speech and unlocks
      // the engine for the asynchronous replies that follow.
      synth.speak(build(' ', HEBREW_LANG, 0));
      primed = true;
      setStatus('primed');
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error));
    }
  }

  function speak(text: string, speakOptions?: { lang?: string; delayMs?: number }): void {
    if (synth === undefined || utteranceCtor === undefined) {
      setStatus('unsupported');
      return;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const lang = speakOptions?.lang ?? HEBREW_LANG;
    if (voices.length === 0) refreshVoices();

    let utterance: SpeechSynthesisUtteranceLike;
    try {
      utterance = build(trimmed, lang, 1);
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error));
      return;
    }

    utterance.onend = () => setStatus('spoke');
    utterance.onerror = (event) => setStatus('error', event?.error ?? 'speech failed');

    const start = (): void => {
      try {
        synth.speak(utterance);
        setStatus('speaking');
      } catch (error) {
        setStatus('error', error instanceof Error ? error.message : String(error));
      }
    };

    // Quirk 2: cancelling immediately before speaking discards the new utterance on
    // Android. Only cancel when something really is speaking, and let it settle.
    const busy = synth.speaking === true;
    if (busy) {
      try {
        synth.cancel();
      } catch {
        // Some engines throw when nothing is queued. Harmless.
      }
    }

    const delay = speakOptions?.delayMs ?? (busy ? CANCEL_SETTLE_MS : 0);
    if (delay > 0) schedule(start, delay);
    else start();
  }

  function cancel(): void {
    try {
      synth?.cancel();
    } catch {
      // As above.
    }
  }

  return { isSupported, speak, cancel, prime, getStatus: () => status };
}
