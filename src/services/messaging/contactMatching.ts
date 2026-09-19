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
import { nameDistance } from './hebrewSimilarity';

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
  const exact = contacts.filter((contact) => nameMatches(contact.name, query));
  if (exact.length > 0) return exact;

  // The recogniser splits names as often as it mangles them: 'דניאל' comes back as two
  // tokens, 'דני אל'. Rejoining is an EXACT test with no threshold to tune, so it is
  // tried before anything approximate.
  const joined = query.replace(/\s+/g, '');
  if (joined !== query && joined.length > 0) {
    const rejoined = contacts.filter((contact) => nameMatches(contact.name, joined));
    if (rejoined.length > 0) return rejoined;
  }

  return findSimilarContacts(contacts, query);
}

/**
 * Contacts whose name is near enough to have been misheard as this.
 *
 * Only the closest are returned. Several at the same distance come back together — a
 * near match is less certain than an exact one, so the caller must still ask rather
 * than pick, exactly as it does for two exact matches.
 */
export function findSimilarContacts(
  contacts: readonly Contact[],
  query: string,
): Contact[] {
  const scored: Array<{ contact: Contact; distance: number }> = [];

  for (const contact of contacts) {
    const distance = nameDistance(contact.name, query);
    if (distance !== undefined) scored.push({ contact, distance });
  }

  if (scored.length === 0) return [];

  const best = Math.min(...scored.map((entry) => entry.distance));
  return scored.filter((entry) => entry.distance === best).map((entry) => entry.contact);
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
