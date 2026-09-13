/**
 * Text normalization and the prefix-stripping tokenizer.
 *
 * All later stages work in *normalized space*: matcher spans and the extracted title
 * both refer to the normalized string, never to the raw input. That keeps index
 * bookkeeping trivial even though normalization changes the string's length.
 */

import { PREFIX_LETTERS } from './lexicon';

/**
 * Hebrew points and cantillation marks. Speech input has none; typed input may.
 * U+05BE (maqaf) is deliberately excluded from the range — it lives inside it but is a
 * hyphen, not a point, and is handled by DASHES below.
 */
const NIQQUD = /[֑-ֽֿ-ׇ]/g;

/** Maqaf, hyphens and dashes that all mean the same thing here. */
const DASHES = /[־‐‑‒–—―]/g;

/** Hebrew geresh / gershayim, normalized to ASCII quotes. */
const GERESH = /׳/g;
const GERSHAYIM = /״/g;

/** Bidi control characters that speech/keyboard input sometimes carries. */
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

/** Punctuation stripped from a token's edges. ':' is preserved — it is part of 17:00. */
const EDGE_PUNCTUATION = /^[.,!?;"'()]+|[.,!?;"'()]+$/g;

/**
 * Canonicalize raw input.
 *
 * Deliberately does NOT lowercase Hebrew (it has no case) but does lowercase Latin so
 * 'PM' and 'pm' are one thing.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(BIDI_CONTROLS, '')
    .replace(NIQQUD, '')
    .replace(DASHES, '-')
    .replace(GERESH, "'")
    .replace(GERSHAYIM, '"')
    .replace(/[A-Z]+/g, (match) => match.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One reading of a token: the particles peeled off the front, and what remains.
 *
 * `forms[0]` is always the untouched token, so a word that is *itself* in the lexicon
 * wins before any stripping happens. That is what stops 'מחר' (tomorrow) being read as
 * מ + 'חר', and 'שים' (put) as ש + 'ים'.
 */
export interface TokenForm {
  /** Particles removed, in order, e.g. 'ב'. Empty for the untouched form. */
  prefix: string;
  /** What is left after removing them. */
  stem: string;
}

export interface Token {
  /** Token text, normalized and stripped of edge punctuation. */
  raw: string;
  /** Character offset of the token in the normalized string. */
  start: number;
  end: number;
  /** Candidate readings, least-stripped first. */
  forms: TokenForm[];
}

/** At most two particles are peeled, which covers forms like 'כשה...'. */
const MAX_PREFIXES = 2;

function buildForms(raw: string): TokenForm[] {
  const forms: TokenForm[] = [{ prefix: '', stem: raw }];

  let rest = raw;
  let prefix = '';

  for (let depth = 0; depth < MAX_PREFIXES; depth += 1) {
    const first = rest[0];
    if (first === undefined || !PREFIX_LETTERS.has(first)) break;

    let next = rest.slice(1);
    // 'ב-6' and 'ל-30' attach the particle with a hyphen.
    if (next.startsWith('-')) next = next.slice(1);
    if (next.length === 0) break;

    prefix += first;
    rest = next;
    forms.push({ prefix, stem: rest });
  }

  return forms;
}

/** Split normalized text into tokens carrying their prefix-stripped readings. */
export function tokenize(normalized: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\S+/g;

  let match = pattern.exec(normalized);
  while (match !== null) {
    const original = match[0];
    const cleaned = original.replace(EDGE_PUNCTUATION, '');

    if (cleaned.length > 0) {
      tokens.push({
        raw: cleaned,
        start: match.index,
        end: match.index + original.length,
        forms: buildForms(cleaned),
      });
    }

    match = pattern.exec(normalized);
  }

  return tokens;
}

/** Safe indexed access — `noUncheckedIndexedAccess` is on for this project. */
export function tokenAt(tokens: Token[], index: number): Token | undefined {
  return index >= 0 && index < tokens.length ? tokens[index] : undefined;
}

/**
 * First form of `token` whose stem is a key of `lexicon`, honouring an optional
 * restriction on which particle may have been stripped.
 */
export function matchForm<T>(
  token: Token,
  lexicon: Map<string, T>,
  allowedPrefixes?: ReadonlySet<string>,
): { form: TokenForm; value: T } | undefined {
  for (const form of token.forms) {
    if (allowedPrefixes && !allowedPrefixes.has(form.prefix)) continue;
    const value = lexicon.get(form.stem);
    if (value !== undefined) return { form, value };
  }
  return undefined;
}

/** True when any reading of `token` has this exact stem. */
export function hasStem(
  token: Token,
  stem: string,
  allowedPrefixes?: ReadonlySet<string>,
): TokenForm | undefined {
  for (const form of token.forms) {
    if (allowedPrefixes && !allowedPrefixes.has(form.prefix)) continue;
    if (form.stem === stem) return form;
  }
  return undefined;
}

/** True when any reading of `token` appears in `stems`. */
export function hasAnyStem(token: Token, stems: ReadonlySet<string>): TokenForm | undefined {
  for (const form of token.forms) {
    if (stems.has(form.stem)) return form;
  }
  return undefined;
}

/**
 * Match a fixed sequence of stems starting at `index`.
 * Returns the index just past the phrase, or undefined.
 */
export function matchPhrase(tokens: Token[], index: number, words: string[]): number | undefined {
  for (let offset = 0; offset < words.length; offset += 1) {
    const token = tokenAt(tokens, index + offset);
    const word = words[offset];
    if (token === undefined || word === undefined) return undefined;
    if (hasStem(token, word) === undefined) return undefined;
  }
  return index + words.length;
}
