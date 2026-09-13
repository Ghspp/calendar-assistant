/**
 * Hebrew duration expressions.
 *
 * A duration is introduced by the ל particle ('לשעה', 'לשעתיים', 'ל-30 דקות') or by an
 * explicit marker ('למשך שעה'). The particle is what separates a duration from a clock
 * time: ל+שעה is 'for an hour', ב+שעה is 'at the hour'.
 */

import {
  DURATION_MARKERS,
  DURATION_UNITS,
  FIXED_DURATIONS,
  HOUR_FRACTIONS,
} from './lexicon';
import { hasAnyStem, tokenAt, type Token } from './normalize';
import { readNumber } from './numbers';

export interface DurationMatch {
  minutes: number;
  tokens: number[];
}

/** A duration unit written without any particle — the unit of a preceding count. */
function bareUnitMinutes(tokens: Token[], index: number): number | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;
  const bare = token.forms[0];
  if (bare === undefined) return undefined;
  return DURATION_UNITS.get(bare.stem);
}

/**
 * Parse the body of a duration at `index`, ignoring which particle introduced it.
 *
 * Handles 'שעתיים', 'חצי שעה', 'רבע שעה', '30 דקות', 'שלוש שעות' and a bare 'שעה'.
 */
function readDurationBody(
  tokens: Token[],
  index: number,
): { minutes: number; nextIndex: number } | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  // 'שעתיים' — the dual carries its own count.
  for (const form of token.forms) {
    const fixed = FIXED_DURATIONS.get(form.stem);
    if (fixed !== undefined) return { minutes: fixed, nextIndex: index + 1 };
  }

  // 'חצי שעה' / 'רבע שעה'
  for (const form of token.forms) {
    const fraction = HOUR_FRACTIONS.get(form.stem);
    if (fraction === undefined) continue;
    const unit = bareUnitMinutes(tokens, index + 1);
    if (unit === 60) return { minutes: fraction, nextIndex: index + 2 };
  }

  // '30 דקות' / 'שלוש שעות'
  const numeral = readNumber(tokens, index);
  if (numeral !== undefined) {
    const unit = bareUnitMinutes(tokens, numeral.nextIndex);
    if (unit !== undefined) {
      return { minutes: numeral.value * unit, nextIndex: numeral.nextIndex + 1 };
    }
  }

  // A bare unit means one of it: 'לשעה' is 60 minutes.
  for (const form of token.forms) {
    const unit = DURATION_UNITS.get(form.stem);
    if (unit !== undefined) return { minutes: unit, nextIndex: index + 1 };
  }

  return undefined;
}

/** Trailing 'וחצי' / 'ורבע' on an hour-based duration: 'לשעה וחצי' is 90 minutes. */
function readTrailingFraction(
  tokens: Token[],
  index: number,
): { minutes: number; nextIndex: number } | undefined {
  const token = tokenAt(tokens, index);
  if (token === undefined) return undefined;

  for (const form of token.forms) {
    if (form.prefix !== 'ו') continue;
    const minutes = HOUR_FRACTIONS.get(form.stem);
    if (minutes !== undefined) return { minutes, nextIndex: index + 1 };
  }

  return undefined;
}

function finish(
  tokens: Token[],
  startIndex: number,
  body: { minutes: number; nextIndex: number },
): DurationMatch {
  let minutes = body.minutes;
  let end = body.nextIndex;

  // Only hour-scale durations take 'וחצי' — '30 דקות וחצי' is not a thing.
  if (minutes >= 60) {
    const fraction = readTrailingFraction(tokens, end);
    if (fraction !== undefined) {
      minutes += fraction.minutes;
      end = fraction.nextIndex;
    }
  }

  const used: number[] = [];
  for (let i = startIndex; i < end; i += 1) used.push(i);
  return { minutes, tokens: used };
}

/**
 * Find the duration in the command.
 *
 * Tokens already claimed by the time parser are skipped, which is what stops the
 * 'לשעה' of 'תעביר לשעה 8' (move it to eight) being read as a one-hour duration.
 */
export function findDuration(
  tokens: Token[],
  consumed: ReadonlySet<number>,
): DurationMatch | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    if (consumed.has(index)) continue;

    const token = tokenAt(tokens, index);
    if (token === undefined) continue;

    // 'למשך שעה' — the body follows the marker with no particle of its own.
    if (hasAnyStem(token, DURATION_MARKERS) !== undefined) {
      const body = readDurationBody(tokens, index + 1);
      if (body !== undefined) return finish(tokens, index, body);
      continue;
    }

    // 'לשעה' / 'לשעתיים' / 'ל-30 דקות' — introduced by the ל particle.
    const hasLamed = token.forms.some((form) => form.prefix === 'ל');
    if (!hasLamed) continue;

    const body = readDurationBody(tokens, index);
    if (body !== undefined) return finish(tokens, index, body);
  }

  return undefined;
}
