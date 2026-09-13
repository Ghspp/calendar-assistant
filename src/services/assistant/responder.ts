/**
 * Hebrew responses.
 *
 * Pure: every function here is a plain transformation of data into a string, with the
 * current instant injected. All user-facing wording lives in this one module, so the
 * assistant's voice can be changed without touching any logic.
 */

import type { Clock } from '../../utils/clock';
import { instantToZonedTime } from '../../utils/time';
import { dateFromOffset } from '../parser/dateParser';
import type { Conflict } from '../conflict/detectConflicts';
import type { CalendarEvent } from '../../types/calendar';
import type { CommandOutcome } from './types';

/** Hebrew weekday names, indexed as JavaScript's getDay(): 0 = Sunday. */
const WEEKDAY_NAMES = [
  'יום ראשון',
  'יום שני',
  'יום שלישי',
  'יום רביעי',
  'יום חמישי',
  'יום שישי',
  'שבת',
] as const;

/** Hebrew uses a maqaf rather than an ASCII hyphen between a prefix and a numeral. */
const MAQAF = '־';

function weekdayOf(date: string): string | undefined {
  const parts = date.split('-');
  const [year, month, day] = parts;
  if (year === undefined || month === undefined || day === undefined) return undefined;

  const anchor = new Date(
    Date.UTC(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, Number.parseInt(day, 10)),
  );
  if (Number.isNaN(anchor.getTime())) return undefined;

  return WEEKDAY_NAMES[anchor.getUTCDay()];
}

/**
 * How a human would refer to this date, relative to today.
 *
 * Nearby days get their familiar names; anything beyond the coming week falls back to
 * a plain numeric date, because 'ביום שלישי' three weeks out is genuinely ambiguous.
 */
export function describeDate(date: string, clock: Clock): string {
  for (const [offset, phrase] of [
    [0, 'היום'],
    [1, 'מחר'],
    [2, 'מחרתיים'],
  ] as const) {
    if (dateFromOffset(clock, offset) === date) return phrase;
  }

  for (let offset = 3; offset <= 7; offset += 1) {
    if (dateFromOffset(clock, offset) === date) {
      const weekday = weekdayOf(date);
      if (weekday !== undefined) return `ב${weekday}`;
    }
  }

  const parts = date.split('-');
  const [, month, day] = parts;
  return month !== undefined && day !== undefined ? `ב${MAQAF}${day}.${month}` : date;
}

/**
 * The same as describeDate but without its leading particle, for use inside a phrase
 * that supplies its own: 'בין יום שישי ל־שבת' rather than 'בין ביום שישי ל־בשבת'.
 */
export function describeDateBare(date: string, clock: Clock): string {
  const described = describeDate(date, clock);
  return described.startsWith('ב') && described.length > 1 ? described.slice(1) : described;
}

/** 'בין 18:00 ל־19:00' */
export function describeTimeRange(startTime: string, endTime: string): string {
  return `בין ${startTime} ל${MAQAF}${endTime}`;
}

/** Local wall-clock range of an existing calendar event. */
function conflictRange(conflict: Conflict, timeZone: string): string {
  const start = instantToZonedTime(conflict.interval.start, timeZone).time;
  const end = instantToZonedTime(conflict.interval.end, timeZone).time;
  return `${start}${MAQAF}${end}`;
}

/** 'חוג כדורגל בין 17:00 ל־18:00' */
function describeConflict(conflict: Conflict, timeZone: string): string {
  const start = instantToZonedTime(conflict.interval.start, timeZone).time;
  const end = instantToZonedTime(conflict.interval.end, timeZone).time;
  return `${conflict.event.title} ${describeTimeRange(start, end)}`;
}

const UNSUPPORTED_BY_INTENT: Record<string, string> = {
  UNKNOWN: 'לא הבנתי את הבקשה. נסה למשל: "תקבע לי פגישה עם דניאל מחר בשש בערב לשעה".',
};

/** 'חוג כדורגל 17:00־18:00', or a whole-day marker. */
function describeEvent(event: CalendarEvent, timeZone: string): string {
  if (event.kind === 'allDay') return `${event.title} (יום שלם)`;

  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return event.title;

  const startLocal = instantToZonedTime(start, timeZone);
  const endLocal = instantToZonedTime(end, timeZone);

  return `${event.title} ${startLocal.time}${MAQAF}${endLocal.time}`;
}

/** 'חוג כדורגל מחר בין 17:00 ל־18:00' — used when the day is not already known. */
function describeEventWithDate(
  event: CalendarEvent,
  timeZone: string,
  clock: Clock,
): string {
  if (event.kind === 'allDay') {
    return `${event.title} ${describeDate(event.startDate, clock)} (יום שלם)`;
  }

  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return event.title;

  const startLocal = instantToZonedTime(start, timeZone);
  const endLocal = instantToZonedTime(end, timeZone);

  return (
    `${event.title} ${describeDate(startLocal.date, clock)} ` +
    `${describeTimeRange(startLocal.time, endLocal.time)}`
  );
}

