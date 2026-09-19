/**
 * Matching a spoken name to a stored contact.
 *
 * Shares the parser's tokenizer with event matching, so the definite article and glued
 * particles behave identically in both — 'לאמא' resolves to 'אמא' the same way
 * 'הפגישה' resolves to 'פגישה'.
 *
 * What it deliberately does NOT share is `titleMatches`'s filler-word filtering. That
 * filter is right for an event phrase, where 'אפשר לבטל את הפגישה' should search for
 * 'הפגישה' alone. Applied to a name it is a bug: TITLE_FILLERS contains 'אני', 'זה',
 * 'תודה', 'יש' and 'מה', so every one of those, used as a contact name, filtered down
 * to nothing and the contact became permanently unreachable.
 *
 * A name is a name. Nothing is dropped from it.
 */

import type { Contact } from '../../storage/contacts';
import { stemsOf } from '../assistant/eventMatching';
import { normalizeText, tokenize } from '../parser/normalize';

/** True when every word of the query appears somewhere in the contact's name. */
export function nameMatches(contactName: string, query: string): boolean {
  const terms = tokenize(normalizeText(query))
    .map((token) => token.raw)
    .filter((raw) => raw.length > 0);

  if (terms.length === 0) return false;

  const nameStems = stemsOf(contactName);

  // Requiring ALL terms keeps 'דני כהן' from matching every דני in the book.
  return terms.every((term) => {
    for (const stem of stemsOf(term)) {
      if (nameStems.has(stem)) return true;
    }
    return false;
  });
}

/** Contacts whose name matches, in the order stored. */
export function findContactsByName(
  contacts: readonly Contact[],
  query: string,
): Contact[] {
  return contacts.filter((contact) => nameMatches(contact.name, query));
}

export type ContactChannel = 'gmail' | 'whatsapp';

/**
 * Every way this contact can be reached.
 *
 * Returning all of them rather than picking one is deliberate. Mail and WhatsApp are
 * not interchangeable — one sends by itself, the other lands on a phone the recipient
 * may check sooner — and which is wanted depends on the message, not on the contact.
 * So when both exist the caller asks, instead of applying a rule the user cannot see.
 *
 * Mail is listed first so a single-channel contact reads naturally in the reply.
 */
export function channelsFor(contact: Contact): ContactChannel[] {
  const channels: ContactChannel[] = [];
  if (contact.email !== undefined && contact.email.length > 0) channels.push('gmail');
  if (contact.phone !== undefined && contact.phone.length > 0) channels.push('whatsapp');
  return channels;
}
