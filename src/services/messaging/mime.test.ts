/**
 * Encoding tests.
 *
 * Hebrew corruption in email is silent — the request succeeds, the message arrives, and
 * the text is gibberish. So these decode the output back and compare, rather than
 * asserting against a hard-coded base64 string that would only prove it is stable.
 */

import { describe, expect, it } from 'vitest';
import {
  base64Url,
  base64Utf8,
  buildMimeMessage,
  buildRawMessage,
  encodeHeaderValue,
  subjectFromBody,
} from './mime';

/** Decode UTF-8 base64 back to text, the way a mail client would. */
function decodeUtf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeUrl(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return decodeUtf8(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

describe('base64 of Hebrew', () => {
  it.each([
    'אני מאחר',
    'תודה רבה על היום',
    'שלום! מה נשמע?',
    'אני מאחר בעשרים דקות 🙂',
    'mixed עברית and English',
  ])('round-trips %s', (text) => {
    expect(decodeUtf8(base64Utf8(text))).toBe(text);
  });

  it('does not throw on characters btoa cannot take', () => {
    // btoa('א') throws InvalidCharacterError. Encoding to UTF-8 bytes first is the fix,
    // and this is the test that would catch anyone removing it.
    expect(() => base64Utf8('א')).not.toThrow();
  });

  it('produces url-safe output with no padding', () => {
    const encoded = base64Url('אני מאחר מאוד מאוד');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(decodeUrl(encoded)).toBe('אני מאחר מאוד מאוד');
  });
});

describe('headers', () => {
  it('leaves plain ASCII readable', () => {
    expect(encodeHeaderValue('Running late')).toBe('Running late');
  });

  it('wraps Hebrew as an RFC 2047 encoded-word', () => {
    const encoded = encodeHeaderValue('אני מאחר');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);

    const payload = encoded.slice('=?UTF-8?B?'.length, -'?='.length);
    expect(decodeUtf8(payload)).toBe('אני מאחר');
  });
});

describe('the subject', () => {
  it('is the message itself when short', () => {
    expect(subjectFromBody('אני מאחר')).toBe('אני מאחר');
  });

  it('is only the first line', () => {
    expect(subjectFromBody('אני מאחר\nנתראה אחר כך')).toBe('אני מאחר');
  });

  it('is truncated rather than left to fill the notification', () => {
    const long = 'א'.repeat(200);
    const subject = subjectFromBody(long);
    expect(subject.length).toBeLessThanOrEqual(60);
    expect(subject.endsWith('…')).toBe(true);
  });

  it('never comes out empty', () => {
    expect(subjectFromBody('   ')).toBe('הודעה');
  });
});

describe('the assembled message', () => {
  const mail = { to: 'mom@example.com', subject: 'אני מאחר', body: 'אני מאחר בעשרים דקות' };

  it('declares UTF-8 and base64 so no transport can mangle it', () => {
    const message = buildMimeMessage(mail);
    expect(message).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(message).toContain('Content-Transfer-Encoding: base64');
    expect(message).toContain('To: mom@example.com');
  });

  it('separates headers from the body with a blank line', () => {
    const message = buildMimeMessage(mail);
    const [headers, body] = message.split('\r\n\r\n');
    expect(headers).toBeDefined();
    expect(body).toBeDefined();
    expect(decodeUtf8(body as string)).toBe('אני מאחר בעשרים דקות');
  });

  it('carries no raw Hebrew in the headers', () => {
    // A raw non-ASCII byte in a header is rejected or mangled by real mail servers.
    const headers = buildMimeMessage(mail).split('\r\n\r\n')[0] ?? '';
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(headers)).toBe(true);
  });

  it('round-trips the whole thing through the raw encoding', () => {
    expect(decodeUrl(buildRawMessage(mail))).toContain('To: mom@example.com');
  });
});
