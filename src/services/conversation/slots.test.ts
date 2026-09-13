import { describe, expect, it } from 'vitest';
import {
  isCancellation,
  mergeAnswer,
  missingSlots,
  readBareDuration,
  resolveAmbiguityFromAnswer,
  slotsFromCommand,
  toParsedCommand,
  type CommandSlots,
} from './slots';
import { parseCommand } from '../parser';
import { fixedClock } from '../../utils/clock';

const CLOCK = fixedClock('2026-09-13T09:00:00Z');

describe('resolveAmbiguityFromAnswer', () => {
  const SIX = ['06:00', '18:00'];

  it.each([
    ['בערב', '18:00'],
    ['ערב', '18:00'],
    ['בבוקר', '06:00'],
    ['בוקר', '06:00'],
    ['בלילה', '18:00'],
    ['אחר הצהריים', '18:00'],
    ['אחרי הצהריים', '18:00'],
  ])('resolves six from %s', (answer, expected) => {
    expect(resolveAmbiguityFromAnswer(SIX, answer)).toBe(expected);
  });

  it('finds the qualifier anywhere in the answer', () => {
    expect(resolveAmbiguityFromAnswer(SIX, 'כן בערב בבקשה')).toBe('18:00');
  });

  it('returns undefined for an answer with no day part', () => {
    expect(resolveAmbiguityFromAnswer(SIX, 'כן')).toBeUndefined();
    expect(resolveAmbiguityFromAnswer(SIX, 'לשעה')).toBeUndefined();
  });

  it('preserves the minutes', () => {
    expect(resolveAmbiguityFromAnswer(['06:30', '18:30'], 'בערב')).toBe('18:30');
  });

  it('handles the midnight-or-noon pair', () => {
    // The 1-12 reading here is twelve, not zero — reconstructing it wrongly would make
    // every answer resolve to the same candidate.
    const TWELVE = ['00:00', '12:00'];
    expect(resolveAmbiguityFromAnswer(TWELVE, 'בצהריים')).toBe('12:00');
    expect(resolveAmbiguityFromAnswer(TWELVE, 'בלילה')).toBe('00:00');
    expect(resolveAmbiguityFromAnswer(TWELVE, 'בבוקר')).toBe('12:00');
  });

  it('resolves exactly as the same qualifier would have inline', () => {
    // The whole point of reusing the parser's applyDayPart is that a one-word answer
    // and an inline qualifier can never disagree.
    for (const [hourWord, digits] of [
      ['בשש', '6'],
      ['בשמונה', '8'],
      ['בחמש', '5'],
    ] as const) {
      for (const qualifier of ['בבוקר', 'בערב', 'בצהריים', 'בלילה']) {
        const inline = parseCommand(
          `תקבע לי פגישה מחר ב-${digits} ${qualifier}`,
          CLOCK,
        ).startTime;

        const ambiguous = parseCommand(`תקבע לי פגישה מחר ${hourWord}`, CLOCK);
        const candidates = ambiguous.ambiguities[0]?.candidates ?? [];
        const viaAnswer = resolveAmbiguityFromAnswer(candidates, qualifier);

        expect(viaAnswer, `${hourWord} + ${qualifier}`).toBe(inline);
      }
    }
  });

  it('returns undefined for empty candidates', () => {
    expect(resolveAmbiguityFromAnswer([], 'בערב')).toBeUndefined();
  });
});

describe('readBareDuration', () => {
  it.each([
    ['שעה', 60],
    ['לשעה', 60],
    ['שעתיים', 120],
    ['לשעתיים', 120],
    ['חצי שעה', 30],
    ['רבע שעה', 15],
    ['שעה וחצי', 90],
    ['30 דקות', 30],
    ['90 דקות', 90],
    ['שלוש שעות', 180],
  ])('reads %s as %i minutes', (answer, expected) => {
    expect(readBareDuration(answer, CLOCK)).toBe(expected);
  });

  it('returns undefined for something that is not a duration', () => {
    expect(readBareDuration('בערב', CLOCK)).toBeUndefined();
    expect(readBareDuration('דניאל', CLOCK)).toBeUndefined();
  });
});

