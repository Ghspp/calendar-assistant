import { useMemo, useState } from 'react';
import './ParserDevPanel.css';
import { useGoogleCalendar } from '../hooks/useGoogleCalendar';
import { CALENDAR_EVENTS_SCOPE } from '../services/calendar/auth';
import { instantToZonedTime } from '../utils/time';
import { APP_TIME_ZONE, systemClock } from '../utils/clock';
import { addDaysToDateString } from '../utils/time';
import type { CalendarEvent } from '../types/calendar';

/**
 * DEVELOPMENT ONLY — Google Calendar connection inspector.
 *
 * READ-ONLY: this panel can connect an account and list events. It has no way to
 * create, edit or delete anything, and the OAuth scope it requests does not allow it.
 *
 * Delete this screen once the real calendar UI exists.
 */

function todayInIsrael(): string {
  return instantToZonedTime(systemClock.now(), APP_TIME_ZONE).date;
}

/** Render an event's times as Israel local wall clock, always left-to-right. */
function formatEventTime(event: CalendarEvent): string {
  if (event.kind === 'allDay') {
    return `${event.startDate} → ${event.endDateExclusive}`;
  }

  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';

  const startLocal = instantToZonedTime(start, APP_TIME_ZONE);
  const endLocal = instantToZonedTime(end, APP_TIME_ZONE);

  return startLocal.date === endLocal.date
    ? `${startLocal.date} ${startLocal.time}–${endLocal.time}`
    : `${startLocal.date} ${startLocal.time} → ${endLocal.date} ${endLocal.time}`;
}

/** Flags that change how conflict detection treats the event. */
function eventFlags(event: CalendarEvent): string[] {
  const flags: string[] = [];
  if (event.kind === 'allDay') flags.push('יום שלם — מידע בלבד');
  if (event.status === 'cancelled') flags.push('מבוטל — מתעלמים');
  if (event.transparency === 'transparent') flags.push('פנוי — מתעלמים');
  if (event.responseStatus === 'declined') flags.push('נדחה — מתעלמים');
  if (event.recurringEventId !== undefined) flags.push('מופע מסדרה');
  return flags;
}

export default function CalendarDebugPanel() {
  const calendar = useGoogleCalendar();
  const [date, setDate] = useState<string>(() => todayInIsrael());

  const weekEnd = useMemo(() => addDaysToDateString(date, 7) ?? date, [date]);

  return (
    <section className="devpanel" aria-label="כלי פיתוח — חיבור ליומן Google">
      <p className="devpanel__banner">
        <span className="devpanel__banner-tag">DEV</span>
        <span>
          כלי פיתוח זמני — קריאה מיומן Google. הפאנל הזה אינו יוצר אירועים — לשם כך יש את שורת הפקודה למעלה.
        </span>
      </p>

      <div className="devpanel__field">
        <span className="devpanel__label">מצב חיבור</span>
        <div className="devpanel__summary">
          {calendar.status === 'unconfigured' ? (
            <span className="devpanel__chip devpanel__chip--error">לא מוגדר</span>
          ) : null}
          {calendar.status === 'disconnected' ? (
            <span className="devpanel__chip devpanel__chip--ask">לא מחובר</span>
          ) : null}
          {calendar.status === 'connecting' ? (
            <span className="devpanel__chip devpanel__chip--none">מתחבר…</span>
          ) : null}
          {calendar.status === 'connected' ? (
            <span className="devpanel__chip devpanel__chip--ok">מחובר ל-Google</span>
          ) : null}
          <span className="devpanel__chip devpanel__chip--none">הרשאה: קריאה וכתיבה</span>
        </div>
      </div>

      {calendar.status === 'unconfigured' ? (
        <p className="stage-note">
          לא הוגדר <span className="ltr-numerals">VITE_GOOGLE_CLIENT_ID</span>. צור קובץ{' '}
          <span className="ltr-numerals">.env.local</span> לפי ההוראות ב-
          <span className="ltr-numerals">README.md</span> והפעל מחדש את שרת הפיתוח.
        </p>
      ) : null}

      <div className="devpanel__field">
        <div className="devpanel__presets">
          {calendar.status === 'connected' ? (
            <button type="button" className="devpanel__preset" onClick={calendar.disconnect}>
              נתק
            </button>
          ) : (
            <button
              type="button"
              className="devpanel__preset"
              disabled={calendar.status === 'unconfigured' || calendar.status === 'connecting'}
              onClick={() => {
                void calendar.connect();
              }}
            >
              התחבר ל-Google Calendar
            </button>
          )}
        </div>
      </div>

      <div className="devpanel__field">
        <label className="devpanel__label" htmlFor="calendar-debug-date">
          תאריך
        </label>
        <input
          id="calendar-debug-date"
          className="devpanel__input"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <div className="devpanel__presets" style={{ marginBlockStart: 'var(--space-2)' }}>
          <button
            type="button"
            className="devpanel__preset"
            disabled={calendar.status !== 'connected' || calendar.loading}
            onClick={() => {
              void calendar.loadDate(date);
            }}
          >
            טען את אירועי היום הזה
          </button>
          <button
            type="button"
            className="devpanel__preset"
            disabled={calendar.status !== 'connected' || calendar.loading}
            onClick={() => {
              const from = new Date(`${date}T00:00:00Z`);
              const to = new Date(`${weekEnd}T00:00:00Z`);
              void calendar.loadRange(from, to);
            }}
          >
            טען שבוע קדימה
          </button>
        </div>
      </div>

      {calendar.loading ? (
        <p className="devpanel__hint">טוען אירועים…</p>
      ) : null}

      {calendar.error !== undefined ? (
        <div className="devpanel__summary">
          <span className="devpanel__chip devpanel__chip--error">
            {calendar.error}
            {calendar.errorKind !== undefined ? ` (${calendar.errorKind})` : ''}
          </span>
        </div>
      ) : null}

      {!calendar.loading && calendar.events.length === 0 ? (
        <p className="devpanel__hint">אין אירועים להצגה.</p>
      ) : null}

      {calendar.events.length > 0 ? (
        <ul className="checklist" style={{ marginBlockStart: 'var(--space-4)' }}>
          {calendar.events.map((event) => (
            <li key={event.id}>
              <span className="mark">•</span>
              <span>
                <strong>{event.title}</strong>{' '}
                <span className="ltr-numerals">{formatEventTime(event)}</span>
                {eventFlags(event).length > 0 ? (
                  <em style={{ color: 'var(--color-text-muted)' }}>
                    {' '}
                    — {eventFlags(event).join(', ')}
                  </em>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="devpanel__hint" style={{ marginBlockStart: 'var(--space-4)' }} dir="ltr">
        scope: {CALENDAR_EVENTS_SCOPE}
      </p>
    </section>
  );
}
