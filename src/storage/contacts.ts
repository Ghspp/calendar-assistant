/**
 * The local contact book.
 *
 * Only what is needed to address a message: a name to say out loud, and somewhere to
 * send it. Contacts are written by the user, stay on this device, and are never synced
 * anywhere — the app has no backend to sync them to.
 *
 * Every access is wrapped, like prefs.ts: localStorage throws in private mode and in
 * some embedded webviews, and must never take the app down.
 */

const CONTACTS_KEY = 'voice-calendar.contacts.v1';

/** Israel. Used only to expand a local number like 050-… into international form. */
const DEFAULT_COUNTRY_CODE = '972';

export interface Contact {
  id: string;
  /** What the user calls them out loud: 'אמא', 'דניאל'. */
  name: string;
  email?: string;
  /** Digits only, international, no '+' — e.g. '972501234567'. */
  phone?: string;
}

/**
 * Reduce a typed or picked phone number to the digits `wa.me` expects.
 *
 * A leading 0 is a national prefix and is replaced by the country code; anything
 * already international is only stripped of punctuation. Returns undefined rather than
 * a guess when there are too few digits to be a real number.
 */
export function normalizePhone(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;

  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return undefined;

  if (international) {
    const withoutTrunk = digits.startsWith('00') ? digits.slice(2) : digits;
    return withoutTrunk.length >= 7 ? withoutTrunk : undefined;
  }

  if (digits.startsWith('0')) return `${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;

  return digits;
}

/** Loose check — enough to catch a typo, not an attempt to validate RFC 5322. */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function readContact(value: unknown): Contact | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const record = value as Record<string, unknown>;
  const id = record['id'];
  const name = record['name'];
  const email = record['email'];
  const phone = record['phone'];

  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (typeof name !== 'string' || name.trim().length === 0) return undefined;

  return {
    id,
    name: name.trim(),
    ...(typeof email === 'string' && email.length > 0 ? { email } : {}),
    ...(typeof phone === 'string' && phone.length > 0 ? { phone } : {}),
  };
}

/**
 * Read the contact book.
 *
 * A malformed entry is dropped on its own rather than discarding the whole list — one
 * bad row should not cost the user every contact they have entered.
 */
export function loadContacts(): Contact[] {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const contacts: Contact[] = [];
    for (const entry of parsed) {
      const contact = readContact(entry);
      if (contact !== undefined) contacts.push(contact);
    }
    return contacts;
  } catch {
    return [];
  }
}

export function saveContacts(contacts: readonly Contact[]): void {
  try {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
  } catch {
    // Storage unavailable or full. The contact simply will not persist.
  }
}

function newId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Add one contact and return the new list. */
export function addContact(input: Omit<Contact, 'id'>): Contact[] {
  const name = input.name.trim();
  if (name.length === 0) return loadContacts();

  const contact: Contact = {
    id: newId(),
    name,
    ...(input.email !== undefined && input.email.length > 0 ? { email: input.email.trim() } : {}),
    ...(input.phone !== undefined && input.phone.length > 0 ? { phone: input.phone } : {}),
  };

  const next = [...loadContacts(), contact];
  saveContacts(next);
  return next;
}

export function removeContact(id: string): Contact[] {
  const next = loadContacts().filter((contact) => contact.id !== id);
  saveContacts(next);
  return next;
}
