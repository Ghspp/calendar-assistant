import { describe, expect, it, vi } from 'vitest';
import { createTtsService, selectVoice, type SpeechSynthesisLike } from './TtsService';

class FakeUtterance {
  lang = '';
  voice: { lang: string; name: string } | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: ((event?: { error?: string }) => void) | null = null;
  constructor(public text: string) {}
}

function fakeSynth(voices: Array<{ lang: string; name: string }> = []) {
  const spoken: FakeUtterance[] = [];
  const synth: SpeechSynthesisLike = {
    speak: (utterance) => spoken.push(utterance as unknown as FakeUtterance),
    cancel: vi.fn(),
    getVoices: () => voices,
    speaking: false,
  };
  return { synth, spoken };
}

/** Runs scheduled work immediately, so the tests need no timers. */
const immediate = (run: () => void) => run();

function makeService(voices: Array<{ lang: string; name: string }> = []) {
  const { synth, spoken } = fakeSynth(voices);
  const tts = createTtsService({
    synth,
    utteranceCtor: FakeUtterance as unknown as new (text: string) => FakeUtterance,
    schedule: immediate,
  });
  return { tts, synth, spoken };
}

describe('support detection', () => {
  it('is supported when both the synth and the utterance type exist', () => {
    expect(makeService().tts.isSupported).toBe(true);
  });

  it('is unsupported without a synthesiser', () => {
    const tts = createTtsService({
      synth: undefined,
      utteranceCtor: FakeUtterance as unknown as new (text: string) => FakeUtterance,
    });
    expect(tts.isSupported).toBe(false);
  });

  it('does nothing when unsupported, rather than throwing', () => {
    const tts = createTtsService({ synth: undefined, utteranceCtor: undefined });
    expect(() => {
      tts.speak('שלום');
      tts.cancel();
    }).not.toThrow();
  });
});

