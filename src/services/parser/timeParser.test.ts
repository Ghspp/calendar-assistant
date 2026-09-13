import { describe, expect, it } from 'vitest';
import { parseCommand } from './index';
import { fixedClock } from '../../utils/clock';
import type { ParsedCommand } from '../../types/parser';

const CLOCK = fixedClock('2026-09-13T09:00:00Z');

function parse(text: string): ParsedCommand {
  return parseCommand(text, CLOCK);
}

/** Assert an hour was resolved outright, with no question left open. */
function expectResolved(text: string, expected: string): void {
  const parsed = parse(text);
  expect(parsed.startTime, `"${text}" should resolve to ${expected}`).toBe(expected);
  expect(parsed.ambiguities).toHaveLength(0);
}

/** Assert an hour was NOT resolved and both readings were offered instead. */
function expectAmbiguous(text: string, candidates: string[]): void {
  const parsed = parse(text);
  expect(parsed.startTime, `"${text}" must not resolve to a guessed hour`).toBeUndefined();
  expect(parsed.ambiguities).toHaveLength(1);
  expect(parsed.ambiguities[0]?.slot).toBe('startTime');
  expect(parsed.ambiguities[0]?.candidates).toEqual(candidates);
}

describe('resolved times — explicit 24-hour values', () => {
  it('parses 17:00', () => expectResolved('תקבע לי אימון מחר בשעה 17:00', '17:00'));
  it('parses a bare 19', () => expectResolved('תקבע לי פגישה מחר ב-19', '19:00'));
  it('parses 13:30', () => expectResolved('תקבע לי פגישה מחר ב-13:30', '13:30'));
  it('parses 23:45', () => expectResolved('תקבע לי פגישה מחר ב-23:45', '23:45'));
  it('parses midnight as 00:00', () => expectResolved('תקבע לי פגישה מחר ב-0:00', '00:00'));

  it('ignores a redundant qualifier on an explicit hour', () => {
    expectResolved('תקבע לי פגישה מחר ב-19 בערב', '19:00');
  });
});

describe('resolved times — day-part qualifiers', () => {
  it('parses 8 בערב', () => expectResolved('תקבע לי פגישה מחר ב-8 בערב', '20:00'));
  it('parses 10 בבוקר', () => expectResolved('תקבע לי פגישה מחר ב-10 בבוקר', '10:00'));
  it('parses 5 בערב', () => expectResolved('תקבע לי פגישה מחר ב-5 בערב', '17:00'));
  it('parses 5 אחר הצהריים', () => {
    expectResolved('תקבע לי פגישה מחר ב-5 אחר הצהריים', '17:00');
  });
  it('parses 5 אחרי הצהריים', () => {
    expectResolved('תקבע לי פגישה מחר ב-5 אחרי הצהריים', '17:00');
  });
  it('parses 12 בצהריים', () => expectResolved('תקבע לי פגישה מחר ב-12 בצהריים', '12:00'));
  it('parses 11 בלילה', () => expectResolved('תקבע לי פגישה מחר ב-11 בלילה', '23:00'));
  it('parses 1 בלילה as 01:00', () => expectResolved('תקבע לי פגישה מחר ב-1 בלילה', '01:00'));
  it('parses 12 בלילה as midnight', () => expectResolved('תקבע לי פגישה מחר ב-12 בלילה', '00:00'));

  it('resolves an hour word with a qualifier', () => {
    expectResolved('תקבע לי פגישה מחר בשש בערב', '18:00');
  });

  it('resolves שמונה with a qualifier', () => {
    expectResolved('תקבע לי פגישה מחר בשמונה בבוקר', '08:00');
  });
});

describe('resolved times — Latin meridiem', () => {
  it('parses 5 pm', () => expectResolved('תקבע לי פגישה מחר ב-5 pm', '17:00'));
  it('parses 5 PM case-insensitively', () => expectResolved('תקבע לי פגישה מחר ב-5 PM', '17:00'));
  it('parses 10 am', () => expectResolved('תקבע לי פגישה מחר ב-10 am', '10:00'));
  it('parses 12 am as midnight', () => expectResolved('תקבע לי פגישה מחר ב-12 am', '00:00'));
  it('parses 12 pm as noon', () => expectResolved('תקבע לי פגישה מחר ב-12 pm', '12:00'));
});

