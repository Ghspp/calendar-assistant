/**
 * Hebrew date expressions.
 *
 * The only thing the clock is used for is establishing *today's* local date and weekday
 * in Asia/Jerusalem. Everything after that is pure integer calendar arithmetic on a UTC
 * midnight anchor, which makes it immune to DST: adding a day never lands on 23:00 of
 * the same date the way naive local-time arithmetic can.
 */

import { TZDate } from '@date-fns/tz';
import {
  CONSTRUCT_HEADS,
  DAY_PART_DAYS,
  WEEKEND_PHRASES,
  DUAL_PERIODS,
  IN_FUTURE_MARKER,
  NEXT_WEEK_PHRASES,
  PERIOD_DAYS,
  RELATIVE_DAYS,
  THIS_WEEK_TOKENS,
  WEEKDAYS,
  WEEKDAY_STEMS_REQUIRING_YOM,
} from './lexicon';
import { hasStem, matchPhrase, tokenAt, type Token } from './normalize';
import { readNumber } from './numbers';
import type { Clock } from '../../utils/clock';
import type { DateRange } from '../../types/parser';

export interface DateMatch {
  /** YYYY-MM-DD. Mutually exclusive with `range`. */
  date?: string;
  /** Set for week-wide expressions such as 'השבוע'. */
  range?: DateRange;
  /**
   * HH:mm, when the expression fixed a time as well as a date.
   *
   * 'בעוד שעתיים' names an exact moment, not a day. Returning the time here lets the
   * parser resolve it outright — this is measured from the clock, never guessed.
   */
  startTime?: string;
  tokens: number[];
}

interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Today's civil date in the clock's zone. */
function today(clock: Clock): CivilDate {
  const local = new TZDate(clock.now(), clock.timeZone());
  return {
    year: local.getFullYear(),
    month: local.getMonth() + 1,
    day: local.getDate(),
  };
}

/** UTC-midnight anchor for a civil date — a pure calendar value, not an instant. */
function toAnchor(date: CivilDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function anchorPlusDays(anchor: Date, days: number): Date {
  const next = new Date(anchor.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatAnchor(anchor: Date): string {
  return `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}-${pad2(anchor.getUTCDate())}`;
}

/** Resolve a day offset from today into YYYY-MM-DD. */
export function dateFromOffset(clock: Clock, offsetDays: number): string {
  return formatAnchor(anchorPlusDays(toAnchor(today(clock)), offsetDays));
}

/** Weekday index (0 = Sunday) of today in the clock's zone. */
function todayWeekday(clock: Clock): number {
  return toAnchor(today(clock)).getUTCDay();
}

/**
 * Days from today to the next occurrence of `weekday`.
 *
 * Today counts as a match (offset 0). Said on a Friday, 'ביום שישי' therefore means
 * today, not a week out. If the resulting time has already passed, Stage 2 validation
 * rejects it with a clear message — which is better than silently booking seven days
 * away from what the user meant.
 */
function offsetToWeekday(clock: Clock, weekday: number): number {
  const current = todayWeekday(clock);
  return (weekday - current + 7) % 7;
}

/** Sunday-to-Saturday week containing today, shifted by `weekOffset` weeks. */
function weekRange(clock: Clock, weekOffset: number): DateRange {
  const anchor = toAnchor(today(clock));
  const startOfThisWeek = anchorPlusDays(anchor, -todayWeekday(clock));
  const start = anchorPlusDays(startOfThisWeek, weekOffset * 7);
  return {
    startDate: formatAnchor(start),
    endDate: formatAnchor(anchorPlusDays(start, 6)),
  };
}

function isNextWeekAt(tokens: Token[], index: number): number | undefined {
  for (const phrase of NEXT_WEEK_PHRASES) {
    const end = matchPhrase(tokens, index, phrase);
    if (end !== undefined) return end;
  }
  return undefined;
}

/**
 * Find the date expression in the command.
 *
 * Scans left to right and returns the first match, so 'מחר' in
 * 'תקבע פגישה מחר' wins over anything later in the sentence.
 */
export function findDate(
  tokens: Token[],
  consumed: ReadonlySet<number>,
  clock: Clock,
): DateMatch | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    if (consumed.has(index)) continue;
    const token = tokenAt(tokens, index);
    if (token === undefined) continue;

    // 'בעוד שעתיים' — an exact moment measured from now.
    if (hasStem(token, IN_FUTURE_MARKER) !== undefined) {
      const soon = readInFutureTime(tokens, index, clock);
      if (soon !== undefined) return soon;
    }

    // 'בעוד יומיים', 'בעוד 3 ימים', 'בעוד שבוע'
    if (hasStem(token, IN_FUTURE_MARKER) !== undefined) {
      const inFuture = readInFuture(tokens, index, clock);
      if (inFuture !== undefined) return inFuture;
    }

    // 'סוף השבוע' — Friday and Saturday.
    const weekend = readWeekend(tokens, index, clock);
    if (weekend !== undefined) return weekend;

    // '25.9' / '25/09/2026'
    const numeric = readNumericDate(tokens, index, clock);
    if (numeric !== undefined) return numeric;

    // 'הערב' / 'הבוקר' — today, named by its part of the day.
    const dayPartDay = readDayPartDay(tokens, index, clock);
    if (dayPartDay !== undefined) return dayPartDay;

    // 'היום' / 'מחר' / 'מחרתיים', possibly prefixed as in 'למחר'
    const relative = readRelativeDay(tokens, index, clock);
    if (relative !== undefined) return relative;

    // 'ביום שישי', 'בשבת', optionally followed by 'שבוע הבא'
    const weekday = readWeekday(tokens, index, clock);
    if (weekday !== undefined) return weekday;

    // Bare 'שבוע הבא' / 'השבוע'
    const week = readWeekScope(tokens, index, clock);
    if (week !== undefined) return week;
  }

  return undefined;
}

function readRelativeDay(tokens: Token[], index: number, clock: Clock): DateMatch | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  for (const form of token.forms) {
    const offset = RELATIVE_DAYS.get(form.stem);
    if (offset === undefined) continue;

    const used = [index];
    let dayOffset = offset;

    // 'מחר בשבוע הבא' is not idiomatic, but 'מחר' + week scope is harmless to support.
    const nextWeekEnd = isNextWeekAt(tokens, index + 1);
    if (nextWeekEnd !== undefined) {
      dayOffset += 7;
      for (let i = index + 1; i < nextWeekEnd; i += 1) used.push(i);
    }

    return { date: dateFromOffset(clock, dayOffset), tokens: used };
  }

  return undefined;
}

