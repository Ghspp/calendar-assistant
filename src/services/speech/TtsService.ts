/**
 * Text to speech, so the assistant answers out loud.
 *
 * Uses the browser's built-in speechSynthesis — free, offline on most devices, and
 * Android ships a Hebrew voice. The synthesiser is injected so this is testable
 * without a browser.
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
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SpeechSynthesisLike {
  speak: (utterance: SpeechSynthesisUtteranceLike) => void;
  cancel: () => void;
  getVoices: () => SpeechSynthesisVoiceLike[];
  addEventListener?: (type: string, listener: () => void) => void;
}

export type UtteranceConstructor = new (text: string) => SpeechSynthesisUtteranceLike;

export interface TtsService {
  readonly isSupported: boolean;
  speak: (text: string, options?: { lang?: string }) => void;
  cancel: () => void;
}

export interface TtsOptions {
  synth?: SpeechSynthesisLike | undefined;
  utteranceCtor?: UtteranceConstructor | undefined;
}

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
 * Pick the best Hebrew voice available.
 *
 * Falls back to letting the platform choose. Note that voices load asynchronously on
 * some platforms, so the first utterance after a cold start may use the default voice.
 */
function selectVoice(
  synth: SpeechSynthesisLike,
  lang: string,
): SpeechSynthesisVoiceLike | undefined {
  let voices: SpeechSynthesisVoiceLike[];
  try {
    voices = synth.getVoices();
  } catch {
    return undefined;
  }

  const exact = voices.find((voice) => voice.lang === lang);
  if (exact !== undefined) return exact;

  const prefix = lang.split('-')[0] ?? lang;
  return voices.find((voice) => voice.lang.startsWith(prefix));
}

export function createTtsService(options: TtsOptions = {}): TtsService {
  const synth = options.synth ?? findSynth();
  const utteranceCtor = options.utteranceCtor ?? findUtteranceCtor();
  const isSupported = synth !== undefined && utteranceCtor !== undefined;

  function speak(text: string, speakOptions?: { lang?: string }): void {
    if (synth === undefined || utteranceCtor === undefined) return;

    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const lang = speakOptions?.lang ?? HEBREW_LANG;

    // Cancel anything still speaking, so answers do not pile up on each other.
    try {
      synth.cancel();
    } catch {
      // Some engines throw when nothing is queued. Harmless.
    }

    const utterance = new utteranceCtor(trimmed);
    utterance.lang = lang;
    utterance.rate = 1;
    utterance.pitch = 1;

    const voice = selectVoice(synth, lang);
    utterance.voice = voice ?? null;

    try {
      synth.speak(utterance);
    } catch {
      // Speech is a nicety; never let it break the flow.
    }
  }

  function cancel(): void {
    try {
      synth?.cancel();
    } catch {
      // As above.
    }
  }

  return { isSupported, speak, cancel };
}
