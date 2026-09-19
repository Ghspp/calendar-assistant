/**
 * Building an RFC 2822 message that survives Hebrew.
 *
 * Email predates Unicode, and every layer here exists because of that:
 *
 *   - `btoa` throws on any code point above U+00FF, so the text is turned into UTF-8
 *     bytes first and only then base64'd. Passing Hebrew straight to btoa is the
 *     classic way this breaks.
 *   - A header cannot carry raw UTF-8 at all, so a Hebrew subject is wrapped in an
 *     RFC 2047 encoded-word.
 *   - The body is declared UTF-8 and base64 so no transport can mangle it.
 *
 * Nothing here does I/O; it is all pure string work, which is what lets the encoding
 * be tested directly rather than inferred from what lands in an inbox.
 */

/** Longest subject we build before trimming. Keeps the notification line readable. */
const MAX_SUBJECT_LENGTH = 60;

/** UTF-8 bytes of `text`, base64 encoded. */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

/**
 * base64url — what the Gmail API wants for the whole message.
 *
 * Standard base64 uses '+' and '/', which are not safe inside a JSON-delivered URL-ish
 * field; padding is dropped as the encoding specifies.
 */
export function base64Url(text: string): string {
  return base64Utf8(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encode a header value as an RFC 2047 encoded-word when it is not plain ASCII.
 *
 * Left alone when it is, so an English subject stays readable in a raw message dump.
 */
export function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64Utf8(value)}?=`;
}

/**
 * A subject derived from the message itself.
 *
 * There is no separate subject when speaking, and an empty one reads as spam, so the
 * opening of the message stands in for it — which is also what a phone shows in the
 * notification.
 */
export function subjectFromBody(body: string): string {
  const firstLine = body.split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) return 'הודעה';
  if (firstLine.length <= MAX_SUBJECT_LENGTH) return firstLine;
  return `${firstLine.slice(0, MAX_SUBJECT_LENGTH - 1).trimEnd()}…`;
}

export interface MailInput {
  to: string;
  subject: string;
  body: string;
}

/** The full RFC 2822 message, ready to be base64url'd and sent. */
export function buildMimeMessage(mail: MailInput): string {
  const headers = [
    `To: ${mail.to}`,
    `Subject: ${encodeHeaderValue(mail.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];

  return `${headers.join('\r\n')}\r\n\r\n${base64Utf8(mail.body)}`;
}

/** The value Gmail's `messages.send` expects in its `raw` field. */
export function buildRawMessage(mail: MailInput): string {
  return base64Url(buildMimeMessage(mail));
}