function readWeekday(tokens: Token[], index: number, clock: Clock): DateMatch | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  const used: number[] = [];
  let weekdayIndex = index;
  let sawYom = false;

  // Optional explicit 'יום' / 'ביום' before the weekday name.
  if (hasStem(token, 'יום') !== undefined) {
    sawYom = true;
    used.push(index);
    weekdayIndex = index + 1;
  }

  const weekdayToken = tokenAt(tokens, weekdayIndex);
  if (weekdayToken === undefined) return undefined;

  let weekday: number | undefined;
  for (const form of weekdayToken.forms) {
    const candidate = WEEKDAYS.get(form.stem);
    if (candidate === undefined) continue;
    // 'שני' is also the numeral 2 — only trust it when 'יום' made the intent explicit.
    if (!sawYom && WEEKDAY_STEMS_REQUIRING_YOM.has(form.stem)) continue;
    weekday = candidate;
    break;
  }

  if (weekday === undefined) return undefined;
  used.push(weekdayIndex);

  let dayOffset = offsetToWeekday(clock, weekday);

  const nextWeekEnd = isNextWeekAt(tokens, weekdayIndex + 1);
  if (nextWeekEnd !== undefined) {
    dayOffset += 7;
    for (let i = weekdayIndex + 1; i < nextWeekEnd; i += 1) used.push(i);
  }

  return { date: dateFromOffset(clock, dayOffset), tokens: used };
}

function readWeekScope(tokens: Token[], index: number, clock: Clock): DateMatch | undefined {
  const nextWeekEnd = isNextWeekAt(tokens, index);
  if (nextWeekEnd !== undefined) {
    const used: number[] = [];
    for (let i = index; i < nextWeekEnd; i += 1) used.push(i);
    return { range: weekRange(clock, 1), tokens: used };
  }

  const token = tokenAt(tokens, index);
  if (token !== undefined && token.forms.some((form) => THIS_WEEK_TOKENS.has(form.stem))) {
    return { range: weekRange(clock, 0), tokens: [index] };
  }

  return undefined;
}

function readInFuture(tokens: Token[], index: number, clock: Clock): DateMatch | undefined {
  const used = [index];
  const next = tokenAt(tokens, index + 1);
  if (next === undefined) return undefined;

  // 'בעוד יומיים' / 'בעוד שבועיים' — the dual carries its own count.
  for (const form of next.forms) {
    const dual = DUAL_PERIODS.get(form.stem);
    if (dual !== undefined) {
      used.push(index + 1);
      return { date: dateFromOffset(clock, dual), tokens: used };
    }
  }

  // 'בעוד שבוע' — a bare period means one of it.
  for (const form of next.forms) {
    const period = PERIOD_DAYS.get(form.stem);
    if (period !== undefined) {
      used.push(index + 1);
      return { date: dateFromOffset(clock, period), tokens: used };
    }
  }

  // 'בעוד 3 ימים' / 'בעוד שלושה ימים'
  const count = readNumber(tokens, index + 1);
  if (count === undefined) return undefined;

  const unitToken = tokenAt(tokens, count.nextIndex);
  if (unitToken === undefined) return undefined;

  for (const form of unitToken.forms) {
    const perUnit = PERIOD_DAYS.get(form.stem);
    if (perUnit !== undefined) {
      for (let i = index + 1; i <= count.nextIndex; i += 1) used.push(i);
      return { date: dateFromOffset(clock, count.value * perUnit), tokens: used };
    }
  }

  return undefined;
}

