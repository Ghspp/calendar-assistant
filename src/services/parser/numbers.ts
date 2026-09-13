/**
 * Numeral reading, shared by the time and duration parsers.
 *
 * Handles digits ('6', 'ב-6'), single-token words ('שש') and two-token words
 * ('שתים עשרה'). Two-token forms are tried first so 'שתים' is not read as 2 when it
 * is really the start of 12.
 */

import { NUMBER_WORDS, NUMBER_WORD_PAIRS } from './lexicon';
import { tokenAt, type Token } from './normalize';

export interface NumberMatch {
  value: number;
  /** Index just past the tokens consumed. */
  nextIndex: number;
}

const DIGITS_ONLY = /^\d{1,4}$/;

/** Digit reading of a token, honouring prefixes so 'ב-30' and 'ל30' both work. */
export function readDigits(token: Token): number | undefined {
  for (const form of token.forms) {
    if (DIGITS_ONLY.test(form.stem)) return Number.parseInt(form.stem, 10);
  }
  return undefined;
}

export function readNumber(tokens: Token[], index: number): NumberMatch | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  // Two-token numerals: 'אחת עשרה', 'שתים עשרה'.
  const second = tokenAt(tokens, index + 1);
  if (second !== undefined) {
    for (const pair of NUMBER_WORD_PAIRS) {
      const [first, tail] = pair.words;
      const firstMatches = token.forms.some((form) => form.stem === first);
      const tailMatches = second.forms.some((form) => form.stem === tail);
      if (firstMatches && tailMatches) {
        return { value: pair.value, nextIndex: index + 2 };
      }
    }
  }

  const digits = readDigits(token);
  if (digits !== undefined) return { value: digits, nextIndex: index + 1 };

  for (const form of token.forms) {
    const word = NUMBER_WORDS.get(form.stem);
    if (word !== undefined) return { value: word, nextIndex: index + 1 };
  }

  return undefined;
}