describe('fractional hours', () => {
  it('parses שש וחצי בערב', () => {
    expectResolved('תקבע לי פגישה מחר בשש וחצי בערב', '18:30');
  });

  it('parses שש ורבע בערב', () => {
    expectResolved('תקבע לי פגישה מחר בשש ורבע בערב', '18:15');
  });

  it('parses רבע לשש בערב', () => {
    expectResolved('תקבע לי פגישה מחר רבע לשש בערב', '17:45');
  });

  it('leaves a bare שש וחצי ambiguous', () => {
    expectAmbiguous('תקבע לי פגישה מחר בשש וחצי', ['06:30', '18:30']);
  });
});

describe('AMBIGUOUS hours — the parser must never guess AM/PM', () => {
  it('leaves בשש unresolved', () => {
    expectAmbiguous('תקבע לי פגישה עם דניאל מחר בשש', ['06:00', '18:00']);
  });

  it('leaves בשמונה unresolved', () => {
    expectAmbiguous('תקבע לי פגישה מחר בשמונה', ['08:00', '20:00']);
  });

  it('leaves ב-6 unresolved', () => {
    expectAmbiguous('תקבע לי פגישה מחר ב-6', ['06:00', '18:00']);
  });

  it('leaves a bare digit 5 unresolved', () => {
    expectAmbiguous('תקבע לי פגישה מחר ב-5', ['05:00', '17:00']);
  });

  it('leaves the one-digit colon form 6:30 unresolved', () => {
    // A colon alone is not 24-hour notation: the hour must be zero-padded. Compare
    // '06:30', which resolves. See the HH:mm notation suite below.
    expectAmbiguous('תקבע לי פגישה מחר ב-6:30', ['06:30', '18:30']);
  });

  it('leaves בשתים עשרה unresolved', () => {
    expectAmbiguous('תקבע לי פגישה מחר בשתים עשרה', ['00:00', '12:00']);
  });

  it('leaves בחמש unresolved', () => {
    expectAmbiguous('שים לי חוג כדורגל מחר בחמש', ['05:00', '17:00']);
  });

  it('leaves באחת עשרה unresolved', () => {
    expectAmbiguous('תקבע לי פגישה מחר באחת עשרה', ['11:00', '23:00']);
  });

  it('asks בבוקר או בערב for a normal hour', () => {
    expect(parse('תקבע לי פגישה מחר בשש').ambiguities[0]?.question).toBe('בבוקר או בערב?');
  });

  it('asks בצהריים או בחצות for twelve', () => {
    expect(parse('תקבע לי פגישה מחר בשתים עשרה').ambiguities[0]?.question).toBe(
      'בצהריים או בחצות?',
    );
  });

  it('never derives an end time from an unresolved start', () => {
    const parsed = parse('תקבע לי פגישה מחר בשש לשעה');
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.endTime).toBeUndefined();
    // The duration is still captured — only the hour is in question.
    expect(parsed.durationMinutes).toBe(60);
  });
});

describe('end times', () => {
  it('resolves a bare end hour against a known start', () => {
    // 11:00 is a one-hour meeting; 23:00 would be thirteen hours, so only one reading
    // survives the constraint and no question is needed.
    const parsed = parse('שים לי פגישה ביום ראשון ב-10 בבוקר עד 11');
    expect(parsed.startTime).toBe('10:00');
    expect(parsed.endTime).toBe('11:00');
    expect(parsed.ambiguities).toHaveLength(0);
  });

  it('picks the evening reading when the start is in the evening', () => {
    const parsed = parse('תקבע לי פגישה מחר ב-18:00 עד 11');
    expect(parsed.startTime).toBe('18:00');
    expect(parsed.endTime).toBe('23:00');
    expect(parsed.ambiguities).toHaveLength(0);
  });

  it('accepts an explicit 24-hour end time', () => {
    const parsed = parse('תקבע לי פגישה מחר ב-21:00 עד 23:00');
    expect(parsed.endTime).toBe('23:00');
    expect(parsed.durationMinutes).toBe(120);
  });

  it('leaves both times ambiguous when the start is ambiguous too', () => {
    const parsed = parse('תקבע לי פגישה מחר בשש עד שמונה');
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.endTime).toBeUndefined();
    expect(parsed.ambiguities.map((item) => item.slot)).toEqual(['startTime', 'endTime']);
  });

  it('derives the duration from a resolved start and end', () => {
    const parsed = parse('שים לי פגישה ביום ראשון ב-10 בבוקר עד 11');
    expect(parsed.durationMinutes).toBe(60);
  });
});

