/**
 * The device contact picker.
 *
 * Chrome on Android only, and it hands back ONLY the entries the user selected — the
 * app never sees the address book. Everywhere else the API simply does not exist, so
 * every call site feature-detects and falls back to typing.
 *
 * The typings live here because this is the only file that touches the API, matching
 * how auth.ts keeps the Google Identity Services typings to itself.
 */

import { normalizePhone } from '../../storage/contacts';

interface DeviceContact {
  name?: string[];
  email?: string[];
  tel?: string[];
}

interface ContactsManager {
  select(
    properties: string[],
    options?: { multiple?: boolean },
  ): Promise<DeviceContact[]>;
}

function contactsManager(): ContactsManager | undefined {
  const candidate = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return candidate;
}

export function supportsContactPicker(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'contacts' in navigator &&
    'ContactsManager' in globalThis
  );
}

export interface PickedContact {
  name: string;
  email?: string;
  phone?: string;
}

/**
 * Open the picker and return what the user chose, in this app's shape.
 *
 * Entries with no way to reach them are dropped: storing a name alone would produce a
 * contact the assistant can find but can never send to.
 *
 * Must be called from inside a user gesture, or the browser rejects it.
 */
export async function pickDeviceContacts(): Promise<PickedContact[]> {
  const manager = contactsManager();
  if (manager === undefined) return [];

  const selected = await manager.select(['name', 'email', 'tel'], { multiple: true });

  const picked: PickedContact[] = [];
  for (const entry of selected) {
    const name = entry.name?.[0]?.trim();
    if (name === undefined || name.length === 0) continue;

    const email = entry.email?.[0]?.trim();
    const rawPhone = entry.tel?.[0];
    const phone = rawPhone === undefined ? undefined : normalizePhone(rawPhone);

    if ((email === undefined || email.length === 0) && phone === undefined) continue;

    picked.push({
      name,
      ...(email !== undefined && email.length > 0 ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
    });
  }

  return picked;
}
