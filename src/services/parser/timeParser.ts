/**
 * Hebrew clock-time expressions.
 *
 * THE CENTRAL RULE OF THIS MODULE: the parser never infers AM/PM.
 *
 * An hour is resolved only when the input says so outright:
 *   1. explicit 24-hour notation — an hour of 13-23 or 0 ('ב-19'), or zero-padded
 *      HH:mm clock notation at any hour ('17:00', '09:00', '12:00')
 *   2. a day-part qualifier immediately after it — '8 בערב', '10 בבוקר'
 *   3. a Latin meridiem — '5 pm'
 *
 * Everything else — 'בשש', 'בשמונה', 'ב-6', '6:30', 'בשתים עשרה' — is reported as
 * AMBIGUOUS with both readings and no resolved value. There is no waking-hours
 * heuristic, no evening bias and no "most likely" fallback anywhere in this file.
 */

import {
  CONSTRUCT_HEADS,
  DAY_PARTS,
  DAY_PART_PHRASES,
  DURATION_UNITS,
  END_TIME_MARKERS,
  FIXED_DURATIONS,
  HOUR_FRACTIONS,
  HOUR_MARKER_STEM,
  type DayPart,
} from './lexicon';
import { hasAnyStem, hasStem, matchPhrase, tokenAt, type Token } from './normalize';
import { readNumber } from './numbers';

export interface TimeExpression {
  /** Both readings when ambiguous, a single entry when resolved. Ascending. */
  candidates: string[];
  /** HH:mm. Present only when the input resolved the hour outright. */
  resolved?: string;
  /** True when introduced by 'עד'. */
  isEnd: boolean;
  tokens: number[];
}

/** Prefixes that may introduce a clock time: 'בשעה 17:00', 'לשעה 8'. */
const HOUR_MARKER_PREFIXES = new Set(['ב', 'ל']);

/** Particles that mark a day-part word as a real time qualifier rather than a noun. */
const QUALIFIER_PREFIXES = new Set(['ב', 'ה']);

const HH_MM = /^(\d{1,2}):(\d{2})$/;

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * Convert a 1-12 hour to 24-hour form under a given day part.
 *
 * Exported so the conversation layer can resolve an ambiguity from a one-word answer
 * ('בערב') using exactly the same rules as an inline qualifier, rather than a second
 * implementation that could drift.
 */
export function applyDayPart(hour12: number, part: DayPart): number {
  switch (part) {
    case 'morning':
      return hour12 === 12 ? 12 : hour12;
    case 'noon':
      if (hour12 === 12) return 12;
      return hour12 >= 1 && hour12 <= 4 ? hour12 + 12 : hour12;
    case 'afternoon':
      return hour12 === 12 ? 12 : hour12 + 12;
    case 'evening':
      return hour12 === 12 ? 0 : hour12 + 12;
    case 'night':
      if (hour12 === 12) return 0;
      return hour12 >= 6 ? hour12 + 12 : hour12;
  }
}

interface DayPartMatch {
  part: DayPart;
  nextIndex: number;
}

/**
 * A day-part qualifier sitting BEFORE the hour: 'הערב בשמונה', 'מחר בבוקר ב-9'.
 *
 * People say it this way constantly, but reading any preceding word as a qualifier
 * would break 'ארוחת ערב ב-8'. Two guards make it safe:
 *
 *   1. It must carry a ב or ה particle. The 'ערב' of 'ארוחת ערב' is bare.
 *   2. It must not follow a construct head, which rules out 'ארוחת הערב'.
 *
 * Anything that fails either guard stays in the title and the hour stays ambiguous —
 * the safe direction, since the assistant then asks rather than guesses.
 */
function readPrecedingDayPart(
  tokens: Token[],
  hourIndex: number,
): { part: DayPart; tokenIndex: number } | undefined {
  const index = hourIndex - 1;
  if (index < 0) return undefined;

  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  let part: DayPart | undefined;
  for (const form of token.forms) {
    if (!QUALIFIER_PREFIXES.has(form.prefix)) continue;
    const candidate = DAY_PARTS.get(form.stem);
    if (candidate !== undefined) {
      part = candidate;
      break;
    }
  }
  if (part === undefined) return undefined;

  const before = tokenAt(tokens, index - 1);
  if (before !== undefined && CONSTRUCT_HEADS.has(before.raw)) return undefined;

  return { part, tokenIndex: index };
}

/**
 * A day-part qualifier at `index`.
 *
 * Callers only ever look for one IMMEDIATELY AFTER an hour. That adjacency requirement
 * is what keeps 'ארוחת ערב' (dinner) intact: its 'ערב' never follows an hour, so it is
 * never eaten as an evening qualifier and stays in the title.
 */
