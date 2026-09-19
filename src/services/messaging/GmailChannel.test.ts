/**
 * The Gmail channel, driven against an injected fetch.
 *
 * No test here touches the network. What they check is the shape of the request that
 * WOULD go out, and that every failure comes back as a Hebrew sentence saying the
 * message did not send — an error that leaves the user unsure is worse than none.
 */

import { describe, expect, it, vi } from 'vitest';
import { createGmailChannel } from './GmailChannel';
import { CalendarError } from '../calendar/errors';

function decodeUrl(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function okResponse(body: unknown = { id: 'm1' }): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number, reason?: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({
      error: { message: 'boom', ...(reason !== undefined ? { errors: [{ reason }] } : {}) },
    }),
  } as unknown as Response;
}

function channelWith(fetchImpl: ReturnType<typeof vi.fn>, onAuthExpired?: () => void) {
  return createGmailChannel({
    getAccessToken: async () => 'token-123',
    fetchImpl: fetchImpl as never,
    ...(onAuthExpired !== undefined ? { onAuthExpired } : {}),
  });
}

describe('sending', () => {
  it('posts to the send endpoint with a bearer token', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await channelWith(fetchImpl).sendMail('mum@example.com', 'אני מאחר');

    expect(fetchImpl).toHaveBeenCalledOnce();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-123');
  });

  it('carries the Hebrew message intact in the payload', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await channelWith(fetchImpl).sendMail('mum@example.com', 'אני מאחר בעשרים דקות');

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const { raw } = JSON.parse(init.body as string) as { raw: string };
    const message = decodeUrl(raw);

    expect(message).toContain('To: mum@example.com');
    expect(message).toContain('charset="UTF-8"');

    const body = message.split('\r\n\r\n')[1] ?? '';
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(body), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe('אני מאחר בעשרים דקות');
  });

  it('returns the id Google assigned', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ id: 'abc' }));
    const sent = await channelWith(fetchImpl).sendMail('mum@example.com', 'שלום');

    expect(sent).toEqual({ id: 'abc', to: 'mum@example.com' });
  });

  it('never opens a consent popup mid-send', async () => {
    // A send happens several awaits past the tap, so an interactive request here would
    // be blocked by the browser and the message would silently fail.
    const getAccessToken = vi.fn(async () => 'token-123');
    const channel = createGmailChannel({
      getAccessToken,
      fetchImpl: (async () => okResponse()) as never,
    });

    await channel.sendMail('mum@example.com', 'שלום');
    expect(getAccessToken).toHaveBeenCalledWith({ interactive: false });
  });
});

describe('failures', () => {
  it.each([
    [401, undefined, 'not-authenticated'],
    [403, undefined, 'permission-denied'],
    [403, 'rateLimitExceeded', 'rate-limited'],
    [429, undefined, 'rate-limited'],
    [500, undefined, 'api'],
  ])('maps %s to %s', async (status, reason, kind) => {
    const fetchImpl = vi.fn(async () => errorResponse(status as number, reason as string));

    await expect(
      channelWith(fetchImpl).sendMail('mum@example.com', 'שלום'),
    ).rejects.toMatchObject({ kind });
  });

  it('says the message did not send, in Hebrew, and never mentions the calendar', async () => {
    const fetchImpl = vi.fn(async () => errorResponse(403));

    await expect(channelWith(fetchImpl).sendMail('mum@example.com', 'שלום')).rejects.toSatisfy(
      (error: unknown) => {
        const message = (error as CalendarError).hebrewMessage;
        return message.includes('לא נשלחה') && !message.includes('יומן');
      },
    );
  });

  it('reports a transport failure rather than leaking the raw error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(
      channelWith(fetchImpl).sendMail('mum@example.com', 'שלום'),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('tells the caller to drop a dead token', async () => {
    const onAuthExpired = vi.fn();
    const fetchImpl = vi.fn(async () => errorResponse(401));

    await expect(
      channelWith(fetchImpl, onAuthExpired).sendMail('mum@example.com', 'שלום'),
    ).rejects.toThrow();

    expect(onAuthExpired).toHaveBeenCalledOnce();
  });
});
