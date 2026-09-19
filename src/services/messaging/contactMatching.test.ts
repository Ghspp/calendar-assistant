/**
 * Matching a spoken name to a contact.
 *
 * The regression this file exists for: contact matching originally reused the event
 * title matcher, which strips Hebrew filler words. Any contact named one of those —
 * 'אני', 'זה', 'תודה', 'יש', 'מה' — matched nothing and could never be messaged.
 */

import { describe, expect, it } from 'vitest';
import { channelsFor, findContactsByName, nameMatches } from './contactMatching';
import type { Contact } from '../../storage/contacts';

describe('a name is never filtered down to nothing', () => {
  it.each(['אני', 'זה', 'תודה', 'יש', 'מה', 'לי'])('matches %s against itself', (name) => {
    expect(nameMatches(name, name)).toBe(true);
  });

  it.each(['דניאל', 'אמא', 'אבא', 'רותי', 'שני'])('still matches ordinary names', (name) => {
    expect(nameMatches(name, name)).toBe(true);
  });
});

describe('Hebrew particles', () => {
  it('matches a name the user addressed with ל', () => {
    // The parser strips the ל before this point, but the stored name may itself carry
    // a particle, so both sides are stripped.
    expect(nameMatches('אמא', 'לאמא')).toBe(true);
  });

  it('matches through the definite article', () => {
    expect(nameMatches('המורה', 'מורה')).toBe(true);
  });
});

describe('not matching', () => {
  it('does not match a different name', () => {
    expect(nameMatches('דניאל', 'רותי')).toBe(false);
  });

  it('requires every word, so a full name is not matched by the wrong surname', () => {
    expect(nameMatches('דני כהן', 'דני לוי')).toBe(false);
    expect(nameMatches('דני כהן', 'דני')).toBe(true);
  });

  it('matches nothing on an empty query rather than everything', () => {
    expect(nameMatches('דניאל', '')).toBe(false);
    expect(nameMatches('דניאל', '   ')).toBe(false);
  });
});

describe('findContactsByName', () => {
  const contacts: Contact[] = [
    { id: '1', name: 'אמא', email: 'mum@example.com' },
    { id: '2', name: 'דני כהן', email: 'a@example.com' },
    { id: '3', name: 'דני לוי', phone: '972500000000' },
    { id: '4', name: 'אני', email: 'me@example.com' },
  ];

  it('finds the one', () => {
    expect(findContactsByName(contacts, 'אמא').map((c) => c.id)).toEqual(['1']);
  });

  it('finds a contact named after a filler word', () => {
    expect(findContactsByName(contacts, 'אני').map((c) => c.id)).toEqual(['4']);
  });

  it('returns both when the name is ambiguous, so the caller can ask', () => {
    expect(findContactsByName(contacts, 'דני').map((c) => c.id)).toEqual(['2', '3']);
  });

  it('returns nothing for an unknown name', () => {
    expect(findContactsByName(contacts, 'יוסי')).toEqual([]);
  });
});

describe('recovering a misheard name', () => {
  const book: Contact[] = [
    { id: '1', name: 'דניאל', email: 'd@example.com' },
    { id: '2', name: 'רותי', email: 'r@example.com' },
    { id: '3', name: 'אמא', email: 'm@example.com' },
  ];

  it('rejoins a name the recogniser split in two', () => {
    expect(findContactsByName(book, 'דני אל').map((c) => c.id)).toEqual(['1']);
  });

  it('forgives a trailing syllable', () => {
    expect(findContactsByName(book, 'דניאלה').map((c) => c.id)).toEqual(['1']);
  });

  it('still finds nothing for a genuinely different name', () => {
    // Two edits from רותי, and a different person. This is the case that fixes the
    // threshold: anything looser merges real contacts.
    expect(findContactsByName(book, 'יוסי')).toEqual([]);
  });

  it('prefers an exact match over a near one', () => {
    const withBoth: Contact[] = [...book, { id: '4', name: 'דניאלה', email: 'x@e.com' }];
    expect(findContactsByName(withBoth, 'דניאלה').map((c) => c.id)).toEqual(['4']);
  });

  it('returns every equally-near name, so the caller asks instead of picking', () => {
    const twins: Contact[] = [
      { id: 'a', name: 'רוני', email: 'a@e.com' },
      { id: 'b', name: 'רונן', email: 'b@e.com' },
    ];
    // 'רונה' is one edit from both. A near match is less certain than an exact one, so
    // it must not be resolved by choosing.
    expect(findContactsByName(twins, 'רונה').length).toBe(2);
  });
});

describe('channelsFor', () => {
  it('reports BOTH when the contact has both, so the caller can ask', () => {
    // Returning one here would bury a choice the user should be making.
    expect(
      channelsFor({ id: '1', name: 'א', email: 'a@example.com', phone: '972500000000' }),
    ).toEqual(['gmail', 'whatsapp']);
  });

  it('reports just mail', () => {
    expect(channelsFor({ id: '1', name: 'א', email: 'a@example.com' })).toEqual(['gmail']);
  });

  it('reports just WhatsApp', () => {
    expect(channelsFor({ id: '1', name: 'א', phone: '972500000000' })).toEqual(['whatsapp']);
  });

  it('reports nothing rather than pretending', () => {
    expect(channelsFor({ id: '1', name: 'א' })).toEqual([]);
  });

  it('ignores empty strings, which storage can hand back', () => {
    expect(channelsFor({ id: '1', name: 'א', email: '', phone: '' })).toEqual([]);
  });
});
