/**
 * Intent detection.
 *
 * Multi-word phrases are tried first ('מה יש לי' before the single verb 'מתי'), then
 * single verbs anywhere in the sentence. The first match wins, so the leading verb of
 * a command determines its intent.
 */

import { INTENT_PHRASES, INTENT_VERBS } from './lexicon';
import { matchPhrase, type Token } from './normalize';
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

    for (const form of token.forms) {
      const intent = INTENT_VERBS.get(form.stem);
      if (intent !== undefined) {
        return { intent, tokens: [index] };
      }
    }
  }

  return undefined;
}

function range(startInclusive: number, endExclusive: number): number[] {
  const result: number[] = [];
  for (let i = startInclusive; i < endExclusive; i += 1) result.push(i);
  return result;
}
