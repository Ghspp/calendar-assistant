import { describe, expect, it } from 'vitest';
import { parseCommand } from './index';
import { fixedClock } from '../../utils/clock';

/** Sunday 2026-09-13, 12:00 Israel local time. */
const CLOCK = fixedClock('2026-09-13T09:00:00Z');
const TOMORROW = '2026-09-14';

function parse(text: string) {
  return parseCommand(text, CLOCK);
}

describe('intent detection', () => {
  it.each([
    ['תקבע לי פגישה מחר', 'CREATE'],
    ['קבע לי פגישה מחר', 'CREATE'],
    ['שים לי חוג כדורגל מחר', 'CREATE'],
    ['תוסיף לי אימון מחר', 'CREATE'],
    ['תרשום לי פגישה מחר', 'CREATE'],
    ['בטל את הפגישה מחר', 'DELETE'],
    ['תבטל את הפגישה מחר', 'DELETE'],
    ['תמחק את האימון מחר', 'DELETE'],
    ['העבר את הפגישה למחר', 'UPDATE'],
    ['תעביר את הפגישה למחר', 'UPDATE'],
    ['תשנה את האימון שלי מחר', 'UPDATE'],
    ['מה יש לי מחר', 'QUERY'],
    ['מה יש לי היום', 'QUERY'],
    ['מתי יש לי את הפגישה עם דניאל', 'QUERY'],
    ['אני פנוי מחר', 'QUERY'],
    ['מצא לי שעה פנויה מחר', 'FIND_FREE'],
    ['תמצא לי שעה פנויה מחר', 'FIND_FREE'],
    ['באיזה שעה אני פנוי ביום שישי', 'FIND_FREE'],
  ])('classifies %s as %s', (text, expected) => {
    expect(parse(text).intent).toBe(expected);
  });

  it('returns UNKNOWN for an unrecognised command', () => {
    expect(parse('שלום מה שלומך').intent).toBe('UNKNOWN');
  });

  it('does not strip שים into a particle plus stem', () => {
    expect(parse('שים לי חוג כדורגל מחר').intent).toBe('CREATE');
  });
});

describe('title extraction', () => {
  it.each([
    ['תקבע לי פגישה עם דניאל מחר בשש', 'פגישה עם דניאל'],
    ['שים לי חוג כדורגל מחר בחמש לשעה', 'חוג כדורגל'],
    ['תקבע לי ארוחת ערב עם חברים ביום שישי בשמונה לשעתיים', 'ארוחת ערב עם חברים'],
    ['תקבע לי אימון מחר בשעה 17:00', 'אימון'],
    ['שים לי פגישה ביום ראשון ב-10 בבוקר עד 11', 'פגישה'],
    ['בטל את הפגישה עם דניאל מחר', 'הפגישה עם דניאל'],
    ['העבר את הפגישה עם דניאל למחר בשמונה', 'הפגישה עם דניאל'],
    ['מתי יש לי את הפגישה עם דניאל', 'הפגישה עם דניאל'],
  ])('extracts the title from %s', (text, expected) => {
    expect(parse(text).title).toBe(expected);
  });

  it('returns no title when nothing is left over', () => {
    expect(parse('תקבע לי מחר בשעה 17:00').title).toBeUndefined();
  });

  it('keeps מחר out of the title', () => {
    expect(parse('תקבע לי אימון מחר').title).toBe('אימון');
  });
});

describe('missing slots', () => {
  it('asks for the hour and the duration when only a date was given', () => {
    const parsed = parse('תקבע לי פגישה עם דניאל מחר');
    expect(parsed.missing).toEqual(['startTime', 'duration']);
    expect(parsed.ambiguities).toHaveLength(0);
  });

  it('asks for the duration once the hour is resolved', () => {
    const parsed = parse('תקבע לי פגישה עם דניאל מחר בשש בערב');
    expect(parsed.missing).toEqual(['duration']);
    expect(parsed.startTime).toBe('18:00');
  });

  it('reports nothing missing for a complete command', () => {
    const parsed = parse('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה');
    expect(parsed.missing).toEqual([]);
    expect(parsed.ambiguities).toEqual([]);
  });

  it('asks for date, hour and duration when only a title was given', () => {
    const parsed = parse('תקבע לי פגישה עם דניאל');
    expect(parsed.missing).toEqual(['date', 'startTime', 'duration']);
  });

  it('treats an ambiguous hour as present, not missing', () => {
    // The information IS there — it just needs disambiguating, which is what
    // `ambiguities` is for. Reporting it as missing would ask the wrong question.
    const parsed = parse('תקבע לי פגישה עם דניאל מחר בשש');
    expect(parsed.missing).not.toContain('startTime');
    expect(parsed.ambiguities).toHaveLength(1);
  });

  it('needs only a date for a query', () => {
    expect(parse('מה יש לי מחר').missing).toEqual([]);
    expect(parse('מה יש לי').missing).toEqual(['date']);
  });

  it('needs a title to delete', () => {
    expect(parse('בטל את הפגישה עם דניאל מחר').missing).toEqual([]);
    expect(parse('תבטל מחר').missing).toEqual(['title']);
  });
});

