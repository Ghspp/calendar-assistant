/**
 * Matching a spoken name to a stored contact.
 *
 * Reuses `titleMatches` rather than reimplementing Hebrew name matching: it already
 * handles the definite article and glued particles through the parser's own tokenizer,
 * so 'לאמא' → 'אמא' behaves identically here and in event lookup. A second, subtly
 * different matcher is exactly the kind of drift that makes 'why did it pick that one?'
 * impossible to answer.
 */

import type { Contact } from '../../storage/contacts';
import { titleMatches } from '../assistant/eventMatching';

/** Contacts whose name matches, in the order stored. */
export function findContactsByName(
  contacts: readonly Contact[],
  query: string,
): Contact[] {
  return contacts.filter((contact) => titleMatches(contact.name, query));
}

/** How a contact can be reached, if at all. */
export type ContactChannel = 'gmail' | 'whatsapp' | 'none';

/**
 * Pick the channel for a contact.
 *
 * Email wins when present because it is the only one that actually sends; WhatsApp
 * always leaves the user a tap to make.
 */
export function channelFor(contact: Contact): ContactChannel {
  if (contact.email !== undefined && contact.email.length > 0) return 'gmail';
  if (contact.phone !== undefined && contact.phone.length > 0) return 'whatsapp';
  return 'none';
}
