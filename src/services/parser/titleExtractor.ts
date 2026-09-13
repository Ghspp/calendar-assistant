/**
 * Title extraction.
 *
 * The title is simply what nobody else claimed. Every matcher records the token indices
 * it consumed; what is left, minus a short filler list, is the event title. This is why
 * 'תקבע לי פגישה עם דניאל מחר בשש' yields exactly 'פגישה עם דניאל' — the verb, 'לי',
 * the date and the hour were all consumed by their own matchers.
 */

import { TITLE_FILLERS } from './lexicon';
import { type Token } from './normalize';

export function extractTitle(tokens: Token[], consumed: ReadonlySet<number>): string | undefined {
  const words: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (consumed.has(index)) continue;

    const token = tokens[index];
    if (token === undefined) continue;
    if (TITLE_FILLERS.has(token.raw)) continue;

    words.push(token.raw);
  }

  const title = words.join(' ').trim();
  return title.length > 0 ? title : undefined;
}
