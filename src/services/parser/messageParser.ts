/**
 * Pulling a recipient and a message out of a send request.
 *
 * Two things make this different from every other matcher in the parser, and both
 * shape the code:
 *
 *   1. **The body is text a human will read.** It must come out verbatim, so it is a
 *      contiguous slice of the normalized string — never re-joined from tokens. The
 *      title extractor cannot be reused: it drops TITLE_FILLERS (which contains 'אני',
 *      'מה', 'תודה') and merges non-adjacent fragments, so 'תודה רבה על היום' would
 *      come back as 'רבה על היום'.
 *   2. **The recipient is left unresolved.** The parser is pure and a contact book is
 *      storage, so this emits the spoken name and the assistant layer matches it.
 *
 * Multi-word recipients ('לאמא של דניאל') are deliberately out of scope: absorbing a
 * following word would turn 'תשלח לרותי תודה רבה' into a message for 'רותי תודה'.
 */

import {
  CLAUSE_OPENERS,
  MESSAGE_NOUNS,
  RECIPIENT_BLOCKLIST,
  RECIPIENT_SKIP,
} from './lexicon';
import { hasAnyStem, tokenAt, type Token, type TokenForm } from './normalize';

export interface RecipientMatch {
  /** As spoken, with the ל particle removed: 'לאמא' → 'אמא'. Not contact-resolved. */
  name: string;
  tokens: number[];
}

export interface MessageBodyMatch {
  /** Verbatim slice of the normalized text. */
  text: string;
  /** The marker through the end of the utterance — all claimed by the body. */
  tokens: number[];
}

/**
 * Character span of a token's TEXT inside the normalized string.
 *
 * `tokenize` keeps edge punctuation inside [start, end) while stripping it from `raw`,
 * so slicing on start/end directly drags a trailing '.' into the message. Locating
 * `raw` within the span is what keeps the slice verbatim and clean at both ends.
 */
function textSpan(normalizedText: string, token: Token): { start: number; end: number } {
  const chunk = normalizedText.slice(token.start, token.end);
  const offset = chunk.indexOf(token.raw);
  const start = offset >= 0 ? token.start + offset : token.start;
  return { start, end: start + token.raw.length };
}

/**
 * The ש of 'שאני מאחר' is a complementizer; the ש of 'שלום' is part of the word.
 *
 * A positive test rather than a blocklist, because enumerating every ש-initial Hebrew
 * noun is a losing game. The ש counts only when what follows it opens a clause — a
 * pronoun or negator, or a ה-definite noun ('שהפגישה'), a combination essentially no
 * single Hebrew word begins with.
 *
 * Getting this wrong is safe in one direction only, and that is the direction it fails
 * in: a missed complementizer falls through to the "everything after the recipient"
 * rule, which yields a body with one extra leading word — never a truncated one.
 */
function complementizerForm(token: Token): TokenForm | undefined {
  for (const form of token.forms) {
    if (form.prefix === 'ש' && CLAUSE_OPENERS.has(form.stem)) return form;
    // 'שהפגישה' — ש + a definite noun. Only the ש is the marker; the ה belongs to the
    // word and must stay, which is why callers drop one character and not the prefix.
    if (form.prefix === 'שה' && form.stem.length > 1) return form;
  }
  return undefined;
}

/** Length of the marker to drop from the front of a body. Always just the ש. */
const COMPLEMENTIZER_LENGTH = 1;

/**
 * Find who the message is addressed to.
 *
 * Anchored to the verb and scanning right, taking the first ל-word that is a name
 * rather than grammar. The blocklist is what stops 'לשעה' and 'למחר' from being read
 * as people — nothing else protects them, since the scheduling matchers never run on
 * a send request.
 */
export function findRecipient(tokens: Token[], searchFrom: number): RecipientMatch | undefined {
  for (let index = searchFrom; index < tokens.length; index += 1) {
    const token = tokenAt(tokens, index);
    if (token === undefined) continue;

    // 'שלח הודעה לדניאל' — the noun sits between the verb and the recipient.
    if (hasAnyStem(token, MESSAGE_NOUNS) !== undefined) continue;
    if (RECIPIENT_SKIP.has(token.raw)) continue;

    // Past the body marker we are inside the message; a ל there is the user's own words.
    if (complementizerForm(token) !== undefined) return undefined;

    const lamed = token.forms.find((form) => form.prefix === 'ל');
    if (lamed === undefined || lamed.stem.length === 0) continue;
    if (RECIPIENT_BLOCKLIST.has(lamed.stem)) continue;

    return { name: lamed.stem, tokens: [index] };
  }

  return undefined;
}

/**
 * Find the message itself, as one contiguous slice running to the end of the utterance.
 *
 * Three anchors, tried in order: the ש complementizer, the word after 'הודעה', and
 * finally everything left after the recipient. The body is never trimmed at the far
 * end and no filler is dropped from it.
 */
export function findMessageBody(
  tokens: Token[],
  normalizedText: string,
  searchFrom: number,
): MessageBodyMatch | undefined {
  const last = tokens[tokens.length - 1];
  if (last === undefined) return undefined;

  let startIndex: number | undefined;
  let hasMarker = false;

  // The complementizer wins wherever it sits, so it is looked for across the whole
  // range BEFORE falling back to the noun. Taking the first anchor encountered instead
  // would leave the ש in place for 'שלח לדניאל הודעה שאני בדרך'.
  for (let index = searchFrom; index < tokens.length; index += 1) {
    const token = tokenAt(tokens, index);
    if (token === undefined) continue;

    if (complementizerForm(token) !== undefined) {
      startIndex = index;
      hasMarker = true;
      break;
    }
  }

  // 'שלח לדניאל הודעה אני בדרך' — no ש, so the message opens after the noun.
  if (startIndex === undefined) {
    for (let index = searchFrom; index < tokens.length; index += 1) {
      const token = tokenAt(tokens, index);
      if (token === undefined) continue;

      if (hasAnyStem(token, MESSAGE_NOUNS) !== undefined && index + 1 < tokens.length) {
        startIndex = index + 1;
        break;
      }
    }
  }

  // No marker at all: the message is simply whatever followed the recipient.
  if (startIndex === undefined && searchFrom < tokens.length) {
    startIndex = searchFrom;
  }

  if (startIndex === undefined) return undefined;

  const first = tokenAt(tokens, startIndex);
  if (first === undefined) return undefined;

  const span = textSpan(normalizedText, first);
  const from = hasMarker ? span.start + COMPLEMENTIZER_LENGTH : span.start;
  const to = textSpan(normalizedText, last).end;

  const text = normalizedText.slice(from, to).trim();
  if (text.length === 0) return undefined;

  const claimed: number[] = [];
  for (let index = startIndex; index < tokens.length; index += 1) claimed.push(index);

  return { text, tokens: claimed };
}
