/**
 * Reading an UPDATE command.
 *
 * Pure. Works from the output of the ordinary parser rather than extending it, because
 * an update has a shape no other command has: it names an EXISTING event and then says
 * what about it should change.
 *
 * Three changes are recognised:
 *
 *   move       "תעביר את הפגישה עם דניאל מחר לשמונה בערב"
 *   retitle    "תשנה את הפגישה עם דניאל מחר לפגישה עם אברהם"
 *   substitute "תשנה את הפגישה מחר מדניאל לאברהם"
 *
 * The move case needs no work here: the ordinary time parser already consumed the new
 * hour, so whatever title is left over is the target.
 */

import type { Ambiguity, ParsedCommand } from '../../types/parser';
import { normalizeText, tokenize } from '../parser/normalize';

export type UpdateChange =
  | { kind: 'move'; startTime?: string; ambiguity?: Ambiguity; durationMinutes?: number }
  | { kind: 'retitle'; newTitle: string }
  | { kind: 'substitute'; from: string; to: string }
  /** Replace the matching part of the title: 'שתהיה עם אברהם'. */
  | { kind: 'replace-tail'; tail: string }
  | { kind: 'unclear' };

export interface UpdateRequest {
  /** The name to look for on the calendar. */
  target: string;
  /** Narrows the search to one day, when the user said which. */
  targetDate?: string;
  change: UpdateChange;
}

/** Strip a leading particle from a token, for reading the word behind it. */
function withoutPrefix(raw: string, particle: string): string | undefined {
  const tokens = tokenize(raw);
  const token = tokens[0];
  if (token === undefined) return undefined;

  for (const form of token.forms) {
    if (form.prefix === particle && form.stem.length >= 2) return form.stem;
  }
  return undefined;
}

/**
 * Split a leftover title on a 'ל' particle: 'הפגישה עם דניאל לפגישה עם אברהם'.
 *
 * The first such token starts the replacement, and everything before it names the
 * event. A one-letter stem is ignored so 'לי' and similar cannot split a phrase.
 */
function splitOnLamed(
  title: string,
): { before: string; after: string } | undefined {
  const words = normalizeText(title).split(' ').filter((word) => word.length > 0);

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === undefined) continue;

    const stem = withoutPrefix(word, 'ל');
    if (stem === undefined) continue;

    const before = words.slice(0, index).join(' ');
    const after = [stem, ...words.slice(index + 1)].join(' ');
    if (before.length === 0 || after.length === 0) continue;

    return { before, after };
  }

  return undefined;
}

/** Words that introduce the new state of the event: 'שתהיה עם אברהם'. */
const BECOMES_MARKERS = new Set(['תהיה', 'יהיה', 'שתהיה', 'שיהיה']);

/**
 * Find 'שתהיה <tail>' — 'תשנה את הפגישה עם דניאל שתהיה עם אברהם'.
 *
 * The tail replaces the matching part of the title rather than all of it: the first
 * word of the tail ('עם') is looked up in the existing title and everything from there
 * is swapped, so 'פגישה עם דניאל' becomes 'פגישה עם אברהם' and not just 'עם אברהם'.
 */
function findBecomes(title: string): { target: string; tail: string } | undefined {
  const words = normalizeText(title).split(' ').filter((word) => word.length > 0);

  for (let index = 1; index < words.length - 1; index += 1) {
    const word = words[index];
    if (word === undefined) continue;

    const tokens = tokenize(word);
    const token = tokens[0];
    const isMarker =
      token !== undefined &&
      token.forms.some((form) => BECOMES_MARKERS.has(form.stem) || BECOMES_MARKERS.has(word));
    if (!isMarker) continue;

    const target = words.slice(0, index).join(' ');
    const tail = words.slice(index + 1).join(' ');
    if (target.length === 0 || tail.length === 0) continue;

    return { target, tail };
  }

  return undefined;
}

/**
 * Find 'במקום X … Y' — 'במקום דניאל תשים אברהם'.
 *
 * The word after 'במקום' is what goes, and the last word of the utterance is what
 * replaces it; anything in between is a verb or filler.
 */
function findInsteadOf(
  title: string,
  fullText: string,
): { target: string; from: string; to: string } | undefined {
  const words = normalizeText(title).split(' ').filter((word) => word.length > 0);

  const hasMarker = (word: string): boolean => {
    const token = tokenize(word)[0];
    return token !== undefined && token.forms.some((form) => form.stem === 'מקום');
  };

  const markerIndex = words.findIndex(hasMarker);

  if (markerIndex !== -1) {
    const from = words[markerIndex + 1];
    const to = words[words.length - 1];
    if (from === undefined || to === undefined || from === to) return undefined;
    return { target: words.slice(0, markerIndex).join(' '), from, to };
  }

  // 'במקום' can be the very first word, in which case it was consumed as the intent
  // and never reaches the leftover title. The command then names no event, so the word
  // being replaced doubles as the thing to search for.
  const startsWithMarker = normalizeText(fullText)
    .split(' ')
    .slice(0, 1)
    .some(hasMarker);
  if (!startsWithMarker) return undefined;

  const from = words[0];
  const to = words[words.length - 1];
  if (from === undefined || to === undefined || from === to) return undefined;

  return { target: from, from, to };
}