function describeAgenda(
  outcome: Extract<CommandOutcome, { kind: 'agenda' }>,
  clock: Clock,
): string {
  const when =
    outcome.date !== undefined
      ? describeDate(outcome.date, clock)
      : outcome.dateRange !== undefined
        ? `בין ${describeDateBare(outcome.dateRange.startDate, clock)} ל${MAQAF}${describeDateBare(
            outcome.dateRange.endDate,
            clock,
          )}`
        : '';

  if (outcome.events.length === 0) return `${when} היומן שלך פנוי.`.trim();

  const listed = outcome.events
    .map((event) =>
      outcome.dateRange !== undefined
        ? describeEventWithDate(event, outcome.timeZone, clock)
        : describeEvent(event, outcome.timeZone),
    )
    .join(', ');

  if (outcome.events.length === 1) return `${when} יש לך ${listed}.`.trim();

  return `${when} יש לך ${outcome.events.length} אירועים: ${listed}.`.trim();
}

function describeAvailability(
  outcome: Extract<CommandOutcome, { kind: 'availability' }>,
  clock: Clock,
): string {
  const when = describeDate(outcome.date, clock);

  if (outcome.readings.length === 0) return 'לא הבנתי על איזו שעה שאלת.';

  const describeOne = (reading: (typeof outcome.readings)[number]): string => {
    if (reading.free) return `אתה פנוי`;
    const busy = reading.conflicts
      .map((conflict) => describeEvent(conflict.event, outcome.timeZone))
      .join(', ');
    return `יש לך ${busy}`;
  };

  // A single reading: the hour was unambiguous.
  const single = outcome.readings[0];
  if (outcome.readings.length === 1 && single !== undefined) {
    return single.free
      ? `כן, אתה פנוי ${when} ${describeTimeRange(single.startTime, single.endTime)}.`
      : `לא. ${when} ${describeTimeRange(single.startTime, single.endTime)} ${describeOne(single)}.`;
  }

  // Two readings: the hour was ambiguous, and a question can answer both rather than
  // making the user pick first.
  return outcome.readings
    .map((reading) => `ב${MAQAF}${reading.startTime} ${describeOne(reading)}`)
    .join('. ')
    .concat('.');
}

function describeFreeSlots(
  outcome: Extract<CommandOutcome, { kind: 'free-slots' }>,
  clock: Clock,
): string {
  const when = describeDate(outcome.date, clock);
  const scope = outcome.dayPartLabel !== undefined ? ` ${outcome.dayPartLabel}` : '';

  if (outcome.slots.length === 0) {
    return `לא מצאתי שעה פנויה של ${describeDuration(outcome.durationMinutes)} ${when}${scope}.`;
  }

  const listed = outcome.slots
    .map((slot) => describeTimeRange(slot.startTime, slot.endTime))
    .join(', ');

  return `${when}${scope} אתה פנוי ${listed}.`;
}

/** 'שעה' / 'שעתיים' / '90 דקות' — for reporting back what was searched for. */
export function describeDuration(minutes: number): string {
  if (minutes === 60) return 'שעה';
  if (minutes === 120) return 'שעתיים';
  if (minutes === 30) return 'חצי שעה';
  if (minutes % 60 === 0) return `${minutes / 60} שעות`;
  return `${minutes} דקות`;
}

/**
 * Report a change, always naming both the old and the new value.
 *
 * Stating what it used to be is deliberate: if the wrong event was matched, the user
 * sees it immediately instead of discovering it days later.
 */
function describeUpdate(
  outcome: Extract<CommandOutcome, { kind: 'updated' }>,
  clock: Clock,
): string {
  const startLocal = instantToZonedTime(new Date(outcome.newStart), outcome.timeZone);
  const endLocal = instantToZonedTime(new Date(outcome.newEnd), outcome.timeZone);
  const when = `${describeDate(startLocal.date, clock)} ${describeTimeRange(
    startLocal.time,
    endLocal.time,
  )}`;

  const renamed = outcome.previousTitle !== outcome.newTitle;
  const moved = outcome.previousStart !== outcome.newStart;

  if (renamed && !moved) {
    return `שיניתי את ${outcome.previousTitle} ל${outcome.newTitle}. נשאר ${when}.`;
  }

  if (moved && !renamed) {
    const oldLocal = instantToZonedTime(new Date(outcome.previousStart), outcome.timeZone);
    const oldEndLocal = instantToZonedTime(new Date(outcome.previousEnd), outcome.timeZone);
    return (
      `העברתי את ${outcome.newTitle} מ${MAQAF}${oldLocal.time}${MAQAF}${oldEndLocal.time} ` +
      `ל${when}.`
    );
  }

  return `עדכנתי את ${outcome.previousTitle}: ${outcome.newTitle}, ${when}.`;
}

