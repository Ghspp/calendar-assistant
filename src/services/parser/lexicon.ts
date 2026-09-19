/**
 * Hebrew word lists. This is the single place to extend the parser's vocabulary —
 * no other module should hard-code Hebrew words.
 *
 * Keys are *stems*: the form left after prefix stripping (see normalize.ts). So the
 * lexicon stores 'שש', and the tokenizer is what turns 'בשש' into it.
 */

import type { Intent } from '../../types/parser';

/**
 * Single-letter particles Hebrew glues onto the front of words:
 * ב (in/at) ל (to/for) ה (the) מ (from) ו (and) כ (as) ש (that).
 *
 * Which prefix was stripped carries meaning the parser relies on — most importantly
 * ב+שעה ('at the hour', a time marker) versus ל+שעה ('for an hour', a duration).
 */
export const PREFIX_LETTERS = new Set(['ב', 'ל', 'ה', 'מ', 'ו', 'כ', 'ש']);

/** Multi-word intent phrases, checked before single verbs. Listed longest-first. */
export const INTENT_PHRASES: Array<{ words: string[]; intent: Intent }> = [
  // 'במקום' means "instead of", which is inherently a replacement. It must be
  // recognised here rather than later, because 'במקום דניאל תשים אברהם' contains the
  // CREATE verb 'תשים' and would otherwise be read as a request for a NEW event.
  { words: ['במקום'], intent: 'UPDATE' },
  { words: ['באיזו', 'שעה', 'אני', 'פנוי'], intent: 'FIND_FREE' },
  { words: ['באיזה', 'שעה', 'אני', 'פנוי'], intent: 'FIND_FREE' },
  { words: ['מצא', 'לי'], intent: 'FIND_FREE' },
  { words: ['תמצא', 'לי'], intent: 'FIND_FREE' },
  { words: ['יש', 'לי', 'זמן', 'פנוי'], intent: 'FIND_FREE' },
  { words: ['מתי', 'אני', 'פנוי'], intent: 'FIND_FREE' },
  { words: ['מתי', 'אני', 'פנויה'], intent: 'FIND_FREE' },
  { words: ['זמן', 'פנוי'], intent: 'FIND_FREE' },
  { words: ['חלון', 'פנוי'], intent: 'FIND_FREE' },
  { words: ['מה', 'קבוע', 'לי'], intent: 'QUERY' },
  { words: ['מה', 'התוכניות'], intent: 'QUERY' },
  { words: ['מה', 'קורה'], intent: 'QUERY' },
  { words: ['מה', 'מתוכנן'], intent: 'QUERY' },
  { words: ['יש', 'לי', 'משהו'], intent: 'QUERY' },
  { words: ['מה', 'מתוכנן', 'לי'], intent: 'QUERY' },
  { words: ['מה', 'יש', 'לי'], intent: 'QUERY' },
  { words: ['אני', 'פנוי'], intent: 'QUERY' },
  { words: ['אני', 'פנויה'], intent: 'QUERY' },
  { words: ['מה', 'יש'], intent: 'QUERY' },
];

/** Single-token intent verbs, matched against any prefix-stripped form. */
export const INTENT_VERBS = new Map<string, Intent>([
  // Create
  ['תקבע', 'CREATE'],
  ['תקבעי', 'CREATE'],
  ['קבע', 'CREATE'],
  ['קבעי', 'CREATE'],
  ['שים', 'CREATE'],
  ['תשים', 'CREATE'],
  ['שימי', 'CREATE'],
  ['הוסף', 'CREATE'],
  ['תוסיף', 'CREATE'],
  ['תרשום', 'CREATE'],
  ['רשום', 'CREATE'],
  ['תזכיר', 'CREATE'],
  ['תקבעי', 'CREATE'],
  // Infinitives, which is how a request phrased politely arrives:
  // 'אפשר לקבוע', 'אני רוצה לקבוע', 'צריך לקבוע'.
  ['לקבוע', 'CREATE'],
  ['לשים', 'CREATE'],
  ['להוסיף', 'CREATE'],
  ['לרשום', 'CREATE'],
  ['להזכיר', 'CREATE'],
  // Delete
  ['בטל', 'DELETE'],
  ['תבטל', 'DELETE'],
  ['בטלי', 'DELETE'],
  ['מחק', 'DELETE'],
  ['תמחק', 'DELETE'],
  ['הסר', 'DELETE'],
  ['תסיר', 'DELETE'],
  ['תוריד', 'DELETE'],
  ['הורד', 'DELETE'],
  ['לבטל', 'DELETE'],
  ['למחוק', 'DELETE'],
  ['להסיר', 'DELETE'],
  // Update / move
  ['העבר', 'UPDATE'],
  ['תעביר', 'UPDATE'],
  ['שנה', 'UPDATE'],
  ['תשנה', 'UPDATE'],
  ['דחה', 'UPDATE'],
  ['תדחה', 'UPDATE'],
  ['הזז', 'UPDATE'],
  ['תזיז', 'UPDATE'],
  ['עדכן', 'UPDATE'],
  ['תעדכן', 'UPDATE'],
  ['עדכני', 'UPDATE'],
  ['החלף', 'UPDATE'],
  ['תחליף', 'UPDATE'],
  ['תחליפי', 'UPDATE'],
  ['תקדים', 'UPDATE'],
  ['הקדם', 'UPDATE'],
  ['להעביר', 'UPDATE'],
  ['לשנות', 'UPDATE'],
  ['לעדכן', 'UPDATE'],
  ['להחליף', 'UPDATE'],
  ['להזיז', 'UPDATE'],
  ['לדחות', 'UPDATE'],
  // Query
  ['מתי', 'QUERY'],
  // Find free
  ['מצא', 'FIND_FREE'],
  ['תמצא', 'FIND_FREE'],
]);

