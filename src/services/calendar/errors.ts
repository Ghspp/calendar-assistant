/**
 * Calendar error taxonomy.
 *
 * Every failure the UI can encounter is one of these kinds, each carrying a Hebrew
 * message ready to display. Callers switch on `kind` rather than parsing messages.
 */

export type CalendarErrorKind =
  | 'not-configured'
  | 'not-authenticated'
  | 'permission-denied'
  | 'rate-limited'
  | 'network'
  | 'api'
  | 'unknown';

export class CalendarError extends Error {
  readonly kind: CalendarErrorKind;
  readonly hebrewMessage: string;
  readonly status?: number;

  constructor(kind: CalendarErrorKind, hebrewMessage: string, options?: {
    status?: number;
    detail?: string;
    cause?: unknown;
  }) {
    super(options?.detail ?? hebrewMessage);
    this.name = 'CalendarError';
    this.kind = kind;
    this.hebrewMessage = hebrewMessage;
    if (options?.status !== undefined) this.status = options.status;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

const MESSAGES: Record<CalendarErrorKind, string> = {
  'not-configured': 'החיבור ל-Google Calendar לא הוגדר. ראה את הוראות ההתקנה ב-README.',
  'not-authenticated': 'נדרשת התחברות ל-Google Calendar.',
  'permission-denied': 'אין הרשאה לקרוא את היומן. יש לאשר את ההרשאה בחשבון Google.',
  'rate-limited': 'יותר מדי בקשות ל-Google. נסה שוב בעוד רגע.',
  network: 'אין חיבור לשרתי Google. בדוק את חיבור האינטרנט.',
  api: 'שגיאה בקריאת היומן מ-Google.',
  unknown: 'אירעה שגיאה בלתי צפויה.',
};

export function calendarError(
  kind: CalendarErrorKind,
  options?: { status?: number; detail?: string; cause?: unknown },
): CalendarError {
  return new CalendarError(kind, MESSAGES[kind], options);
}

/**
 * Translate an HTTP status from the Calendar API into an error kind.
 *
 * 401 means the token is dead — the caller should drop it and re-authenticate.
 * 403 is overloaded: Google uses it both for a missing scope and for quota, so the
 * reason string decides.
 */
export function kindFromStatus(status: number, reason?: string): CalendarErrorKind {
  if (status === 401) return 'not-authenticated';
  if (status === 403) {
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
      return 'rate-limited';
    }
    return 'permission-denied';
  }
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'api';
  return 'api';
}
