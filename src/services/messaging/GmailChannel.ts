/**
 * Sending mail as the signed-in user, via the Gmail REST API.
 *
 * Shaped exactly like GoogleCalendarProvider — plain fetch with a bearer token, and
 * both the token source and fetch injected — so the tests drive the whole thing against
 * recorded responses and never reach the network. No message in a test can escape.
 *
 * The scope is send-only: this cannot read the mailbox, and there is no code here that
 * could. See GMAIL_SEND_SCOPE in calendar/auth.ts.
 */

import { CalendarError, kindFromStatus, type CalendarErrorKind } from '../calendar/errors';
import { buildRawMessage, subjectFromBody } from './mime';
// Type-only, so this erases at compile time and pulls in no calendar code.
import type { FetchLike } from '../calendar/GoogleCalendarProvider';

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/**
 * Failures worded for mail.
 *
 * The kinds and the status mapping are shared with the calendar — that classification
 * is the valuable part and should not be forked — but the sentences are not: telling
 * someone their *calendar* permission failed when a message did not send is a
 * misleading error, and misleading errors cost more than a duplicated table.
 */
const MAIL_MESSAGES: Record<CalendarErrorKind, string> = {
  'not-configured': 'החיבור ל-Google לא הוגדר. ראה את הוראות ההתקנה ב-README.',
  'not-authenticated': 'נדרשת התחברות מחדש ל-Google כדי לשלוח.',
  'permission-denied':
    'אין הרשאה לשלוח מייל. יש להתחבר מחדש ולאשר גם את הרשאת השליחה. ההודעה לא נשלחה.',
  'rate-limited': 'יותר מדי בקשות ל-Google. ההודעה לא נשלחה, נסה שוב בעוד רגע.',
  network: 'אין חיבור לשרתי Google. ההודעה לא נשלחה.',
  api: 'שגיאה בשליחת ההודעה דרך Google. ההודעה לא נשלחה.',
  unknown: 'אירעה שגיאה. ההודעה לא נשלחה.',
};

function mailError(
  kind: CalendarErrorKind,
  options?: { status?: number; detail?: string; cause?: unknown },
): CalendarError {
  return new CalendarError(kind, MAIL_MESSAGES[kind], options);
}

export interface GmailChannelOptions {
  getAccessToken: (options: { interactive: boolean }) => Promise<string>;
  onAuthExpired?: () => void;
  fetchImpl?: FetchLike;
}

export interface SentMail {
  id: string;
  to: string;
}

export interface GmailChannel {
  sendMail(to: string, body: string): Promise<SentMail>;
}

interface GmailSendResponse {
  id?: string;
}

interface GoogleErrorBody {
  error?: {
    message?: string;
    errors?: Array<{ reason?: string }>;
  };
}

async function readErrorReason(response: Response): Promise<{ reason?: string; detail?: string }> {
  try {
    const body: unknown = await response.json();
    const parsed = body as GoogleErrorBody;
    const first = parsed.error?.errors?.[0];
    return {
      ...(first?.reason !== undefined ? { reason: first.reason } : {}),
      ...(parsed.error?.message !== undefined ? { detail: parsed.error.message } : {}),
    };
  } catch {
    return {};
  }
}

export function createGmailChannel(options: GmailChannelOptions): GmailChannel {
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));

  async function sendMail(to: string, body: string): Promise<SentMail> {
    // interactive:false — a send happens after several awaits, far past the tap that
    // started it, so a popup here would be blocked. The scope was granted at connect.
    const token = await options.getAccessToken({ interactive: false });

    const raw = buildRawMessage({ to, subject: subjectFromBody(body), body });

    let response: Response;
    try {
      response = await doFetch(GMAIL_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ raw }),
      });
    } catch (cause) {
      // fetch rejects only on a transport failure, never on an HTTP error status.
      throw mailError('network', { cause });
    }

    if (!response.ok) {
      const { reason, detail } = await readErrorReason(response);
      const kind = kindFromStatus(response.status, reason);

      if (kind === 'not-authenticated') options.onAuthExpired?.();

      throw mailError(kind, {
        status: response.status,
        ...(detail !== undefined ? { detail } : {}),
      });
    }

    let parsed: GmailSendResponse;
    try {
      parsed = (await response.json()) as GmailSendResponse;
    } catch (cause) {
      throw mailError('api', { detail: 'תשובת Google אינה JSON תקין', cause });
    }

    return { id: parsed.id ?? '', to };
  }

  return { sendMail };
}