describe('start plus duration', () => {
  it('derives the end time', () => {
    const parsed = parse('תקבע לי פגישה מחר ב-18:00 לשעה');
    expect(parsed.startTime).toBe('18:00');
    expect(parsed.endTime).toBe('19:00');
  });

  it('wraps past midnight without crashing', () => {
    const parsed = parse('תקבע לי פגישה מחר ב-23:00 לשעתיים');
    expect(parsed.startTime).toBe('23:00');
    expect(parsed.endTime).toBe('01:00');
  });
});

describe('non-times', () => {
  it('does not read a duration count as an hour', () => {
    // 'לשלוש שעות' is three hours long, not three o'clock.
    const parsed = parse('תקבע לי פגישה מחר ב-18:00 לשלוש שעות');
    expect(parsed.startTime).toBe('18:00');
    expect(parsed.durationMinutes).toBe(180);
  });

  it('does not read the ערב of ארוחת ערב as a qualifier', () => {
    const parsed = parse('תקבע לי ארוחת ערב עם חברים ביום שישי בשמונה');
    expect(parsed.title).toBe('ארוחת ערב עם חברים');
    expect(parsed.startTime).toBeUndefined();
  });

  it('does not invent a time when none was given', () => {
    const parsed = parse('תקבע לי פגישה עם דניאל מחר');
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.ambiguities).toHaveLength(0);
    expect(parsed.missing).toContain('startTime');
  });
});

describe('explicit HH:mm clock notation', () => {
  // Zero-padded clock notation is unambiguous by construction: nobody writes '09:00'
  // meaning nine in the evening. A spoken 'בתשע' carries no such signal.
  it('parses 09:00', () => expectResolved('תקבע לי פגישה מחר ב-09:00', '09:00'));
  it('parses 10:30', () => expectResolved('תקבע לי פגישה מחר ב-10:30', '10:30'));
  it('parses 12:00 as noon', () => expectResolved('תקבע לי פגישה מחר ב-12:00', '12:00'));
  it('parses 08:15', () => expectResolved('תקבע לי פגישה מחר ב-08:15', '08:15'));
  it('parses 00:30', () => expectResolved('תקבע לי פגישה מחר ב-00:30', '00:30'));
  it('parses 17:00', () => expectResolved('תקבע לי אימון מחר בשעה 17:00', '17:00'));

  it('works without a particle in front', () => {
    expectResolved('תקבע לי פגישה מחר 09:00', '09:00');
  });

  it('STILL leaves a one-digit colon form ambiguous', () => {
    // '6:30' and '9:00' are not 24-hour notation — the hour is not zero-padded.
    expectAmbiguous('תקבע לי פגישה מחר ב-6:30', ['06:30', '18:30']);
    expectAmbiguous('תקבע לי פגישה מחר ב-9:00', ['09:00', '21:00']);
  });

  it('STILL leaves a bare zero-padded digit ambiguous', () => {
    // '09' has no minute component, so it is not HH:mm notation at all.
    expectAmbiguous('תקבע לי פגישה מחר ב-09', ['09:00', '21:00']);
  });

  it('STILL leaves spoken hours ambiguous', () => {
    expectAmbiguous('תקבע לי פגישה מחר בתשע', ['09:00', '21:00']);
    expectAmbiguous('תקבע לי פגישה מחר בשש', ['06:00', '18:00']);
    expectAmbiguous('תקבע לי פגישה מחר ב-6', ['06:00', '18:00']);
  });

  it('consumes a redundant qualifier rather than leaving it in the title', () => {
    const parsed = parse('תקבע לי פגישה עם דניאל מחר ב-09:00 בבוקר');
    expect(parsed.startTime).toBe('09:00');
    expect(parsed.title).toBe('פגישה עם דניאל');
  });

  it('does not let a contradictory qualifier override the notation', () => {
    expectResolved('תקבע לי פגישה מחר ב-09:00 בערב', '09:00');
  });

  it('resolves an end time written in HH:mm without a question', () => {
    const parsed = parse('תקבע לי פגישה מחר ב-09:00 עד 10:30');
    expect(parsed.startTime).toBe('09:00');
    expect(parsed.endTime).toBe('10:30');
    expect(parsed.durationMinutes).toBe(90);
    expect(parsed.ambiguities).toHaveLength(0);
  });

  it('resolves a morning meeting end to end', () => {
    const parsed = parse('תקבע לי פגישה עם דניאל מחר ב-09:00 לשעה');
    expect(parsed.startTime).toBe('09:00');
    expect(parsed.endTime).toBe('10:00');
    expect(parsed.missing).toEqual([]);
    expect(parsed.ambiguities).toEqual([]);
  });
});