describe('speaking', () => {
  it('speaks the text in Hebrew by default', () => {
    const { tts, spoken } = makeService();
    tts.speak('קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00.');

    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.text).toBe('קבעתי פגישה עם דניאל מחר בין 18:00 ל־19:00.');
    expect(spoken[0]?.lang).toBe('he-IL');
  });

  it('honours an explicit language', () => {
    const { tts, spoken } = makeService();
    tts.speak('hello', { lang: 'en-US' });
    expect(spoken[0]?.lang).toBe('en-US');
  });

  it('does NOT cancel when nothing is speaking', () => {
    // Cancelling immediately before speaking discards the new utterance on Android.
    const { tts, synth } = makeService();
    tts.speak('ראשון');
    tts.speak('שני');
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it('cancels only when an utterance really is in progress', () => {
    const { tts, synth, spoken } = makeService();
    synth.speaking = true;
    tts.speak('שני');

    expect(synth.cancel).toHaveBeenCalledOnce();
    // And the replacement still gets spoken, after the queue settles.
    expect(spoken.map((u) => u.text)).toEqual(['שני']);
  });

  it('ignores empty or whitespace-only text', () => {
    const { tts, spoken } = makeService();
    tts.speak('');
    tts.speak('   ');
    expect(spoken).toHaveLength(0);
  });

  it('trims the text', () => {
    const { tts, spoken } = makeService();
    tts.speak('  שלום  ');
    expect(spoken[0]?.text).toBe('שלום');
  });
});

describe('voice selection', () => {
  it('prefers an exact language match', () => {
    const { tts, spoken } = makeService([
      { lang: 'en-US', name: 'English' },
      { lang: 'he-IL', name: 'Hebrew' },
    ]);
    tts.speak('שלום');
    expect(spoken[0]?.voice?.name).toBe('Hebrew');
  });

  it('falls back to the same base language', () => {
    const { tts, spoken } = makeService([{ lang: 'he', name: 'Hebrew generic' }]);
    tts.speak('שלום');
    expect(spoken[0]?.voice?.name).toBe('Hebrew generic');
  });

  it('leaves the platform to choose when no Hebrew voice exists', () => {
    const { tts, spoken } = makeService([{ lang: 'en-US', name: 'English' }]);
    tts.speak('שלום');
    expect(spoken[0]?.voice).toBeNull();
  });

  it('survives a synthesiser that throws from getVoices', () => {
    const synth: SpeechSynthesisLike = {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => {
        throw new Error('not ready');
      },
    };
    const tts = createTtsService({
      synth,
      utteranceCtor: FakeUtterance as unknown as new (text: string) => FakeUtterance,
      schedule: immediate,
    });
    expect(() => tts.speak('שלום')).not.toThrow();
    expect(synth.speak).toHaveBeenCalledOnce();
  });
});

describe('resilience', () => {
  it('never lets a failing speak break the caller', () => {
    const synth: SpeechSynthesisLike = {
      speak: () => {
        throw new Error('engine unavailable');
      },
      cancel: vi.fn(),
      getVoices: () => [],
    };
    const tts = createTtsService({
      synth,
      utteranceCtor: FakeUtterance as unknown as new (text: string) => FakeUtterance,
      schedule: immediate,
    });
    expect(() => tts.speak('שלום')).not.toThrow();
  });

  it('never lets a failing cancel break the caller', () => {
    const synth: SpeechSynthesisLike = {
      speak: vi.fn(),
      cancel: () => {
        throw new Error('nothing queued');
      },
      getVoices: () => [],
    };
    const tts = createTtsService({
      synth,
      utteranceCtor: FakeUtterance as unknown as new (text: string) => FakeUtterance,
      schedule: immediate,
    });
    expect(() => tts.cancel()).not.toThrow();
  });
});

describe('priming for mobile browsers', () => {
  it('speaks a silent utterance so later replies are allowed through', () => {
    // Android Chrome refuses to speak unless the page already spoke from a real tap.
    const { tts, spoken } = makeService();
    tts.prime();

    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.volume).toBe(0);
  });

  it('primes only once, however many times it is called', () => {
    const { tts, spoken } = makeService();
    tts.prime();
    tts.prime();
    tts.prime();
    expect(spoken).toHaveLength(1);
  });

  it('speaks a real reply at full volume after priming', () => {
    const { tts, spoken } = makeService();
    tts.prime();
    tts.speak('קבעתי פגישה');

    expect(spoken[1]?.volume).toBe(1);
    expect(spoken[1]?.text).toBe('קבעתי פגישה');
  });

  it('does nothing when speech is unsupported', () => {
    const tts = createTtsService({ synth: undefined, utteranceCtor: undefined });
    expect(() => tts.prime()).not.toThrow();
  });
});

describe('voices that load late', () => {
  it('picks up a Hebrew voice that only appears after startup', () => {
    // getVoices() commonly returns nothing on the first call.
    const voices: Array<{ lang: string; name: string }> = [];
    const spoken: FakeUtterance[] = [];
    let onVoicesChanged: (() => void) | undefined;

    const synth: SpeechSynthesisLike = {
      speak: (utterance) => spoken.push(utterance as unknown as FakeUtterance),
      cancel: vi.fn(),
      getVoices: () => voices,
      addEventListener: (type, listener) => {
        if (type === 'voiceschanged') onVoicesChanged = listener;
      },
    };

    const tts = createTtsService({
      synth,
      utteranceCtor: FakeUtterance as unknown as new (text: string) => FakeUtterance,
      schedule: immediate,
    });

    voices.push({ lang: 'he-IL', name: 'Hebrew' });
    onVoicesChanged?.();

    tts.speak('שלום');
    expect(spoken[0]?.voice?.name).toBe('Hebrew');
  });
});