/**
 * Verbs that carry an intent only when they take an object.
 *
 * 'תגיד' on its own is a discourse opener — 'תגיד מה יש לי מחר' is a QUERY, and putting
 * it in INTENT_VERBS would let leftmost-wins steal that whole sentence. It means "send
 * a message" only when a ל-object or a message noun follows, so the gate is what keeps
 * both readings available. See `takesObject` in intent.ts.
 */
export const OBJECT_VERBS = new Map<string, Intent>([
  ['שלח', 'SEND_MESSAGE'],
  ['שלחי', 'SEND_MESSAGE'],
  ['תשלח', 'SEND_MESSAGE'],
  ['תשלחי', 'SEND_MESSAGE'],
  // ל-stripping turns 'לשלוח' into stem 'שלוח', so the infinitive needs its own key.
  ['לשלוח', 'SEND_MESSAGE'],
  ['תגיד', 'SEND_MESSAGE'],
  ['תגידי', 'SEND_MESSAGE'],
  ['להגיד', 'SEND_MESSAGE'],
  ['תמסור', 'SEND_MESSAGE'],
  ['מסור', 'SEND_MESSAGE'],
  ['למסור', 'SEND_MESSAGE'],
  ['תכתוב', 'SEND_MESSAGE'],
  ['כתוב', 'SEND_MESSAGE'],
  ['לכתוב', 'SEND_MESSAGE'],
]);

/** How far past the verb the object may sit: 'שלח הודעה לדניאל' needs two. */
export const OBJECT_LOOKAHEAD = 2;

/** Nouns naming the thing being sent. Skipped when looking for the recipient. */
export const MESSAGE_NOUNS = new Set([
  'הודעה',
  'הודעת',
  'הודעות',
  'מסר',
  'וואטסאפ',
  'ווטסאפ',
  'סמס',
  'מייל',
  'אימייל',
]);

/**
 * Words that can open a clause after ש.
 *
 * This is the POSITIVE test that separates the complementizer ש of 'שאני מאחר' from
 * the plain ש of 'שלום'. A blocklist of ש-initial nouns would be endless; asking what
 * follows the ש is decidable.
 */
export const CLAUSE_OPENERS = new Set([
  'אני',
  'אנחנו',
  'אתה',
  'אתם',
  'הוא',
  'היא',
  'הם',
  'הן',
  'יש',
  'אין',
  'לא',
  'כבר',
  'זה',
  'צריך',
  'צריכה',
  'אפשר',
  'נראה',
  'מחר',
  'היום',
  'הכל',
  'תודה',
]);

/** Politeness and particles that may sit between the verb and the recipient. */
export const RECIPIENT_SKIP = new Set(['לי', 'בבקשה', 'נא', 'את', 'מהר', 'תכף', 'עכשיו']);

/**
 * Hour numerals, masculine and feminine. Used for both times and duration counts.
 * Two-word numerals (11, 12) live in NUMBER_WORD_PAIRS.
 */