describe('spec examples', () => {
  it('תקבע לי פגישה עם דניאל מחר בשש', () => {
    expect(parse('תקבע לי פגישה עם דניאל מחר בשש')).toMatchObject({
      intent: 'CREATE',
      title: 'פגישה עם דניאל',
      date: TOMORROW,
      missing: ['duration'],
      ambiguities: [
        { slot: 'startTime', candidates: ['06:00', '18:00'], question: 'בבוקר או בערב?' },
      ],
    });
  });

  it('שים לי חוג כדורגל מחר בחמש לשעה', () => {
    const parsed = parse('שים לי חוג כדורגל מחר בחמש לשעה');
    expect(parsed).toMatchObject({
      intent: 'CREATE',
      title: 'חוג כדורגל',
      date: TOMORROW,
      durationMinutes: 60,
    });
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.ambiguities[0]?.candidates).toEqual(['05:00', '17:00']);
  });

  it('תקבע לי ארוחת ערב עם חברים ביום שישי בשמונה לשעתיים', () => {
    const parsed = parse('תקבע לי ארוחת ערב עם חברים ביום שישי בשמונה לשעתיים');
    expect(parsed).toMatchObject({
      intent: 'CREATE',
      title: 'ארוחת ערב עם חברים',
      date: '2026-09-18',
      durationMinutes: 120,
    });
    expect(parsed.ambiguities[0]?.candidates).toEqual(['08:00', '20:00']);
  });

  it('שים לי פגישה ביום ראשון ב-10 בבוקר עד 11', () => {
    expect(parse('שים לי פגישה ביום ראשון ב-10 בבוקר עד 11')).toMatchObject({
      intent: 'CREATE',
      title: 'פגישה',
      date: '2026-09-13',
      startTime: '10:00',
      endTime: '11:00',
      durationMinutes: 60,
      missing: [],
      ambiguities: [],
    });
  });

  it('תקבע לי אימון מחר בשעה 17:00', () => {
    expect(parse('תקבע לי אימון מחר בשעה 17:00')).toMatchObject({
      intent: 'CREATE',
      title: 'אימון',
      date: TOMORROW,
      startTime: '17:00',
      missing: ['duration'],
      ambiguities: [],
    });
  });

  it('בטל את הפגישה עם דניאל מחר', () => {
    expect(parse('בטל את הפגישה עם דניאל מחר')).toMatchObject({
      intent: 'DELETE',
      title: 'הפגישה עם דניאל',
      date: TOMORROW,
      missing: [],
    });
  });

  it('העבר את הפגישה עם דניאל למחר בשמונה', () => {
    const parsed = parse('העבר את הפגישה עם דניאל למחר בשמונה');
    expect(parsed).toMatchObject({
      intent: 'UPDATE',
      title: 'הפגישה עם דניאל',
      date: TOMORROW,
    });
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.ambiguities[0]?.candidates).toEqual(['08:00', '20:00']);
  });

  it('את הפגישה עם דניאל מחר תעביר לשמונה', () => {
    const parsed = parse('את הפגישה עם דניאל מחר תעביר לשמונה');
    expect(parsed.intent).toBe('UPDATE');
    expect(parsed.title).toBe('הפגישה עם דניאל');
    expect(parsed.date).toBe(TOMORROW);
  });

  it('מה יש לי מחר?', () => {
    expect(parse('מה יש לי מחר?')).toMatchObject({
      intent: 'QUERY',
      date: TOMORROW,
      missing: [],
    });
  });

  it('אני פנוי מחר בשש?', () => {
    const parsed = parse('אני פנוי מחר בשש?');
    expect(parsed.intent).toBe('QUERY');
    expect(parsed.date).toBe(TOMORROW);
    expect(parsed.ambiguities[0]?.candidates).toEqual(['06:00', '18:00']);
  });

  it('מצא לי שעה פנויה של שעתיים מחר', () => {
    expect(parse('מצא לי שעה פנויה של שעתיים מחר')).toMatchObject({
      intent: 'FIND_FREE',
      date: TOMORROW,
      durationMinutes: 120,
    });
  });

  it('מה יש לי ביום שישי?', () => {
    expect(parse('מה יש לי ביום שישי?')).toMatchObject({
      intent: 'QUERY',
      date: '2026-09-18',
    });
  });
});

describe('purity', () => {
  it('is deterministic for the same input and clock', () => {
    const text = 'תקבע לי פגישה עם דניאל מחר בשש';
    expect(parse(text)).toEqual(parse(text));
  });

  it('depends on the injected clock rather than the system clock', () => {
    const text = 'תקבע לי פגישה מחר בשעה 17:00';
    const a = parseCommand(text, fixedClock('2026-09-13T09:00:00Z'));
    const b = parseCommand(text, fixedClock('2030-01-31T09:00:00Z'));
    expect(a.date).toBe('2026-09-14');
    expect(b.date).toBe('2030-02-01');
  });

  it('preserves the raw and normalized text', () => {
    const parsed = parse('  תקבע   לי פגישה מחר  ');
    expect(parsed.rawText).toBe('  תקבע   לי פגישה מחר  ');
    expect(parsed.normalizedText).toBe('תקבע לי פגישה מחר');
  });

  it('handles empty input without throwing', () => {
    const parsed = parse('');
    expect(parsed.intent).toBe('UNKNOWN');
    expect(parsed.ambiguities).toEqual([]);
    expect(parsed.confidence).toBeLessThan(0.3);
  });

  it('handles gibberish without throwing', () => {
    expect(() => parse('אבגדהוז חטי כלמ')).not.toThrow();
  });
});

describe('confidence', () => {
  it('scores a complete command higher than a bare one', () => {
    const complete = parse('תקבע לי פגישה עם דניאל מחר בשש בערב לשעה').confidence;
    const bare = parse('תקבע לי פגישה').confidence;
    expect(complete).toBeGreaterThan(bare);
  });

  it('scores an unrecognised command low', () => {
    expect(parse('שלום מה שלומך').confidence).toBeLessThan(0.4);
  });
});
