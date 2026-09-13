import { describe, expect, it } from 'vitest';
import { parseCommand } from './index';
import { fixedClock } from '../../utils/clock';

/**
 * Free-form phrasing.
 *
 * The rest of the parser suite checks individual rules; this one checks that a person
 * talking normally is understood. Every case here failed before the vocabulary and the
 * positional rules were widened.
 */

/** Sunday 2026-09-13, 12:00 Israel time. */
const CLOCK = fixedClock('2026-09-13T09:00:00Z');
const TOMORROW = '2026-09-14';

const parse = (text: string) => parseCommand(text, CLOCK);

describe('politely phrased requests', () => {
  it.each([
    'אפשר לקבוע פגישה עם דניאל מחר בשמונה בערב לשעה',
    'תוכל לקבוע לי פגישה עם דניאל מחר בשמונה בערב לשעה',
    'אני רוצה לקבוע פגישה עם דניאל מחר בשמונה בערב לשעה',
    'צריך לקבוע פגישה עם דניאל מחר בשמונה בערב לשעה',
    'תקבע בבקשה פגישה עם דניאל מחר בשמונה בערב לשעה',
  ])('understands: %s', (text) => {
    expect(parse(text)).toMatchObject({
      intent: 'CREATE',
      date: TOMORROW,
      startTime: '20:00',
      durationMinutes: 60,
      missing: [],
      ambiguities: [],
    });
  });

  it('keeps politeness out of the title', () => {
    // Without this, 'אפשר לבטל את הפגישה' searches for an event called 'אפשר הפגישה'.
    expect(parse('אפשר לקבוע פגישה עם דניאל מחר בשמונה בערב לשעה').title).toBe(
      'פגישה עם דניאל',
    );
    expect(parse('אפשר לבטל את הפגישה עם דניאל מחר').title).toBe('הפגישה עם דניאל');
  });

  it.each([
    ['אפשר לבטל את הפגישה עם דניאל מחר', 'DELETE'],
    ['תוריד את הפגישה עם דניאל מחר', 'DELETE'],
    ['אפשר להעביר את הפגישה עם דניאל מחר ל-18:00', 'UPDATE'],
    ['תקדים את הפגישה עם דניאל מחר ל-13:00', 'UPDATE'],
    ['אפשר לשנות את הפגישה מחר מדניאל לאברהם', 'UPDATE'],
  ])('reads %s as %s', (text, intent) => {
    expect(parse(text).intent).toBe(intent);
  });
});

describe('a day part BEFORE the hour', () => {
  it('resolves הערב בשמונה', () => {
    expect(parse('תקבע פגישה הערב בשמונה לשעה')).toMatchObject({
      date: '2026-09-13',
      startTime: '20:00',
      ambiguities: [],
    });
  });

  it('resolves מחר בבוקר ב-9', () => {
    expect(parse('תקבע פגישה מחר בבוקר ב-9 לשעה')).toMatchObject({
      date: TOMORROW,
      startTime: '09:00',
    });
  });

  it('resolves הבוקר as today', () => {
    expect(parse('תקבע פגישה הבוקר בעשר לשעה')).toMatchObject({
      date: '2026-09-13',
      startTime: '10:00',
    });
  });

  it('STILL keeps ארוחת ערב intact', () => {
    // The bare 'ערב' of a meal name carries no particle, so it is not a qualifier.
    const parsed = parse('תקבע לי ארוחת ערב עם חברים מחר ב-8');
    expect(parsed.title).toBe('ארוחת ערב עם חברים');
    expect(parsed.startTime).toBeUndefined();
  });

  it('STILL keeps ארוחת הערב intact, despite the particle', () => {
    // Guarded by the construct head rather than by the particle alone.
    const parsed = parse('תקבע לי ארוחת הערב עם חברים מחר ב-8');
    expect(parsed.title).toContain('ארוחת הערב');
    expect(parsed.date).toBe(TOMORROW);
  });

  it('a following qualifier still wins for a meal', () => {
    const parsed = parse('תקבע לי ארוחת ערב עם חברים מחר ב-8 בערב לשעתיים');
    expect(parsed.title).toBe('ארוחת ערב עם חברים');
    expect(parsed.startTime).toBe('20:00');
  });
});

