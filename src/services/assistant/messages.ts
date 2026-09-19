/**
 * Sending a message to a contact.
 *
 * The rule this file exists to enforce, and the reason the send is split across two
 * functions:
 *
 *   **Nothing leaves the device until the user has seen the exact recipient and the
 *   exact text and said yes.**
 *
 * `startMessage` can only ever get as far as composing and asking. `confirmMessage` is
 * the only function that delivers anything, and the conversation layer calls it only
 * after an explicit confirmation. This mirrors the delete flow, and for a stronger
 * reason: a deleted event can be recreated, a sent message cannot be unsent.
 *
 * An ambiguous name is never resolved by picking. Speech recognition mishears names
 * constantly, and 'send it to the first דניאל' is how the wrong person finds out.
 */

import type { ParsedCommand } from '../../types/parser';
import type { Contact } from '../../storage/contacts';
import type { GmailChannel } from '../messaging/GmailChannel';
import { channelsFor, findContactsByName } from '../messaging/contactMatching';
import { buildWhatsAppUrl } from '../messaging/whatsappLink';
import type { CommandOutcome } from './types';

export interface MessagingOptions {
  contacts: readonly Contact[];
  gmail: GmailChannel;
  /**
   * Whether the current Google grant actually covers sending mail.
   *
   * Google's granular consent lets the user approve the calendar and refuse Gmail, and
   * the refusal otherwise only surfaces as a 403 — after they have already confirmed a
   * message they believed was going out. Checking here fails before the question.
   *
   * Defaults to permitted so callers with no auth context (tests) are unaffected.
   */
  canSendMail?: boolean;
}

/**
 * Work out who and what, and ask.
 *
 * Every branch here returns without sending. That is the point of the function.
 */
export function startMessage(
  parsed: ParsedCommand,
  options: MessagingOptions,
): CommandOutcome {
  const name = parsed.recipient?.trim();
  if (name === undefined || name.length === 0) {
    return { kind: 'message-unclear', reason: 'no-recipient' };
  }

  const body = parsed.messageBody?.trim();
  if (body === undefined || body.length === 0) {
    return { kind: 'message-unclear', reason: 'no-body' };
  }

  const matches = findContactsByName(options.contacts, name);

  if (matches.length === 0) {
    return { kind: 'message-contact-not-found', name };
  }

  if (matches.length > 1) {
    return { kind: 'message-contact-ambiguous', name, matches };
  }

  const contact = matches[0];
  if (contact === undefined) return { kind: 'message-contact-not-found', name };

  // A channel the current Google grant cannot actually use is not on offer. Listing
  // it would invite the user to pick something that then fails.
  const channels = channelsFor(contact).filter(
    (channel) => channel !== 'gmail' || options.canSendMail !== false,
  );

  if (channels.length === 0) {
    // Distinguish 'no way to reach them' from 'the one way needs a permission you
    // refused', because the two need completely different things from the user.
    return channelsFor(contact).includes('gmail')
      ? { kind: 'message-unclear', reason: 'no-mail-permission' }
      : { kind: 'message-no-channel', contact };
  }

  if (channels.length > 1) {
    return { kind: 'message-choose-channel', contact, body, channels };
  }

  const channel = channels[0];
  if (channel === undefined) return { kind: 'message-no-channel', contact };

  return { kind: 'message-confirm', contact, body, channel };
}

/**
 * Deliver a message the user has confirmed.
 *
 * WhatsApp is reported as a handoff rather than a send, because that is what it is:
 * the app can open the conversation with the text ready, and no more.
 */
export async function confirmMessage(
  contact: Contact,
  body: string,
  channel: 'gmail' | 'whatsapp',
  options: MessagingOptions,
): Promise<CommandOutcome> {
  if (channel === 'whatsapp') {
    const phone = contact.phone;
    if (phone === undefined) return { kind: 'message-no-channel', contact };
    return { kind: 'message-handoff', contact, body, url: buildWhatsAppUrl(phone, body) };
  }

  const email = contact.email;
  if (email === undefined) return { kind: 'message-no-channel', contact };

  await options.gmail.sendMail(email, body);
  return { kind: 'message-sent', contact, body };
}
