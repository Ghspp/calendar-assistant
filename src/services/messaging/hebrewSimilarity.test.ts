/**
 * Hebrew name similarity.
 *
 * The threshold is the whole design here, so most of these tests are about what must
 * NOT match. Two edits apart is the distance between `יוסי` and `רותי` — different
 * people — so a budget generous enough to forgive a mishearing on a short name would
 * also merge two real contacts.
 */

import { describe, expect, it } from 'vitest';
import { allowedEdits, editDistance, foldHebrew, nameDistance } from './hebrewSimilarity';

describe('foldHebrew', () => {
  it.each([
    ['דן', 'דנ'],
    ['אברהם', 'אברהמ'],
    ['יוסף', 'יוספ'],
    ['בן', 'בנ'],
  ])('folds the final letter of %s', (input, expected) => {
    expect(foldHebrew(input)).toBe(expected);
  });

  it('collapses the doubled letters the transcriber is inconsistent about', () => {
    expect(foldHebrew('דויד')).toBe(foldHebrew('דויד'));
    expect(foldHebrew('אוולין')).toBe(foldHebrew('אולינ'));
    expect(foldHebrew('אייל')).toBe(foldHebrew('איל'));
  });

  it('removes spaces, because a split name is still one name', () => {
    expect(foldHebrew('דני אל')).toBe(foldHebrew('דניאל'));
  });
});

describe('editDistance', () => {
  it.each([
    ['', '', 0],
    ['אבג', 'אבג', 0],
    ['דניאל', 'דניאלה', 1],
    ['יוסי', 'רותי', 2],
    ['אבג', '', 3],
  ])('%s → %s is %i', (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected);
  });

  it('is symmetric', () => {
    expect(editDistance('דניאל', 'דניאלה')).toBe(editDistance('דניאלה', 'דניאל'));
  });
});

describe('the budget', () => {
  it('forgives nothing on a very short name', () => {
    // 'דן' and 'רן' are one edit apart and are two different people.
    expect(allowedEdits(3)).toBe(0);
    expect(nameDistance('דן', 'רן')).toBeUndefined();
  });

  it('forgives one edit on a middling name', () => {
    expect(allowedEdits(5)).toBe(1);
  });

  it('forgives two on a long one', () => {
    expect(allowedEdits(8)).toBe(2);
  });
});

describe('nameDistance', () => {
  it.each([
    ['דניאל', 'דניאלה'],
    ['אברהם', 'אברהמי'],
    ['דניאל', 'דני אל'],
    ['מיכאל', 'מיכאל'],
  ])('accepts %s ≈ %s', (a, b) => {
    expect(nameDistance(a, b)).toBeDefined();
  });

  it.each([
    ['יוסי', 'רותי'],
    ['דני כהן', 'דני לוי'],
    ['אמא', 'אבא'],
    ['דניאל', 'רותי'],
    ['דן', 'רן'],
  ])('REFUSES %s vs %s — different people', (a, b) => {
    expect(nameDistance(a, b)).toBeUndefined();
  });

  it('scores an exact fold as zero', () => {
    expect(nameDistance('דניאל', 'דני אל')).toBe(0);
  });

  it('refuses an empty name rather than matching everything', () => {
    expect(nameDistance('', 'דניאל')).toBeUndefined();
    expect(nameDistance('דניאל', '   ')).toBeUndefined();
  });
});
