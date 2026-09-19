/**
 * Hebrew recurrence expressions: 'כל יום שני', 'כל יום', 'כל שבועיים'.
 *
 * Pure. Recognises the repetition only — the START date still comes from the ordinary
 * date parser, because 'כל יום שני' names both a rule and a first occurrence, and the
 * weekday logic for the latter already exists.
 *
 * So this consumes 'כל' and any period word, and deliberately LEAVES the weekday for
 * findDate to resolve into a concrete first date.
 */

import { WEEKDAYS, WEEKDAY_STEMS_REQUIRING_YOM } from './lexicon';
import { hasStem, tokenAt, type Token } from './normalize';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export interface Recurrence {
  frequency: RecurrenceFrequency;
  /** 1 = every, 2 = every other, and so on. */
  interval: number;
  /** Weekday numbers (0 = Sunday) for a weekly rule on particular days. */
  byWeekday?: number[];
}

export interface RecurrenceMatch {
  recurrence: Recurrence;
  /** Token indices to mark consumed. The weekday itself is NOT included. */
  tokens: number[];
}

/** The word that introduces a repetition. */
const EVERY = 'כל';

/** Period words that carry their own count. */
const DUAL_PERIODS = new Map<string, { frequency: RecurrenceFrequency; interval: number }>([
  ['יומיים', { frequency: 'daily', interval: 2 }],
  ['שבועיים', { frequency: 'weekly', interval: 2 }],
  ['חודשיים', { frequency: 'monthly', interval: 2 }],
]);

const PERIODS = new Map<string, RecurrenceFrequency>([
  ['יום', 'daily'],
  ['שבוע', 'weekly'],
  ['חודש', 'monthly'],
]);

/** The weekday at `index`, honouring the same guard the date parser uses. */
function weekdayAt(tokens: Token[], index: number, afterYom: boolean): number | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  for (const form of token.forms) {
    const weekday = WEEKDAYS.get(form.stem);
    if (weekday === undefined) continue;
    // 'שני' is also the numeral two, so it needs an explicit 'יום' in front.
    if (!afterYom && WEEKDAY_STEMS_REQUIRING_YOM.has(form.stem)) continue;
    return weekday;
  }

  return undefined;
}

/**
 * Collect 'שני ורביעי' — additional weekdays joined by the ו particle.
 *
 * Returns the days found and the index just past them.
 */
function readExtraWeekdays(
  tokens: Token[],
  index: number,
): { days: number[]; nextIndex: number } {
  const days: number[] = [];
  let cursor = index;

  for (;;) {
    const token = tokenAt(tokens, cursor);
    if (token === undefined) break;

    // Must be joined by ו: 'שני ורביעי', never a bare word further along.
    const joined = token.forms.find((form) => form.prefix === 'ו');
    if (joined === undefined) break;

    const weekday = WEEKDAYS.get(joined.stem);
    if (weekday === undefined) break;

    days.push(weekday);
    cursor += 1;
  }

  return { days, nextIndex: cursor };
}

/**
 * Find a recurrence in the command.
 *
 * Only ever triggered by an explicit 'כל', so an ordinary one-off command can never
 * accidentally become a repeating event — the failure that would be hardest to notice
 * and most annoying to undo.
 */
export function findRecurrence(
  tokens: Token[],
  consumed: ReadonlySet<number>,
): RecurrenceMatch | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    if (consumed.has(index)) continue;

    const token = tokenAt(tokens, index);
    if (token === undefined) continue;
    if (hasStem(token, EVERY) === undefined) continue;

    const next = tokenAt(tokens, index + 1);
    if (next === undefined) continue;

    // 'כל שבועיים' — the dual carries its own interval.
    for (const form of next.forms) {
      const dual = DUAL_PERIODS.get(form.stem);
      if (dual !== undefined) {
        return {
          recurrence: { frequency: dual.frequency, interval: dual.interval },
          tokens: [index, index + 1],
        };
      }
    }

    // 'כל יום שני' — a weekly rule. The weekday is left for the date parser.
    const isYom = hasStem(next, 'יום') !== undefined;
    const weekdayIndex = isYom ? index + 2 : index + 1;
    const firstWeekday = weekdayAt(tokens, weekdayIndex, isYom);

    if (firstWeekday !== undefined) {
      const extra = readExtraWeekdays(tokens, weekdayIndex + 1);
      const byWeekday = [firstWeekday, ...extra.days];

      // Only 'כל' is consumed. 'יום שני' still has to produce a first date, and the
      // extra days of 'שני ורביעי' would otherwise be left in the title.
      const used = [index];
      for (let i = weekdayIndex + 1; i < extra.nextIndex; i += 1) used.push(i);

      return {
        recurrence: { frequency: 'weekly', interval: 1, byWeekday },
        tokens: used,
      };
    }

    // 'כל יום' / 'כל שבוע' / 'כל חודש'
    for (const form of next.forms) {
      const frequency = PERIODS.get(form.stem);
      if (frequency !== undefined) {
        return {
          recurrence: { frequency, interval: 1 },
          tokens: [index, index + 1],
        };
      }
    }
  }

  return undefined;
}
