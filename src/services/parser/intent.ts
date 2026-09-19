/**
 * Intent detection.
 *
 * Multi-word phrases are tried first ('מה יש לי' before the single verb 'מתי'), then
 * single verbs anywhere in the sentence. The first match wins, so the leading verb of
 * a command determines its intent.
 */

import {
  INTENT_PHRASES,
  INTENT_VERBS,
  MESSAGE_NOUNS,
  OBJECT_LOOKAHEAD,
  OBJECT_VERBS,
  RECIPIENT_BLOCKLIST,
} from './lexicon';
import { hasAnyStem, matchPhrase, tokenAt, type Token } from './normalize';
import type { Intent } from '../../types/parser';

export interface IntentMatch {
  intent: Intent;
  /** Token indices consumed by the intent phrase/verb. */
  tokens: number[];
}

export function detectIntent(tokens: Token[]): IntentMatch | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    // Phrases first — 'מצא לי' must beat the bare verb 'מצא' so both tokens are consumed.
    for (const phrase of INTENT_PHRASES) {
      const endExclusive = matchPhrase(tokens, index, phrase.words);
      if (endExclusive !== undefined) {
        return {
          intent: phrase.intent,
          tokens: range(index, endExclusive),
        };
      }
    }

    const token = tokens[index];
    if (token === undefined) continue;

    // Object-gated verbs sit between phrases and plain verbs: 'תגיד' means "send" only
    // when something follows it to send TO, and stays a QUERY opener otherwise.
    for (const form of token.forms) {
      const gated = OBJECT_VERBS.get(form.stem);
      if (gated !== undefined && takesObject(tokens, index)) {
        return { intent: gated, tokens: [index] };
      }
    }

    for (const form of token.forms) {
      const intent = INTENT_VERBS.get(form.stem);
      if (intent !== undefined) {
        return { intent, tokens: [index] };
      }
    }
  }

  return undefined;
}

/**
 * True when a ל-object or a message noun follows the verb closely.
 *
 * This is also what guarantees that a SEND_MESSAGE parse always has SOMETHING to work
 * with: the intent cannot be reached without either a recipient or a 'הודעה' present.
 */
function takesObject(tokens: Token[], verbIndex: number): boolean {
  for (let index = verbIndex + 1; index <= verbIndex + OBJECT_LOOKAHEAD; index += 1) {
    const next = tokenAt(tokens, index);
    if (next === undefined) return false;

    if (hasAnyStem(next, MESSAGE_NOUNS) !== undefined) return true;

    // A ל-word that is not grammar ('לשעה', 'למחר') is a person.
    const addressed = next.forms.some(
      (form) =>
        form.prefix === 'ל' && form.stem.length > 0 && !RECIPIENT_BLOCKLIST.has(form.stem),
    );
    if (addressed) return true;
  }

  return false;
}

function range(startInclusive: number, endExclusive: number): number[] {
  const result: number[] = [];
  for (let i = startInclusive; i < endExclusive; i += 1) result.push(i);
  return result;
}
