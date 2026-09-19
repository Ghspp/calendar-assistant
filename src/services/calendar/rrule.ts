/**
 * Building the RRULE string Google expects.
 *
 * Pure and tested, because a wrong rule produces an event that repeats at the wrong
 * time forever — a mistake that is both hard to spot and tedious to undo.
 */

import type { Recurrence } from '../parser/recurrence';

/** RFC 5545 weekday codes, indexed as JavaScript's getDay(): 0 = Sunday. */
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const FREQUENCIES: Record<Recurrence['frequency'], string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
};

/**
 * 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE'
 *
 * Returns undefined for a rule that cannot be expressed, rather than emitting
 * something Google would reject or, worse, silently reinterpret.
 */
export function buildRrule(recurrence: Recurrence): string | undefined {
  const frequency = FREQUENCIES[recurrence.frequency];
  if (frequency === undefined) return undefined;

  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1) return undefined;

  const parts = [`FREQ=${frequency}`];

  // INTERVAL=1 is the default; saying so adds noise to every rule.
  if (recurrence.interval > 1) parts.push(`INTERVAL=${recurrence.interval}`);

  if (recurrence.byWeekday !== undefined && recurrence.byWeekday.length > 0) {
    const codes: string[] = [];
    for (const day of recurrence.byWeekday) {
      const code = WEEKDAY_CODES[day];
      if (code === undefined) return undefined;
      if (!codes.includes(code)) codes.push(code);
    }
    parts.push(`BYDAY=${codes.join(',')}`);
  }

  return `RRULE:${parts.join(';')}`;
}