export const NUMBER_WORDS = new Map<string, number>([
  ['אחת', 1],
  ['אחד', 1],
  ['שתיים', 2],
  ['שתים', 2],
  ['שניים', 2],
  ['שנים', 2],
  ['שלוש', 3],
  ['שלושה', 3],
  ['ארבע', 4],
  ['ארבעה', 4],
  ['חמש', 5],
  ['חמישה', 5],
  ['שש', 6],
  ['שישה', 6],
  ['שבע', 7],
  ['שבעה', 7],
  ['שמונה', 8],
  ['תשע', 9],
  ['תשעה', 9],
  ['עשר', 10],
  ['עשרה', 10],
  ['עשרים', 20],
  ['שלושים', 30],
  ['ארבעים', 40],
  ['חמישים', 50],
  ['שישים', 60],
  ['שבעים', 70],
  ['שמונים', 80],
  ['תשעים', 90],
]);

/** Numerals written as two tokens. Checked before single-token numerals. */
export const NUMBER_WORD_PAIRS: Array<{ words: [string, string]; value: number }> = [
  { words: ['אחת', 'עשרה'], value: 11 },
  { words: ['אחד', 'עשר'], value: 11 },
  { words: ['שתים', 'עשרה'], value: 12 },
  { words: ['שתיים', 'עשרה'], value: 12 },
  { words: ['שנים', 'עשר'], value: 12 },
  { words: ['שניים', 'עשר'], value: 12 },
];

/** 0 = Sunday, matching JavaScript's getDay(). */
export const WEEKDAYS = new Map<string, number>([
  ['ראשון', 0],
  ['שני', 1],
  ['שלישי', 2],
  ['רביעי', 3],
  ['חמישי', 4],
  ['שישי', 5],
  ['שישית', 5],
  ['שבת', 6],
]);

/**
 * Weekday names that collide with a numeral and therefore require an explicit 'יום'
 * before them. 'שני' is both 'Monday' and the construct form of 'two', so
 * 'ביום שני' is a weekday but a bare 'שני' is not.
 */
export const WEEKDAY_STEMS_REQUIRING_YOM = new Set(['שני']);

/**
 * Day offsets relative to today.
 *
 * Note there is deliberately no bare 'יום' entry: 'ביום שישי' strips to ב+'יום', and a
 * 'יום' → today mapping would swallow it and resolve the whole phrase to today.
 * 'היום' is matched as a whole token before any prefix stripping happens.
 */
export const RELATIVE_DAYS = new Map<string, number>([
  ['היום', 0],
  ['מחר', 1],
  ['מחרתיים', 2],
  ['מחרותיים', 2],
]);

/**
 * Nouns whose construct form swallows a day-part word: 'ארוחת ערב', 'ארוחת הצהריים'.
 *
 * These name a meal, not a time of day, so the word inside them must never be read as
 * a qualifier or as a date — nor stripped out of the event's title.
 */
export const CONSTRUCT_HEADS = new Set(['ארוחת', 'ארוחה', 'משמרת', 'מסיבת', 'שיעורי']);

/**
 * Day-part words that also name TODAY: 'הערב' is this evening, 'הבוקר' this morning.
 *
 * They double as time qualifiers, which is exactly right — 'הערב בשמונה' fixes both
 * the day and the fact that eight means twenty hundred.
 */
export const DAY_PART_DAYS = new Set(['הערב', 'הבוקר', 'הצהריים', 'הצהרים', 'הלילה']);

export type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

/** Single-token day-part qualifiers. These RESOLVE an otherwise ambiguous hour. */
export const DAY_PARTS = new Map<string, DayPart>([
  ['בוקר', 'morning'],
  ['צהריים', 'noon'],
  ['צהרים', 'noon'],
  ['ערב', 'evening'],
  ['לילה', 'night'],
  ['אחהצ', 'afternoon'],
  ['אחה"צ', 'afternoon'],
]);

/** Multi-token day-part qualifiers, checked before the single-token map. */
export const DAY_PART_PHRASES: Array<{ words: string[]; part: DayPart }> = [
  { words: ['אחר', 'הצהריים'], part: 'afternoon' },
  { words: ['אחר', 'הצהרים'], part: 'afternoon' },
  { words: ['אחרי', 'הצהריים'], part: 'afternoon' },
  { words: ['אחרי', 'הצהרים'], part: 'afternoon' },
];

/** Minutes contributed by fractional modifiers following an hour. */
export const HOUR_FRACTIONS = new Map<string, number>([
  ['חצי', 30],
  ['רבע', 15],
]);

/** Duration units, in minutes per unit. */
export const DURATION_UNITS = new Map<string, number>([
  ['שעה', 60],
  ['שעות', 60],
  ['דקה', 1],
  ['דקות', 1],
]);

/** Duration words that already carry their own count. */
export const FIXED_DURATIONS = new Map<string, number>([
  ['שעתיים', 120],
  ['שעתים', 120],
]);