describe('status, so silence can be explained', () => {
  it('reports how many voices the engine has', () => {
    const { tts } = makeService([{ lang: 'he-IL', name: 'Hebrew' }]);
    tts.speak('שלום');

    const status = tts.getStatus();
    expect(status.voiceCount).toBe(1);
    expect(status.hasLanguageVoice).toBe(true);
  });

  it('reports when no Hebrew voice is installed', () => {
    const { tts } = makeService([{ lang: 'en-US', name: 'English' }]);
    tts.speak('שלום');
    expect(tts.getStatus().hasLanguageVoice).toBe(false);
  });

  it('records an error reported by the engine', () => {
    const { tts, spoken } = makeService();
    tts.speak('שלום');
    spoken[0]?.onerror?.({ error: 'synthesis-failed' });

    expect(tts.getStatus().state).toBe('error');
    expect(tts.getStatus().detail).toBe('synthesis-failed');
  });

  it('records success when the utterance finishes', () => {
    const { tts, spoken } = makeService();
    tts.speak('שלום');
    spoken[0]?.onend?.();
    expect(tts.getStatus().state).toBe('spoke');
  });

  it('reports unsupported when there is no engine', () => {
    const tts = createTtsService({ synth: undefined, utteranceCtor: undefined });
    expect(tts.getStatus().state).toBe('unsupported');
  });
});

describe('Hebrew language tags', () => {
  // Hebrew's ISO code changed from 'iw' to 'he', and many Android engines still report
  // the old one. Matching only 'he' hides a Hebrew voice that is installed and working.
  it('matches a voice tagged iw-IL', () => {
    const voices = [{ lang: 'iw-IL', name: 'Hebrew (legacy tag)' }];
    expect(selectVoice(voices, 'he-IL')?.name).toBe('Hebrew (legacy tag)');
  });

  it('prefers an exact he-IL match over the legacy tag', () => {
    const voices = [
      { lang: 'iw-IL', name: 'legacy' },
      { lang: 'he-IL', name: 'modern' },
    ];
    expect(selectVoice(voices, 'he-IL')?.name).toBe('modern');
  });

  it('reports a legacy-tagged voice as available', () => {
    const { tts } = makeService([{ lang: 'iw-IL', name: 'Hebrew' }]);
    tts.speak('שלום');
    expect(tts.getStatus().hasLanguageVoice).toBe(true);
  });

  it('lists the languages the engine offers', () => {
    const { tts } = makeService([
      { lang: 'en-US', name: 'English' },
      { lang: 'ar-001', name: 'Arabic' },
    ]);
    tts.speak('שלום');
    expect(tts.getStatus().languages).toEqual(['ar-001', 'en-US']);
  });

  it('is case insensitive about the tag', () => {
    expect(selectVoice([{ lang: 'IW-il', name: 'Hebrew' }], 'he-IL')).toBeDefined();
  });
});

describe('Android-style language tags', () => {
  // Real devices report tags with underscores, which a naive comparison misses
  // entirely — the voice is installed and usable but never selected.
  it.each(['he_IL', 'iw_IL', 'HE_IL', 'he-IL'])('matches a voice tagged %s', (tag) => {
    expect(selectVoice([{ lang: tag, name: 'Hebrew' }], 'he-IL')?.name).toBe('Hebrew');
  });

  it('ignores a script suffix on an unrelated voice', () => {
    const voices = [
      { lang: 'hi_IN_#Latn', name: 'Hindi' },
      { lang: 'he_IL', name: 'Hebrew' },
    ];
    expect(selectVoice(voices, 'he-IL')?.name).toBe('Hebrew');
  });

  it('does not match an unrelated language', () => {
    // The exact voice list from a real device with no Hebrew installed.
    const voices = [
      'de_DE', 'en_GB', 'en_US', 'es_ES', 'es_MX', 'es_US', 'fr_FR',
      'hi_IN', 'hi_IN_#Latn', 'it_IT', 'pl_PL', 'pt_BR', 'ru_RU', 'th_TH', 'vi_VN',
    ].map((lang) => ({ lang, name: lang }));

    expect(selectVoice(voices, 'he-IL')).toBeUndefined();
  });
});
