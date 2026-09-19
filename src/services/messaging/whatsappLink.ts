/**
 * The WhatsApp fallback.
 *
 * WhatsApp has no free interface that sends on a user's behalf: the Business Cloud API
 * sends from a separate business number under template rules, and the unofficial
 * libraries need a server running the user's own session and risk the account. The
 * official click-to-chat link is the honest option — it opens the right conversation
 * with the text already typed, and the user presses send.
 *
 * So this is a link builder, not a channel that sends. That difference is deliberate
 * and is reflected in the outcome the assistant reports.
 */

/** Official click-to-chat host. Takes digits only — no '+', spaces or dashes. */
const WA_BASE = 'https://wa.me';

export function buildWhatsAppUrl(phone: string, body: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${WA_BASE}/${digits}?text=${encodeURIComponent(body)}`;
}