/**
 * Words that introduce a duration without the ל particle: 'למשך שעה', 'של שעתיים'.
 * 'של' is broad, but harmless — if what follows is not a duration body the parser
 * simply moves on, so 'הפגישה של דניאל' is unaffected.
 */
export const DURATION_MARKERS = new Set(['למשך', 'משך', 'של']);

/** Marks the following time expression as an end time. */
export const END_TIME_MARKERS = new Set(['עד']);

/** 'שעה' after ב/ל introduces a clock time rather than a duration, e.g. 'בשעה 17:00'. */
export const HOUR_MARKER_STEM = 'שעה';

/** Week-scope modifiers. */
export const THIS_WEEK_TOKENS = new Set(['השבוע']);

/**
 * 'בזמן הפנוי הראשון' — let the assistant choose the earliest gap that fits.
 *
 * Matched before the time parser runs, so the 'בשעה' of 'בשעה הפנויה הראשונה' is
 * consumed here rather than being read as the start of a clock time.
 */
export const FIRST_FREE_PHRASES: string[][] = [
  ['בזמן', 'הפנוי', 'הראשון'],
  ['בשעה', 'הפנויה', 'הראשונה'],
  ['בחלון', 'הפנוי', 'הראשון'],
  ['בזמן', 'הפנוי'],
  ['בזמן', 'פנוי'],
  ['מתי', 'שפנוי'],
  ['מתי', 'שיהיה', 'פנוי'],
];

/** 'סוף השבוע' — Friday and Saturday in Israel. */
export const WEEKEND_PHRASES: string[][] = [
  ['סוף', 'השבוע'],
  ['בסוף', 'השבוע'],
  ['סופש'],
];
export const NEXT_WEEK_PHRASES: string[][] = [
  ['שבוע', 'הבא'],
  ['השבוע', 'הבא'],
];

/** 'בעוד N ...' — in N days/weeks from now. */
export const IN_FUTURE_MARKER = 'בעוד';
export const DUAL_PERIODS = new Map<string, number>([
  ['יומיים', 2],
  ['שבועיים', 14],
]);
export const PERIOD_DAYS = new Map<string, number>([
  ['יום', 1],
  ['ימים', 1],
  ['שבוע', 7],
  ['שבועות', 7],
]);

/**
 * Words dropped from the title. Deliberately conservative — 'עם' is kept so
 * 'פגישה עם דניאל' survives intact.
 */
export const TITLE_FILLERS = new Set([
  'לי',
  'את',
  'יש',
  'אני',
  // Politeness and framing. Without these, 'אפשר לבטל את הפגישה' searches the
  // calendar for an event called 'אפשר הפגישה'.
  'אפשר',
  'תוכל',
  'תוכלי',
  'רוצה',
  'צריך',
  'צריכה',
  'טובה',
  'תעשה',
  'משהו',
  'מה',
  'קורה',
  'התוכניות',
  'תראה',
  'חלון',
  'לו',
  'לה',
  'בבקשה',
  'נא',
  'תודה',
  'כבר',
  'ה',
  'זה',
  'שלי',
]);

/**
 * Stems that follow ל as grammar rather than as a person: 'לשעה', 'למחר', 'לשבת'.
 *
 * DERIVED from the vocabulary already declared above rather than retyped, so a word
 * added to the date or duration lists automatically stops being mistaken for a contact
 * name. Retyping it would rot the moment someone extends one of those maps.
 *
 * WEEKDAY_STEMS_REQUIRING_YOM is subtracted back out: a bare 'שני' is deliberately not
 * a weekday for the date parser either, so 'תשלח לשני' is a person named שני.
 */
export const RECIPIENT_BLOCKLIST: ReadonlySet<string> = new Set(
  [
    ...DURATION_UNITS.keys(),
    ...FIXED_DURATIONS.keys(),
    ...NUMBER_WORDS.keys(),
    ...RELATIVE_DAYS.keys(),
    ...WEEKDAYS.keys(),
    ...DAY_PARTS.keys(),
    ...PERIOD_DAYS.keys(),
    ...DUAL_PERIODS.keys(),
    ...DURATION_MARKERS,
    HOUR_MARKER_STEM,
    // Pronoun suffixes that survive ל-stripping: 'לי', 'לך', 'לו', 'לה', 'לנו'.
    'י',
    'ך',
    'ו',
    'ה',
    'נו',
    'הם',
    'כם',
  ].filter((stem) => !WEEKDAY_STEMS_REQUIRING_YOM.has(stem)),
);
