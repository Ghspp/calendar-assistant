import { describe, expect, it, vi } from 'vitest';
import { createTtsService, type SpeechSynthesisLike } from './TtsService';

class FakeUtterance {
  lang = '';
  voice: { lang: string; name: string } | null = null;
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function fakeSynth(voices: Array<{ lang: string; name: string }> = []) {
  const spoken: FakeUtterance[] = [];
  const synth: SpeechSynthesisLike = {
    speak: (utterance) => spoken.push(utterance as unknown as FakeUtterance),
    cancel: vi.fn(),
    getVoices: () => voices,
  };
  return { synth, spoken };
}

function makeService(voices: Array<{ lang: string; name: string }> = []) {
  const { synth, spoken } = fakeSynth(voices);
  const tts = createTtsService({
    synth,
    utteranceCtor: FakeUtterance as unknown as new (text: string) => FakeUtterance,
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

  it('cancels anything already speaking, so answers do not overlap', () => {
    const { tts, synth } = makeService();
    tts.speak('ראשון');
    tts.speak('שני');
    expect(synth.cancel).toHaveBeenCalledTimes(2);
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
    });
    expect(() => tts.cancel()).not.toThrow();
  });
});
