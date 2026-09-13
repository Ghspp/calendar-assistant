import { describe, expect, it } from 'vitest';
import { normalizeText, tokenize } from './normalize';

function stems(text: string, tokenIndex: number): string[] {
  const token = tokenize(normalizeText(text))[tokenIndex];
  return token === undefined ? [] : token.forms.map((form) => form.stem);
}

describe('normalizeText', () => {
  it('strips niqqud', () => {
    expect(normalizeText('פְּגִישָׁה')).toBe('פגישה');
  });

  it('normalizes maqaf and dashes to a plain hyphen', () => {
    expect(normalizeText('ב־6')).toBe('ב-6');
    expect(normalizeText('ל–30')).toBe('ל-30');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeText('  תקבע   לי   פגישה  ')).toBe('תקבע לי פגישה');
  });

  it('lowercases Latin so PM and pm are one thing', () => {
    expect(normalizeText('5 PM')).toBe('5 pm');
  });

  it('removes bidi control characters', () => {
    expect(normalizeText('‏מחר‎')).toBe('מחר');
  });

  it('leaves an already-clean command untouched', () => {
    expect(normalizeText('תקבע לי פגישה עם דניאל מחר בשש')).toBe(
      'תקבע לי פגישה עם דניאל מחר בשש',
    );
  });
});

describe('tokenize', () => {
  it('strips edge punctuation but keeps the colon inside a time', () => {
    const tokens = tokenize(normalizeText('מה יש לי מחר?'));
    expect(tokens.map((token) => token.raw)).toEqual(['מה', 'יש', 'לי', 'מחר']);
    expect(tokenize('ב-17:00.')[0]?.raw).toBe('ב-17:00');
  });

  it('records character offsets into the normalized string', () => {
    const tokens = tokenize('תקבע לי פגישה');
    expect(tokens[1]?.start).toBe(5);
    expect(tokens[2]?.start).toBe(8);
  });
});

describe('prefix stripping', () => {
  it('peels ב off an hour word', () => {
    expect(stems('בשש', 0)).toContain('שש');
  });

  it('peels ל off a duration', () => {
    expect(stems('לשעתיים', 0)).toContain('שעתיים');
  });

  it('peels ב off יום', () => {
    expect(stems('ביום', 0)).toContain('יום');
  });

  it('peels a particle attached with a hyphen', () => {
    expect(stems('ב-6', 0)).toContain('6');
    expect(stems('ל-30', 0)).toContain('30');
  });

  it('always offers the untouched token first', () => {
    // This ordering is what stops 'מחר' being read as מ + 'חר'.
    expect(stems('מחר', 0)[0]).toBe('מחר');
    expect(stems('שים', 0)[0]).toBe('שים');
    expect(stems('היום', 0)[0]).toBe('היום');
  });

  it('peels at most two particles', () => {
    expect(stems('כשהילד', 0).length).toBeLessThanOrEqual(3);
  });

  it('does not strip a particle that would leave nothing behind', () => {
    expect(stems('ב', 0)).toEqual(['ב']);
  });
});