/** Find a 'מ…' / 'ל…' pair: 'מדניאל לאברהם'. */
function findSubstitution(
  title: string,
): { target: string; from: string; to: string } | undefined {
  const words = normalizeText(title).split(' ').filter((word) => word.length > 0);

  for (let index = 0; index < words.length - 1; index += 1) {
    const fromWord = words[index];
    const toWord = words[index + 1];
    if (fromWord === undefined || toWord === undefined) continue;

    const from = withoutPrefix(fromWord, 'מ');
    const to = withoutPrefix(toWord, 'ל');
    if (from === undefined || to === undefined) continue;

    const target = words.slice(0, index).join(' ');
    return { target, from, to };
  }

  return undefined;
}

/**
 * Work out what the user wants changed.
 *
 * Order matters: a new time wins over any textual reading, because 'תעביר את הפגישה
 * לשמונה' is unambiguously a move and must never be read as a rename to "שמונה".
 */
export function parseUpdate(parsed: ParsedCommand): UpdateRequest | undefined {
  if (parsed.intent !== 'UPDATE') return undefined;

  const ambiguity = parsed.ambiguities.find((item) => item.slot === 'startTime');
  const hasNewTime = parsed.startTime !== undefined || ambiguity !== undefined;

  if (hasNewTime) {
    return {
      target: parsed.title ?? '',
      ...(parsed.date !== undefined ? { targetDate: parsed.date } : {}),
      change: {
        kind: 'move',
        ...(parsed.startTime !== undefined ? { startTime: parsed.startTime } : {}),
        ...(ambiguity !== undefined ? { ambiguity } : {}),
        ...(parsed.durationMinutes !== undefined
          ? { durationMinutes: parsed.durationMinutes }
          : {}),
      },
    };
  }

  const title = parsed.title;
  if (title === undefined || title.trim().length === 0) {
    return { target: '', change: { kind: 'unclear' } };
  }

  // 'במקום דניאל … אברהם' — an explicit replacement.
  const insteadOf = findInsteadOf(title, parsed.normalizedText);
  if (insteadOf !== undefined) {
    return {
      target: insteadOf.target.length > 0 ? insteadOf.target : insteadOf.from,
      ...(parsed.date !== undefined ? { targetDate: parsed.date } : {}),
      change: { kind: 'substitute', from: insteadOf.from, to: insteadOf.to },
    };
  }

  // 'הפגישה עם דניאל שתהיה עם אברהם' — the tail of the title is replaced.
  const becomes = findBecomes(title);
  if (becomes !== undefined) {
    return {
      target: becomes.target,
      ...(parsed.date !== undefined ? { targetDate: parsed.date } : {}),
      change: { kind: 'replace-tail', tail: becomes.tail },
    };
  }

  // 'מדניאל לאברהם' — a swap inside the existing title.
  const substitution = findSubstitution(title);
  if (substitution !== undefined && substitution.target.length > 0) {
    return {
      target: substitution.target,
      ...(parsed.date !== undefined ? { targetDate: parsed.date } : {}),
      change: { kind: 'substitute', from: substitution.from, to: substitution.to },
    };
  }

  // 'הפגישה עם דניאל לפגישה עם אברהם' — a wholesale rename.
  const split = splitOnLamed(title);
  if (split !== undefined) {
    return {
      target: split.before,
      ...(parsed.date !== undefined ? { targetDate: parsed.date } : {}),
      change: { kind: 'retitle', newTitle: split.after },
    };
  }

  // A target with nothing said about what to change.
  return {
    target: title,
    ...(parsed.date !== undefined ? { targetDate: parsed.date } : {}),
    change: { kind: 'unclear' },
  };
}

/**
 * Apply a substitution to an existing title.
 *
 * Matches whole words only, so replacing 'דן' cannot corrupt 'דניאל'. Returns
 * undefined when the word is not there, which the caller reports rather than writing
 * an unchanged title back to the calendar.
 */
export function applySubstitution(
  currentTitle: string,
  from: string,
  to: string,
): string | undefined {
  const words = normalizeText(currentTitle).split(' ');
  let replaced = false;

  const next = words.map((word) => {
    // Compare against every reading, so 'לדניאל' and 'דניאל' both match.
    const tokens = tokenize(word);
    const token = tokens[0];
    const matches =
      token !== undefined && token.forms.some((form) => form.stem === from);

    if (!matches || replaced) return word;
    replaced = true;

    // Keep whatever particle the original carried: 'לדניאל' becomes 'לאברהם'.
    const form = token?.forms.find((candidate) => candidate.stem === from);
    return form !== undefined && form.prefix.length > 0 ? `${form.prefix}${to}` : to;
  });

  return replaced ? next.join(' ') : undefined;
}

/**
 * Replace the tail of a title from the first word of `tail` onwards.
 *
 * 'פגישה עם דניאל' + 'עם אברהם' → 'פגישה עם אברהם'.
 * Returns undefined when the anchor word is not in the title, which the caller reports
 * rather than guessing at what the user meant.
 */
export function applyTailReplacement(
  currentTitle: string,
  tail: string,
): string | undefined {
  const tailWords = tail.split(' ').filter((word) => word.length > 0);
  const anchor = tailWords[0];
  if (anchor === undefined) return undefined;

  const words = normalizeText(currentTitle).split(' ').filter((word) => word.length > 0);
  const index = words.lastIndexOf(anchor);
  if (index === -1) return undefined;

  return [...words.slice(0, index), ...tailWords].join(' ');
}
