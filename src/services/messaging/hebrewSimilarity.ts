/**
 * How close two Hebrew names are.
 *
 * Speech recognition returns names that are nearly right — `דניאל` comes back as
 * `דניאלה`, `דני אל`, or with a final letter written the other way. The contact book is
 * a small closed set, which is exactly the situation where a local comparison recovers
 * what a paid cloud recogniser would have sold as phrase hints.
 *
 * Pure, no dependency. Deliberately NOT wired into `normalizeText`: that function's
 * output is the verbatim message the user sends and the coordinate system every matcher
 * spans against, so folding letters there would change text people read.
 */

/** Hebrew final forms and the ordinary letters they are the same letter as. */
const FINAL_FORMS = new Map([
  ['ך', 'כ'],
  ['ם', 'מ'],
  ['ן', 'נ'],
  ['ף', 'פ'],
  ['ץ', 'צ'],
]);

/**
 * Reduce a name to the form worth comparing.
 *
 * Final letters are positional, not different letters — `דן` and a mid-word `דנ` are the
 * same name. Doubled vav and yod are a spelling choice the transcriber makes
 * inconsistently (`דויד` / `דוד`), so they collapse too. Spaces go because a name split
 * in two by the recogniser is still one name.
 */
export function foldHebrew(text: string): string {
  let folded = '';
  for (const char of text.normalize('NFC')) {
    folded += FINAL_FORMS.get(char) ?? char;
  }

  return folded
    .replace(/וו/g, 'ו')
    .replace(/יי/g, 'י')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** Levenshtein distance, two rows rather than a full matrix. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] ?? 0) + 1;
      const deletion = (previous[j] ?? 0) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    previous = current;
  }

  return previous[b.length] ?? Math.max(a.length, b.length);
}

/**
 * How many edits are forgivable for a name this long.
 *
 * Tight on purpose, and the ceiling is not a matter of taste — two edits apart is
 * `יוסי` versus `רותי`, and `דני כהן` versus `דני לוי`. Those are different people, and
 * allowing two edits on a short name would merge them. Longer names have more room
 * because a single mis-heard syllable costs proportionally less of the word.
 */
export function allowedEdits(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  return 2;
}

/**
 * Distance between two names after folding, or undefined when they are too far apart.
 *
 * Returning the distance rather than a boolean lets the caller rank candidates and
 * refuse to choose between two that score the same.
 */
export function nameDistance(a: string, b: string): number | undefined {
  const left = foldHebrew(a);
  const right = foldHebrew(b);
  if (left.length === 0 || right.length === 0) return undefined;

  if (left === right) return 0;

  // Measured against the shorter name: 'דני' inside 'דניאל' is a 2-edit gap that a
  // 3-letter budget would never forgive, and it should not — see the joining rule in
  // contactMatching, which handles a split name exactly rather than approximately.
  const budget = allowedEdits(Math.min(left.length, right.length));
  if (budget === 0) return undefined;

  const distance = editDistance(left, right);
  return distance <= budget ? distance : undefined;
}
