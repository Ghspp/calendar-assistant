/**
 * Matching an event by the name the user used.
 *
 * Pure. Deliberately forgiving about Hebrew's definite article and particles, because
 * people ask about 'הפגישה עם דניאל' for an event actually titled 'פגישה עם דניאל'.
 *
 * Reuses the parser's tokenizer so prefix stripping behaves identically here and there
 * rather than being reimplemented with subtly different rules.
 */

import type { CalendarEvent } from '../../types/calendar';
import { TITLE_FILLERS } from '../parser/lexicon';
import { normalizeText, tokenize } from '../parser/normalize';

/** Every reading of every token, so 'הפגישה' also counts as 'פגישה'. */
function stemsOf(text: string): Set<string> {
  const stems = new Set<string>();
  for (const token of tokenize(normalizeText(text))) {
    for (const form of token.forms) {
      if (form.stem.length > 0) stems.add(form.stem);
    }
  }
  return stems;
}

/** The meaningful words of a query — fillers and one-letter leftovers dropped. */
function queryTerms(query: string): string[] {
  const terms: string[] = [];
  for (const token of tokenize(normalizeText(query))) {
    if (TITLE_FILLERS.has(token.raw)) continue;
    if (token.raw.length < 2) continue;
    terms.push(token.raw);
  }
  return terms;
}

/**
 * True when every meaningful word of the query appears somewhere in the title.
 *
 * Requiring ALL terms rather than any keeps 'הפגישה עם דניאל' from matching every
 * meeting on the calendar.
 */
export function titleMatches(eventTitle: string, query: string): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return false;

  const titleStems = stemsOf(eventTitle);

  return terms.every((term) => {
    const termStems = stemsOf(term);
    for (const stem of termStems) {
      if (titleStems.has(stem)) return true;
    }
    return false;
  });
}

/** Events whose title matches, in the order given. */
export function findEventsByTitle(
  events: readonly CalendarEvent[],
  query: string,
): CalendarEvent[] {
  return events.filter((event) => titleMatches(event.title, query));
}
