/**
 * Wall-clock <-> instant conversion and interval arithmetic.
 *
 * The rule that matters here: a Hebrew command describes a WALL CLOCK time in Israel
 * ('מחר בשש בערב'), while a calendar stores ABSOLUTE INSTANTS. Every comparison in
 * Stage 2 happens on instants, so conversion happens exactly once, here, in a
 * DST-correct way.
 */

import { TZDate } from '@date-fns/tz';
import type { TimeInterval } from '../types/calendar';

export const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Parse YYYY-MM-DD, rejecting impossible dates such as 2026-02-30. */
export function parseDateString(value: string): CivilDate | undefined {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return undefined;

  const [, yearText, monthText, dayText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined) return undefined;

  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  // Round-trip through UTC to reject 31 April, 29 February in a common year, etc.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { year, month, day };
}

export function isValidDateString(value: string): boolean {
  return parseDateString(value) !== undefined;
}

/** Parse HH:mm into minutes since local midnight. */
export function parseTimeString(value: string): number | undefined {
  const match = TIME_PATTERN.exec(value);
  if (match === null) return undefined;

  const [, hourText, minuteText] = match;
  if (hourText === undefined || minuteText === undefined) return undefined;

  const hours = Number.parseInt(hourText, 10);
  const minutes = Number.parseInt(minuteText, 10);
  if (hours > 23 || minutes > 59) return undefined;

  return hours * 60 + minutes;
}

export function isValidTimeString(value: string): boolean {
  return parseTimeString(value) !== undefined;
}

/** Minutes since midnight back to HH:mm, wrapping across days. */
export function minutesToTimeString(minutes: number): string {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

/**
 * Resolve a local wall-clock date and time in `timeZone` to an absolute instant.
 *
 * DST-correct: 18:00 on 14 September 2026 in Asia/Jerusalem is 15:00 UTC (IDT, +03:00),
 * while 18:00 on 14 December 2026 is 16:00 UTC (IST, +02:00).
 *
 * Returns a plain Date holding the epoch instant — deliberately NOT a TZDate, whose
 * toISOString() renders in the zone's offset rather than UTC.
 */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): Date | undefined {
  const civil = parseDateString(date);
  const minutes = parseTimeString(time);
  if (civil === undefined || minutes === undefined) return undefined;

  const zoned = new TZDate(
    civil.year,
    civil.month - 1,
    civil.day,
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0,
    timeZone,
  );

  return new Date(zoned.getTime());
}

/** The local date and time an instant falls on, in `timeZone`. */
export function instantToZonedTime(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const zoned = new TZDate(instant, timeZone);
  return {
    date: `${zoned.getFullYear()}-${pad2(zoned.getMonth() + 1)}-${pad2(zoned.getDate())}`,
    time: `${pad2(zoned.getHours())}:${pad2(zoned.getMinutes())}`,
  };
}

/** Add whole minutes of absolute time. Crossing a DST boundary shifts the wall clock. */
export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MS_PER_MINUTE);
}

export function differenceInMinutes(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_MINUTE);
}

/**
 * THE overlap rule for this project.
 *
 * Intervals are half-open: [start, end). Two events that merely touch at a boundary —
 * 17:00-18:00 and 18:00-19:00 — do NOT overlap.
 */
export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
}

/** Local midnight-to-midnight bounds of a date, as instants. */
export function dayBoundsInZone(date: string, timeZone: string): TimeInterval | undefined {
  const start = zonedTimeToInstant(date, '00:00', timeZone);
  if (start === undefined) return undefined;

  const civil = parseDateString(date);
  if (civil === undefined) return undefined;

  const nextDay = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDate = `${nextDay.getUTCFullYear()}-${pad2(nextDay.getUTCMonth() + 1)}-${pad2(
    nextDay.getUTCDate(),
  )}`;

  const end = zonedTimeToInstant(nextDate, '00:00', timeZone);
  if (end === undefined) return undefined;

  return { start, end };
}

/** Add whole calendar days to a YYYY-MM-DD string. Pure integer arithmetic. */
export function addDaysToDateString(date: string, days: number): string | undefined {
  const civil = parseDateString(date);
  if (civil === undefined) return undefined;

  const anchor = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
  anchor.setUTCDate(anchor.getUTCDate() + days);

  return `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}-${pad2(anchor.getUTCDate())}`;
}