export function readDayPart(tokens: Token[], index: number): DayPartMatch | undefined {
  for (const phrase of DAY_PART_PHRASES) {
    const end = matchPhrase(tokens, index, phrase.words);
    if (end !== undefined) return { part: phrase.part, nextIndex: end };
  }

  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  for (const form of token.forms) {
    const part = DAY_PARTS.get(form.stem);
    if (part !== undefined) return { part, nextIndex: index + 1 };
  }

  return undefined;
}

function readMeridiem(tokens: Token[], index: number): 'am' | 'pm' | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;
  if (token.raw === 'am' || token.raw === 'a.m') return 'am';
  if (token.raw === 'pm' || token.raw === 'p.m') return 'pm';
  return undefined;
}

/**
 * True when the token at `index` is a bare duration unit ('שעות', 'דקות').
 *
 * Used to stop 'לשלוש שעות' (for three hours) being read as the time 3:00. The unit
 * must be BARE: in 'בחמש לשעה' the 'לשעה' carries a ל particle that starts a new
 * duration phrase, so it is not the unit of the preceding hour.
 */
function isBareDurationUnit(tokens: Token[], index: number): boolean {
  const token = tokenAt(tokens, index);
  if (token === undefined) return false;
  const bare = token.forms[0];
  if (bare === undefined) return false;
  return DURATION_UNITS.has(bare.stem) || FIXED_DURATIONS.has(bare.stem);
}

interface RawTime {
  /** 24-hour value when `resolved`, otherwise the raw 1-12 reading. */
  hour: number;
  minute: number;
  resolved: boolean;
  tokens: number[];
}

/** Parse a clock time starting exactly at `index`, or fail. */
function parseTimeAt(tokens: Token[], index: number, allowPreceding = true): RawTime | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  const used: number[] = [];
  let hour: number | undefined;
  let minute = 0;
  let cursor = index;
  /** True when the written form already fixes the 24-hour value. */
  let explicit = false;
  /** True when the hour was written as zero-padded HH:mm clock notation. */
  let notation24 = false;

  // 'רבע לשש' — a quarter to six.
  const quarterTo = readQuarterTo(tokens, index);
  if (quarterTo !== undefined) {
    hour = quarterTo.hour;
    minute = 45;
    cursor = quarterTo.nextIndex;
    for (let i = index; i < cursor; i += 1) used.push(i);
  } else {
    // 'HH:MM'
    const clock = readClockDigits(token);
    if (clock !== undefined) {
      hour = clock.hour;
      minute = clock.minute;
      notation24 = clock.zeroPadded;
      cursor = index + 1;
      used.push(index);
    } else {
      // A plain numeral, unless it is really a duration count.
      const numeral = readNumber(tokens, index);
      if (numeral === undefined) return undefined;
      if (isBareDurationUnit(tokens, numeral.nextIndex)) return undefined;

      hour = numeral.value;
      cursor = numeral.nextIndex;
      for (let i = index; i < cursor; i += 1) used.push(i);

      // 'שש וחצי' / 'שש ורבע'
      const fraction = readFraction(tokens, cursor);
      if (fraction !== undefined) {
        minute = fraction.minutes;
        cursor = fraction.nextIndex;
        used.push(cursor - 1);
      }
    }
  }

  if (hour === undefined || hour > 23 || hour < 0 || minute > 59) return undefined;

  // Rule 1: an explicit 24-hour value needs no interpretation. That covers an hour of
  // 13-23 or 0, and also zero-padded HH:mm clock notation at any hour — '09:00' and
  // '12:00' are unambiguous in a way that a spoken 'בתשע' or 'בשתים עשרה' is not.
  if (hour === 0 || hour >= 13 || notation24) explicit = true;

  if (explicit) {
    // The hour is already settled, but a redundant qualifier ('09:00 בבוקר') must still
    // be consumed so it does not survive into the event title.
    const redundantDayPart = readDayPart(tokens, cursor);
    if (redundantDayPart !== undefined) {
      for (let i = cursor; i < redundantDayPart.nextIndex; i += 1) used.push(i);
      cursor = redundantDayPart.nextIndex;
    } else if (readMeridiem(tokens, cursor) !== undefined) {
      used.push(cursor);
      cursor += 1;
    }
  } else {
    // Rule 2: a day-part qualifier immediately after the hour.
    const dayPart = readDayPart(tokens, cursor);
    if (dayPart !== undefined) {
      hour = applyDayPart(hour, dayPart.part);
      for (let i = cursor; i < dayPart.nextIndex; i += 1) used.push(i);
      cursor = dayPart.nextIndex;
      explicit = true;
    } else {
      // Rule 3: a Latin meridiem.
      const meridiem = readMeridiem(tokens, cursor);
      if (meridiem === 'am') {
        hour = hour === 12 ? 0 : hour;
        used.push(cursor);
        explicit = true;
      } else if (meridiem === 'pm') {
        hour = hour === 12 ? 12 : hour + 12;
        used.push(cursor);
        explicit = true;
      }
    }

    // Rule 2b: a qualifier that came BEFORE the hour, as in 'הערב בשמונה'.
    if (!explicit && allowPreceding) {
      const preceding = readPrecedingDayPart(tokens, index);
      if (preceding !== undefined) {
        hour = applyDayPart(hour, preceding.part);
        used.push(preceding.tokenIndex);
        explicit = true;
      }
    }
  }

  return { hour, minute, resolved: explicit, tokens: used };
}

