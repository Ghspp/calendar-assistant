// @vitest-environment jsdom

/**
 * The contact book.
 *
 * The load path gets the most attention: it is the one place a corrupted or
 * hand-edited localStorage value reaches the app, and it must degrade rather than
 * throw or silently wipe the list.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addContact,
  isPlausibleEmail,
  loadContacts,
  normalizePhone,
  removeContact,
  saveContacts,
} from './contacts';

const KEY = 'voice-calendar.contacts.v1';

beforeEach(() => {
  localStorage.clear();
});

describe('normalizePhone', () => {
  it.each([
    ['050-123-4567', '972501234567'],
    ['0501234567', '972501234567'],
    ['054 999 8888', '972549998888'],
    ['+972-50-123-4567', '972501234567'],
    ['+972501234567', '972501234567'],
    ['00972501234567', '972501234567'],
    ['972501234567', '972501234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('keeps a foreign number as given rather than forcing Israel onto it', () => {
    expect(normalizePhone('+1 555 123 4567')).toBe('15551234567');
  });

  it.each(['', '   ', 'abc', '12345'])('refuses %s rather than guessing', (input) => {
    expect(normalizePhone(input)).toBeUndefined();
  });
});

describe('isPlausibleEmail', () => {
  it.each(['a@b.co', 'mum@example.com', 'first.last@sub.example.co.il'])(
    'accepts %s',
    (value) => {
      expect(isPlausibleEmail(value)).toBe(true);
    },
  );

  it.each(['', 'nope', 'a@b', 'a b@c.com', '@example.com'])('rejects %s', (value) => {
    expect(isPlausibleEmail(value)).toBe(false);
  });
});

describe('reading and writing', () => {
  it('round-trips a contact', () => {
    addContact({ name: 'אמא', email: 'mum@example.com' });

    const contacts = loadContacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.name).toBe('אמא');
    expect(contacts[0]?.email).toBe('mum@example.com');
  });

  it('gives every contact an id of its own', () => {
    addContact({ name: 'אמא' });
    addContact({ name: 'אבא' });

    const ids = loadContacts().map((contact) => contact.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('removes only the one asked for', () => {
    addContact({ name: 'אמא' });
    addContact({ name: 'אבא' });

    const first = loadContacts()[0];
    expect(first).toBeDefined();

    const left = removeContact(first!.id);
    expect(left).toHaveLength(1);
    expect(left[0]?.name).toBe('אבא');
  });

  it('refuses a nameless contact rather than storing an unaddressable one', () => {
    addContact({ name: '   ' });
    expect(loadContacts()).toHaveLength(0);
  });

  it('omits empty optional fields instead of storing blanks', () => {
    addContact({ name: 'אמא', email: '', phone: '' });

    const contact = loadContacts()[0];
    expect(contact?.email).toBeUndefined();
    expect(contact?.phone).toBeUndefined();
  });
});

describe('surviving bad stored data', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadContacts()).toEqual([]);
  });

  it.each(['not json', '{}', 'null', '"a string"', '42'])(
    'returns an empty list for %s rather than throwing',
    (stored) => {
      localStorage.setItem(KEY, stored);
      expect(() => loadContacts()).not.toThrow();
      expect(loadContacts()).toEqual([]);
    },
  );

  it('drops only the bad row, keeping the good ones', () => {
    // One bad entry must not cost the user every contact they have entered.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'a', name: 'אמא', email: 'mum@example.com' },
        { id: 'b' },
        { name: 'no id' },
        null,
        'nonsense',
        { id: 'c', name: 'אבא' },
      ]),
    );

    const contacts = loadContacts();
    expect(contacts.map((contact) => contact.name)).toEqual(['אמא', 'אבא']);
  });

  it('does not take the app down when storage itself throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });

    expect(() => loadContacts()).not.toThrow();
    expect(loadContacts()).toEqual([]);

    getItem.mockRestore();
  });

  it('does not take the app down when a write fails', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => saveContacts([{ id: 'a', name: 'אמא' }])).not.toThrow();

    setItem.mockRestore();
  });
});