/** 'סוף השבוע' — the coming Friday and Saturday. */
function readWeekend(tokens: Token[], index: number, clock: Clock): DateMatch | undefined {
  for (const phrase of WEEKEND_PHRASES) {
    const end = matchPhrase(tokens, index, phrase);
    if (end === undefined) continue;

    const used: number[] = [];
    for (let i = index; i < end; i += 1) used.push(i);

    const friday = dateFromOffset(clock, offsetToWeekday(clock, 5));
    const saturday = addDays(friday, 1);
    if (saturday === undefined) return undefined;

    return { range: { startDate: friday, endDate: saturday }, tokens: used };
  }
  return undefined;
}

/** Add whole calendar days to a YYYY-MM-DD string. */
function addDays(date: string, days: number): string | undefined {
  const civil = parseCivil(date);
  if (civil === undefined) return undefined;
  return formatAnchor(anchorPlusDays(toAnchor(civil), days));
}

function parseCivil(date: string): CivilDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return undefined;
  const [, y, m, d] = match;
  if (y === undefined || m === undefined || d === undefined) return undefined;
  return {
    year: Number.parseInt(y, 10),
    month: Number.parseInt(m, 10),
    day: Number.parseInt(d, 10),
  };
}

/**
 * 'בעוד שעתיים' / 'בעוד 20 דקות' — an exact moment relative to now.
 *
 * The resulting hour is RESOLVED rather than ambiguous, because it was computed from
 * the clock rather than read off an utterance. No AM/PM inference is involved.
 */
function readInFutureTime(
  tokens: Token[],
  index: number,
  clock: Clock,
): DateMatch | undefined {
  const used = [index];
  const next = tokenAt(tokens, index + 1);
  if (next === undefined) return undefined;

  let minutes: number | undefined;
  let lastIndex = index + 1;

  // 'שעתיים' carries its own count.
  for (const form of next.forms) {
    if (form.stem === 'שעתיים' || form.stem === 'שעתים') minutes = 120;
  }

  if (minutes === undefined) {
    const count = readNumber(tokens, index + 1);
    const unitToken = count === undefined ? next : tokenAt(tokens, count.nextIndex);
    if (unitToken === undefined) return undefined;

    const bare = unitToken.forms[0];
    if (bare === undefined) return undefined;

    const perUnit = bare.stem === 'שעה' || bare.stem === 'שעות' ? 60
      : bare.stem === 'דקה' || bare.stem === 'דקות' ? 1
      : undefined;
    if (perUnit === undefined) return undefined;

    minutes = (count?.value ?? 1) * perUnit;
    lastIndex = count === undefined ? index + 1 : count.nextIndex;
  }

  for (let i = index + 1; i <= lastIndex; i += 1) used.push(i);

  const target = new TZDate(new Date(clock.now().getTime() + minutes * 60_000), clock.timeZone());
  const pad = (value: number) => value.toString().padStart(2, '0');

  return {
    date: `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`,
    startTime: `${pad(target.getHours())}:${pad(target.getMinutes())}`,
    tokens: used,
  };
}

/**
 * A written date: '25.9', '25/9', '25.9.2026'.
 *
 * Day comes first, as it does everywhere outside the United States. A date with no
 * year resolves to its next occurrence, so '25.9' said in October means next year.
 */
function readNumericDate(
  tokens: Token[],
  index: number,
  clock: Clock,
): DateMatch | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  for (const form of token.forms) {
    const match = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/.exec(form.stem);
    if (match === null) continue;

    const [, dayText, monthText, yearText] = match;
    if (dayText === undefined || monthText === undefined) continue;

    const day = Number.parseInt(dayText, 10);
    const month = Number.parseInt(monthText, 10);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;

    const todayCivil = today(clock);

    let year: number;
    if (yearText !== undefined) {
      const parsed = Number.parseInt(yearText, 10);
      year = parsed < 100 ? 2000 + parsed : parsed;
    } else {
      year = todayCivil.year;
      const thisYear = new Date(Date.UTC(year, month - 1, day));
      if (thisYear.getTime() < toAnchor(todayCivil).getTime()) year += 1;
    }

    const anchor = new Date(Date.UTC(year, month - 1, day));
    if (anchor.getUTCMonth() !== month - 1 || anchor.getUTCDate() !== day) continue;

    return { date: formatAnchor(anchor), tokens: [index] };
  }

  return undefined;
}

/**
 * 'הערב' / 'הבוקר' / 'הלילה' — today, named by its part of the day.
 *
 * Guarded against meal names: the 'הערב' of 'ארוחת הערב' is part of a noun, and reading
 * it as a date would silently move 'ארוחת הערב מחר' to today.
 */
function readDayPartDay(
  tokens: Token[],
  index: number,
  clock: Clock,
): DateMatch | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  const bare = token.forms[0];
  if (bare === undefined || !DAY_PART_DAYS.has(bare.stem)) return undefined;

  const before = tokenAt(tokens, index - 1);
  if (before !== undefined && CONSTRUCT_HEADS.has(before.raw)) return undefined;

  // The token is NOT marked consumed: the time parser still needs to read it as a
  // qualifier so that 'הערב בשמונה' resolves to 20:00 rather than staying ambiguous.
  return { date: dateFromOffset(clock, 0), tokens: [] };
}
