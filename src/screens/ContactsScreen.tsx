import { useState, type FormEvent } from 'react';
import './ContactsScreen.css';
import {
  addContact,
  isPlausibleEmail,
  loadContacts,
  normalizePhone,
  removeContact,
  type Contact,
} from '../storage/contacts';
import { pickDeviceContacts, supportsContactPicker } from '../services/messaging/devicePicker';

/**
 * The contact book.
 *
 * Two ways in, because neither covers everyone: the device picker is Android Chrome
 * only, and typing is the only option on a desktop. Both write to the same local list,
 * which never leaves this device.
 *
 * An email address is what lets the assistant actually send. A phone number only gets
 * as far as opening WhatsApp with the message ready, so the UI says so rather than
 * letting the user discover it mid-send.
 */

function channelLabel(contact: Contact): string {
  if (contact.email !== undefined && contact.phone !== undefined) return 'תישאל בכל פעם';
  if (contact.email !== undefined) return 'נשלח במייל';
  if (contact.phone !== undefined) return 'וואטסאפ — בלחיצה אחת';
  return 'אין לאן לשלוח';
}

export default function ContactsScreen() {
  const [contacts, setContacts] = useState<Contact[]>(() => loadContacts());
  const [notice, setNotice] = useState<string | undefined>();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;

    const trimmedEmail = email.trim();
    if (trimmedEmail.length > 0 && !isPlausibleEmail(trimmedEmail)) {
      setNotice('כתובת המייל לא נראית תקינה.');
      return;
    }

    const trimmedPhone = phone.trim();
    const normalized = trimmedPhone.length > 0 ? normalizePhone(trimmedPhone) : undefined;
    if (trimmedPhone.length > 0 && normalized === undefined) {
      setNotice('מספר הטלפון לא נראה תקין.');
      return;
    }

    if (trimmedEmail.length === 0 && normalized === undefined) {
      setNotice('צריך מייל או טלפון, אחרת אין לאן לשלוח.');
      return;
    }

    setContacts(
      addContact({
        name: trimmedName,
        ...(trimmedEmail.length > 0 ? { email: trimmedEmail } : {}),
        ...(normalized !== undefined ? { phone: normalized } : {}),
      }),
    );

    setName('');
    setEmail('');
    setPhone('');
    setNotice(`${trimmedName} נוסף.`);
  }

  async function pickFromDevice() {
    setNotice(undefined);
    try {
      const picked = await pickDeviceContacts();
      if (picked.length === 0) return;

      let next = contacts;
      for (const entry of picked) next = addContact(entry);

      setContacts(next);
      setNotice(`נוספו ${picked.length} אנשי קשר.`);
    } catch {
      setNotice('לא הצלחתי לפתוח את אנשי הקשר של המכשיר.');
    }
  }

  return (
    <section className="contacts">
      <p className="hint">
        מייל נשלח לבד. טלפון פותח את וואטסאפ עם ההודעה מוכנה ואתה לוחץ שלח. למי שיש
        שניהם — תישאל בכל פעם במה לשלוח. אנשי הקשר נשמרים רק במכשיר הזה.
      </p>

      {supportsContactPicker() ? (
        <button type="button" className="assistant__button" onClick={() => void pickFromDevice()}>
          בחר מאנשי הקשר של המכשיר
        </button>
      ) : null}

      <form className="contacts__form" onSubmit={submit}>
        <input
          className="assistant__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="שם — איך תקרא לו בדיבור"
          aria-label="שם איש הקשר"
        />
        <input
          className="assistant__input ltr-numerals"
          dir="ltr"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="email@example.com"
          aria-label="כתובת מייל"
        />
        <input
          className="assistant__input ltr-numerals"
          dir="ltr"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="050-123-4567"
          aria-label="מספר טלפון"
        />
        <button type="submit" className="assistant__button" disabled={name.trim().length === 0}>
          הוסף
        </button>
      </form>

      {notice !== undefined ? <p className="contacts__notice">{notice}</p> : null}

      {contacts.length === 0 ? (
        <p className="hint">עדיין אין אנשי קשר.</p>
      ) : (
        <ul className="contacts__list">
          {contacts.map((contact) => (
            <li key={contact.id} className="contacts__row">
              <div className="contacts__who">
                <strong>{contact.name}</strong>
                <span className="contacts__reach ltr-numerals">
                  {contact.email ?? contact.phone ?? '—'}
                </span>
                <span className="contacts__channel">{channelLabel(contact)}</span>
              </div>
              <button
                type="button"
                className="contacts__remove"
                aria-label={`הסר את ${contact.name}`}
                onClick={() => {
                  setContacts(removeContact(contact.id));
                  setNotice(`${contact.name} הוסר.`);
                }}
              >
                הסר
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