describe('ranges share one qualifier', () => {
  it('resolves both halves of משמונה עד עשר בבוקר', () => {
    expect(parse('תקבע פגישה מחר משמונה עד עשר בבוקר')).toMatchObject({
      startTime: '08:00',
      endTime: '10:00',
      durationMinutes: 120,
      ambiguities: [],
    });
  });

  it('works with digits too', () => {
    expect(parse('תקבע פגישה מחר מ-8 עד 10 בבוקר')).toMatchObject({
      startTime: '08:00',
      endTime: '10:00',
    });
  });

  it('stays ambiguous when the qualifier cannot settle it', () => {
    // Nothing here says which eight, and both readings fit before a ten o'clock end.
    const parsed = parse('תקבע פגישה מחר משמונה עד עשר');
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.ambiguities.length).toBeGreaterThan(0);
  });
});

describe('more ways of naming a day', () => {
  it('reads a written date', () => {
    expect(parse('תקבע פגישה ב-25.9 בשמונה בערב לשעה').date).toBe('2026-09-25');
  });

  it('reads a written date with a slash and a year', () => {
    expect(parse('תקבע פגישה ב-25/12/2026 בשמונה בערב לשעה').date).toBe('2026-12-25');
  });

  it('rolls a past written date into next year', () => {
    expect(parse('תקבע פגישה ב-5.1 בשמונה בערב לשעה').date).toBe('2027-01-05');
  });

  it('rejects an impossible written date', () => {
    expect(parse('תקבע פגישה ב-32.13 בשמונה בערב לשעה').date).toBeUndefined();
  });

  it('reads סוף השבוע as Friday to Saturday', () => {
    expect(parse('מה יש לי בסוף השבוע').dateRange).toEqual({
      startDate: '2026-09-18',
      endDate: '2026-09-19',
    });
  });
});

describe('an exact moment measured from now', () => {
  it('resolves בעוד שעתיים', () => {
    // The clock reads 12:00, so this is 14:00 today — computed, not guessed.
    expect(parse('תקבע פגישה בעוד שעתיים לשעה')).toMatchObject({
      date: '2026-09-13',
      startTime: '14:00',
      ambiguities: [],
    });
  });

  it('resolves בעוד שעה', () => {
    expect(parse('תקבע פגישה בעוד שעה לחצי שעה').startTime).toBe('13:00');
  });

  it('resolves בעוד 20 דקות', () => {
    expect(parse('תקבע פגישה בעוד 20 דקות לחצי שעה').startTime).toBe('12:20');
  });

  it('still reads בעוד יומיים as a day, not a time', () => {
    const parsed = parse('תקבע פגישה בעוד יומיים ב-18:00 לשעה');
    expect(parsed.date).toBe('2026-09-15');
    expect(parsed.startTime).toBe('18:00');
  });
});

describe('more ways of asking', () => {
  it.each([
    'מה קורה מחר',
    'מה התוכניות שלי מחר',
    'יש לי משהו מחר',
    'מה יש לי מחר',
    'תראה לי מה יש מחר',
  ])('reads %s as a query', (text) => {
    expect(parse(text)).toMatchObject({ intent: 'QUERY', date: TOMORROW });
  });

  it.each(['יש לי זמן פנוי מחר', 'מתי אני פנוי מחר', 'מצא לי שעה פנויה מחר'])(
    'reads %s as a free-slot search',
    (text) => {
      expect(parse(text)).toMatchObject({ intent: 'FIND_FREE', date: TOMORROW });
    },
  );
});

describe('the ambiguity rule survives all of this', () => {
  it.each([
    'אפשר לקבוע פגישה מחר בשמונה לשעה',
    'אני רוצה לקבוע פגישה מחר בשש לשעה',
    'תזכיר לי להתקשר לאמא מחר בשבע לרבע שעה',
  ])('still refuses to guess AM/PM in: %s', (text) => {
    const parsed = parse(text);
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.ambiguities[0]?.question).toBe('בבוקר או בערב?');
  });
});