describe('missingSlots', () => {
  it('lists everything for empty slots', () => {
    expect(missingSlots({})).toEqual(['title', 'date', 'startTime', 'duration']);
  });

  it('does not call an unresolved hour missing', () => {
    // The information is present; it only needs disambiguating.
    const slots: CommandSlots = {
      title: 'פגישה',
      date: '2026-09-14',
      durationMinutes: 60,
      pendingAmbiguity: {
        slot: 'startTime',
        candidates: ['06:00', '18:00'],
        question: 'בבוקר או בערב?',
      },
    };
    expect(missingSlots(slots)).toEqual([]);
  });

  it('accepts an end time in place of a duration', () => {
    expect(
      missingSlots({ title: 'פגישה', date: '2026-09-14', startTime: '10:00', endTime: '11:00' }),
    ).toEqual([]);
  });
});

describe('mergeAnswer never overwrites a resolved slot', () => {
  const base: CommandSlots = {
    title: 'פגישה עם דניאל',
    date: '2026-09-18',
    durationMinutes: 120,
  };

  it('leaves the date alone when the answer mentions another one', () => {
    const merged = mergeAnswer(base, 'מחר', { asking: 'ambiguity', candidates: ['06:00', '18:00'] }, CLOCK);
    expect(merged.date).toBe('2026-09-18');
  });

  it('leaves the duration alone', () => {
    const merged = mergeAnswer(base, 'לשעה', { asking: 'duration' }, CLOCK);
    expect(merged.durationMinutes).toBe(120);
  });

  it('leaves the title alone', () => {
    const merged = mergeAnswer(base, 'אימון', { asking: 'title' }, CLOCK);
    expect(merged.title).toBe('פגישה עם דניאל');
  });

  it('fills a slot that is genuinely empty', () => {
    const merged = mergeAnswer({ title: 'פגישה' }, 'מחר', { asking: 'date' }, CLOCK);
    expect(merged.date).toBe('2026-09-14');
  });

  it('clears the ambiguity once the hour is settled', () => {
    const withAmbiguity: CommandSlots = {
      ...base,
      pendingAmbiguity: {
        slot: 'startTime',
        candidates: ['06:00', '18:00'],
        question: 'בבוקר או בערב?',
      },
    };
    const merged = mergeAnswer(
      withAmbiguity,
      'בערב',
      { asking: 'ambiguity', candidates: ['06:00', '18:00'] },
      CLOCK,
    );
    expect(merged.startTime).toBe('18:00');
    expect(merged.pendingAmbiguity).toBeUndefined();
  });
});

describe('slotsFromCommand and toParsedCommand round-trip', () => {
  it('carries a complete command through unchanged', () => {
    const original = parseCommand('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה', CLOCK);
    const rebuilt = toParsedCommand(slotsFromCommand(original), original.rawText);

    expect(rebuilt).toMatchObject({
      intent: 'CREATE',
      title: 'פגישה עם דניאל',
      date: '2026-09-14',
      startTime: '18:00',
      durationMinutes: 60,
      missing: [],
      ambiguities: [],
    });
  });

  it('carries an unresolved hour through as an ambiguity', () => {
    const original = parseCommand('תקבע לי פגישה עם דניאל מחר בשש לשעה', CLOCK);
    const rebuilt = toParsedCommand(slotsFromCommand(original), original.rawText);

    expect(rebuilt.startTime).toBeUndefined();
    expect(rebuilt.ambiguities[0]?.candidates).toEqual(['06:00', '18:00']);
    expect(rebuilt.ambiguities[0]?.question).toBe('בבוקר או בערב?');
  });
});

describe('isCancellation', () => {
  it.each(['עזוב', 'לא משנה', 'שכח מזה', 'לא חשוב'])('recognises %s', (text) => {
    expect(isCancellation(text)).toBe(true);
  });

  it.each(['בשש', 'בערב', 'לשעה', 'תקבע לי פגישה מחר'])('does not mistake %s', (text) => {
    expect(isCancellation(text)).toBe(false);
  });
});