function describeEventSearch(
  outcome: Extract<CommandOutcome, { kind: 'event-search' }>,
  clock: Clock,
): string {
  if (outcome.matches.length === 0) {
    return `לא מצאתי ${outcome.query} בשבועיים הקרובים.`;
  }

  const listed = outcome.matches
    .map((event) => describeEventWithDate(event, outcome.timeZone, clock))
    .join(', ');

  return outcome.matches.length === 1 ? `${listed}.` : `מצאתי ${outcome.matches.length}: ${listed}.`;
}

/** Turn an outcome into the sentence the assistant says. */
export function respond(outcome: CommandOutcome, clock: Clock): string {
  switch (outcome.kind) {
    case 'created': {
      const { event } = outcome;
      const sentence =
        `קבעתי ${event.title} ${describeDate(event.date, clock)} ` +
        `${describeTimeRange(event.startTime, event.endTime)}.`;

      if (outcome.informational.length === 0) return sentence;

      // An all-day marker does not block, but staying silent about it would be unhelpful.
      const titles = outcome.informational.map((item) => item.title).join(', ');
      return `${sentence} שים לב שיש לך גם ${titles} באותו יום.`;
    }

    case 'conflict': {
      const { event, conflicts } = outcome;
      const timeZone = event.timeZone;
      const requested = `${event.startTime}${MAQAF}${event.endTime}`;

      const refusal =
        conflicts.length === 1 && conflicts[0] !== undefined
          ? `לא ניתן לקבוע את ${event.title} ב${MAQAF}${requested} ` +
            `כי יש לך ${describeConflict(conflicts[0], timeZone)}.`
          : `לא ניתן לקבוע את ${event.title} ב${MAQAF}${requested} כי יש לך ` +
            conflicts
              .map((conflict) => `${conflict.event.title} ${conflictRange(conflict, timeZone)}`)
              .join(', ') +
            '.';

      // An offer, never an action. Nothing moves unless the user says yes.
      if (outcome.suggestion === undefined) return refusal;

      return (
        `${refusal} אתה פנוי ב${MAQAF}${outcome.suggestion.startTime}. ` +
        `רוצה שאקבע שם?`
      );
    }

    case 'no-free-slot':
      return `לא מצאתי שעה פנויה ${describeDate(outcome.date, clock)}.`;

    case 'needs-input': {
      // One question at a time. Asking three things at once gets none of them answered.
      const first = outcome.errors[0];
      return first?.message ?? 'חסר לי מידע כדי לקבוע את האירוע.';
    }

    case 'agenda':
      return describeAgenda(outcome, clock);

    case 'availability':
      return describeAvailability(outcome, clock);

    case 'free-slots':
      return describeFreeSlots(outcome, clock);

    case 'event-search':
      return describeEventSearch(outcome, clock);

    case 'updated':
      return describeUpdate(outcome, clock);

    case 'update-ambiguous': {
      // Nothing was changed. Listing the matches is the whole point: the user picks.
      const listed = outcome.matches
        .map((event, index) => `${index + 1}. ${describeEventWithDate(event, outcome.timeZone, clock)}`)
        .join(' ');
      return `מצאתי ${outcome.matches.length} אירועים בשם הזה: ${listed} על איזה מהם?`;
    }

    case 'update-not-found':
      return `לא מצאתי אירוע בשם ${outcome.target}.`;

    case 'update-conflict': {
      const listed = outcome.conflicts
        .map((conflict) => describeConflict(conflict, outcome.timeZone))
        .join(', ');
      return `לא ניתן להעביר את ${outcome.event.title} כי יש לך ${listed}.`;
    }

    case 'update-unclear':
      if (outcome.reason === 'no-target') return 'לא הבנתי איזה אירוע לשנות.';
      if (outcome.reason === 'word-not-in-title') {
        return `לא מצאתי את ${outcome.word ?? 'המילה'} בשם האירוע.`;
      }
      return `לא הבנתי מה לשנות ב${outcome.target ?? 'אירוע'}.`;

    case 'delete-confirm':
      // Describe it fully. This sentence is the user's last chance to spot a wrong match.
      return `למחוק את ${describeEventWithDate(outcome.event, outcome.timeZone, clock)}?`;

    case 'deleted':
      return `מחקתי את ${describeEventWithDate(outcome.event, outcome.timeZone, clock)}.`;

    case 'delete-ambiguous': {
      const listed = outcome.matches
        .map(
          (event, index) =>
            `${index + 1}. ${describeEventWithDate(event, outcome.timeZone, clock)}`,
        )
        .join(' ');
      return `מצאתי ${outcome.matches.length} אירועים בשם הזה: ${listed} איזה מהם למחוק?`;
    }

    case 'delete-not-found':
      return `לא מצאתי אירוע בשם ${outcome.target}.`;

    case 'delete-unclear':
      return 'לא הבנתי איזה אירוע לבטל.';

    case 'abandoned':
      return outcome.message;

    case 'unsupported':
      return (
        UNSUPPORTED_BY_INTENT[outcome.parsed.intent] ?? UNSUPPORTED_BY_INTENT['UNKNOWN'] ?? ''
      );

    case 'failed':
      return outcome.message;
  }
}