function readClockDigits(
  token: Token,
): { hour: number; minute: number; zeroPadded: boolean } | undefined {
  for (const form of token.forms) {
    const match = HH_MM.exec(form.stem);
    if (match === null) continue;
    const hourText = match[1];
    const minuteText = match[2];
    if (hourText === undefined || minuteText === undefined) continue;
    return {
      hour: Number.parseInt(hourText, 10),
      minute: Number.parseInt(minuteText, 10),
      // A two-digit hour is 24-hour clock notation: '09:00' is nine in the morning.
      // A one-digit hour is not: '6:30' is still just "six thirty".
      zeroPadded: hourText.length === 2,
    };
  }
  return undefined;
}

function readFraction(
  tokens: Token[],
  index: number,
): { minutes: number; nextIndex: number } | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  for (const form of token.forms) {
    // Must be joined by ו — 'וחצי', 'ורבע'. A bare 'חצי' is part of a duration.
    if (form.prefix !== 'ו') continue;
    const minutes = HOUR_FRACTIONS.get(form.stem);
    if (minutes !== undefined) return { minutes, nextIndex: index + 1 };
  }

  return undefined;
}

/** 'רבע ל<hour>' — quarter to the hour. */
function readQuarterTo(
  tokens: Token[],
  index: number,
): { hour: number; nextIndex: number } | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  const bare = token.forms[0];
  if (bare === undefined || bare.stem !== 'רבע') return undefined;

  const next = tokenAt(tokens, index + 1);
  if (next === undefined) return undefined;
  // The hour must carry the ל particle: 'רבע לשש'.
  if (!next.forms.some((form) => form.prefix === 'ל')) return undefined;

  const numeral = readNumber(tokens, index + 1);
  if (numeral === undefined || numeral.value < 1 || numeral.value > 12) return undefined;

  const hour = numeral.value === 1 ? 12 : numeral.value - 1;
  return { hour, nextIndex: numeral.nextIndex };
}

function toExpression(time: RawTime, isEnd: boolean, extraTokens: number[]): TimeExpression {
  const tokens = [...extraTokens, ...time.tokens].sort((a, b) => a - b);

  if (time.resolved) {
    const value = formatTime(time.hour, time.minute);
    return { candidates: [value], resolved: value, isEnd, tokens };
  }

  // Ambiguous: emit both readings, ascending, and resolve nothing.
  const morning = time.hour === 12 ? 0 : time.hour;
  const evening = time.hour === 12 ? 12 : time.hour + 12;
  const candidates = [formatTime(morning, time.minute), formatTime(evening, time.minute)].sort();

  return { candidates, isEnd, tokens };
}

/** The Hebrew question to ask for an unresolved hour. */
export function questionFor(candidates: string[]): string {
  return candidates.includes('00:00') || candidates.some((value) => value.startsWith('00:'))
    ? 'בצהריים או בחצות?'
    : 'בבוקר או בערב?';
}

/**
 * Collect every clock-time expression in the command, in order.
 *
 * Expressions introduced by 'עד' are flagged as end times; the first of the rest is
 * the start time.
 */
export function findTimes(tokens: Token[], consumed: ReadonlySet<number>): TimeExpression[] {
  const found: TimeExpression[] = [];
  let index = 0;

  while (index < tokens.length) {
    if (consumed.has(index)) {
      index += 1;
      continue;
    }

    const token = tokenAt(tokens, index);
    if (token === undefined) {
      index += 1;
      continue;
    }

    // 'עד <time>'
    if (hasAnyStem(token, END_TIME_MARKERS) !== undefined) {
      const time = parseTimeAt(tokens, index + 1);
      if (time !== undefined) {
        const expression = toExpression(time, true, [index]);
        found.push(expression);
        index = Math.max(...expression.tokens) + 1;
        continue;
      }
    }

    // 'בשעה <time>' / 'לשעה <time>' — here 'שעה' marks a clock time, not a duration.
    if (hasStem(token, HOUR_MARKER_STEM, HOUR_MARKER_PREFIXES) !== undefined) {
      const time = parseTimeAt(tokens, index + 1);
      if (time !== undefined) {
        const expression = toExpression(time, false, [index]);
        found.push(expression);
        index = Math.max(...expression.tokens) + 1;
        continue;
      }
    }

    const time = parseTimeAt(tokens, index);
    if (time !== undefined) {
      const expression = toExpression(time, false, []);
      found.push(expression);
      index = Math.max(...expression.tokens) + 1;
      continue;
    }

    index += 1;
  }

  return found;
}
