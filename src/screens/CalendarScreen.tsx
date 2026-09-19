import { useMemo, useState } from 'react';
import './CalendarScreen.css';
import { useCalendarEvents, type CalendarRange } from '../hooks/useCalendarEvents';
import { hourMarks, layoutDay } from '../services/calendar/dayLayout';
import { respond } from '../services/assistant/responder';
import { describeDate } from '../services/assistant/responder';
import { APP_TIME_ZONE, systemClock } from '../utils/clock';
import { addDaysToDateString, instantToZonedTime, minutesToTimeString } from '../utils/time';
import type { CalendarEvent, TimedCalendarEvent } from '../types/calendar';

/**
 * The visual calendar.
 *
 * Exists so the app is usable without speaking. Every write it performs goes through
 * the same command pipeline as a spoken one, so the conflict rules hold identically.
 *
 * The week view is an agenda grouped by day rather than seven columns: a seven-column
 * grid is unreadable at phone width, and this app is phone-first.
 */

const HOUR_HEIGHT = 56;
const WINDOW = { start: '06:00', end: '23:00' };

function todayInIsrael(): string {
  return instantToZonedTime(systemClock.now(), APP_TIME_ZONE).date;
}

interface Draft {
  date: string;
  startTime: string;
}

export default function CalendarScreen() {
  const [range, setRange] = useState<CalendarRange>('day');
  const [anchor, setAnchor] = useState<string>(() => todayInIsrael());
  const [selected, setSelected] = useState<TimedCalendarEvent | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const calendar = useCalendarEvents(anchor, range);

  const days = useMemo(() => {
    if (range === 'day') return [anchor];
    return Array.from({ length: 7 }, (_, offset) => addDaysToDateString(anchor, offset) ?? anchor);
  }, [anchor, range]);

  const shift = (days: number) => setAnchor((current) => addDaysToDateString(current, days) ?? current);

  if (calendar.authState !== 'signed-in') {
    return (
      <section className="calendar">
        <div className="assistant__connect">
          <p className="assistant__connect-text">כדי לראות את היומן צריך להתחבר.</p>
          <button
            type="button"
            className="assistant__button"
            onClick={() => {
              void calendar.connect();
            }}
          >
            התחבר ל-Google Calendar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="calendar" aria-label="תצוגת יומן">
      <header className="calendar__bar">
        <div className="calendar__nav">
          {/* In RTL the "previous" control sits on the right, so the glyphs are
              swapped relative to an LTR layout. */}
          <button type="button" onClick={() => shift(range === 'week' ? -7 : -1)} aria-label="אחורה">
            ›
          </button>
          <button type="button" onClick={() => setAnchor(todayInIsrael())}>
            היום
          </button>
          <button type="button" onClick={() => shift(range === 'week' ? 7 : 1)} aria-label="קדימה">
            ‹
          </button>
        </div>

        <div className="theme-toggle" role="group" aria-label="טווח">
          <button type="button" aria-pressed={range === 'day'} onClick={() => setRange('day')}>
            יום
          </button>
          <button type="button" aria-pressed={range === 'week'} onClick={() => setRange('week')}>
            שבוע
          </button>
        </div>
      </header>

      <h2 className="calendar__title">
        {range === 'day'
          ? describeDate(anchor, systemClock)
          : `${describeDate(anchor, systemClock)} — ${describeDate(days[6] ?? anchor, systemClock)}`}
      </h2>

      {calendar.error !== undefined ? (
        <p className="assistant__offline">{calendar.error}</p>
      ) : null}
      {calendar.loading ? <p className="hint">טוען…</p> : null}
      {notice !== undefined ? <p className="assistant__offline">{notice}</p> : null}

      {range === 'day' ? (
        <DayGrid
          date={anchor}
          events={calendar.events}
          onSelect={setSelected}
          onEmptyTap={(startTime) => setDraft({ date: anchor, startTime })}
        />
      ) : (
        <WeekAgenda days={days} events={calendar.events} onSelect={setSelected} />
      )}

      {selected !== undefined ? (
        <EventSheet
          event={selected}
          onClose={() => setSelected(undefined)}
          onDelete={async () => {
            const outcome = await calendar.deleteEvent(selected);
            setSelected(undefined);
            setNotice(respond(outcome, systemClock));
          }}
        />
      ) : null}

      {draft !== undefined ? (
        <EventForm
          draft={draft}
          onClose={() => setDraft(undefined)}
          onCreate={async (title, durationMinutes) => {
            const outcome = await calendar.createEvent({
              title,
              date: draft.date,
              startTime: draft.startTime,
              durationMinutes,
            });
            setDraft(undefined);
            setNotice(respond(outcome, systemClock));
          }}
        />
      ) : null}
    </section>
  );
}

function DayGrid({
  date,
  events,
  onSelect,
  onEmptyTap,
}: {
  date: string;
  events: readonly CalendarEvent[];
  onSelect: (event: TimedCalendarEvent) => void;
  onEmptyTap: (startTime: string) => void;
}) {
  const { positioned, allDay } = layoutDay(events, date, APP_TIME_ZONE, WINDOW);
  const hours = hourMarks(WINDOW);
  const firstHour = hours[0] ?? 6;

  return (
    <>
      {allDay.length > 0 ? (
        <div className="calendar__allday">
          {allDay.map((event) => (
            <span key={event.id}>{event.title}</span>
          ))}
        </div>
      ) : null}

      <div className="calendar__grid" style={{ height: `${(hours.length - 1) * HOUR_HEIGHT}px` }}>
        {hours.slice(0, -1).map((hour) => (
          <button
            key={hour}
            type="button"
            className="calendar__hour"
            style={{ top: `${(hour - firstHour) * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
            onClick={() => onEmptyTap(minutesToTimeString(hour * 60))}
            aria-label={`קבע אירוע ב-${minutesToTimeString(hour * 60)}`}
          >
            <span className="calendar__hour-label ltr-numerals">
              {minutesToTimeString(hour * 60)}
            </span>
          </button>
        ))}

        {positioned.map((item) => {
          const top = ((item.startMinutes - firstHour * 60) / 60) * HOUR_HEIGHT;
          const height = Math.max(22, ((item.endMinutes - item.startMinutes) / 60) * HOUR_HEIGHT);
          const width = 100 / item.columns;

          return (
            <button
              key={item.event.id}
              type="button"
              className="calendar__event"
              style={{
                top: `${top}px`,
                height: `${height - 2}px`,
                insetInlineStart: `calc(${item.column * width}% + 52px)`,
                width: `calc(${width}% - 56px)`,
              }}
              onClick={() => onSelect(item.event)}
            >
              <strong>{item.event.title}</strong>
              <span className="ltr-numerals">
                {item.startTime}–{item.endTime}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function WeekAgenda({
  days,
  events,
  onSelect,
}: {
  days: readonly string[];
  events: readonly CalendarEvent[];
  onSelect: (event: TimedCalendarEvent) => void;
}) {
  return (
    <div className="calendar__week">
      {days.map((day) => {
        const { positioned, allDay } = layoutDay(events, day, APP_TIME_ZONE, {
          start: '00:00',
          end: '23:59',
        });

        return (
          <div key={day} className="calendar__day">
            <h3>{describeDate(day, systemClock)}</h3>

            {allDay.map((event) => (
              <p key={event.id} className="calendar__allday-line">
                {event.title} (יום שלם)
              </p>
            ))}

            {positioned.length === 0 && allDay.length === 0 ? (
              <p className="hint">אין אירועים</p>
            ) : null}

            {positioned.map((item) => (
              <button
                key={item.event.id}
                type="button"
                className="calendar__row"
                onClick={() => onSelect(item.event)}
              >
                <span className="ltr-numerals">
                  {item.startTime}–{item.endTime}
                </span>
                <span>{item.event.title}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function EventSheet({
  event,
  onClose,
  onDelete,
}: {
  event: TimedCalendarEvent;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = instantToZonedTime(new Date(event.start), APP_TIME_ZONE);
  const end = instantToZonedTime(new Date(event.end), APP_TIME_ZONE);

  return (
    <div className="sheet" role="dialog" aria-label={event.title}>
      <div className="sheet__panel">
        <h3>{event.title}</h3>
        <p className="ltr-numerals">
          {start.date} {start.time}–{end.time}
        </p>
        {event.recurringEventId !== undefined ? (
          <p className="hint">מופע מתוך סדרה</p>
        ) : null}

        {confirming ? (
          <>
            {/* Deleting is the one irreversible action, so it asks here too — the
                visual route gets no weaker a guard than the spoken one. */}
            <p className="assistant__offline">למחוק את האירוע? לא ניתן לבטל.</p>
            <div className="sheet__actions">
              <button
                type="button"
                className="assistant__button sheet__danger"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void onDelete();
                }}
              >
                {busy ? 'מוחק…' : 'כן, מחק'}
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                ביטול
              </button>
            </div>
          </>
        ) : (
          <div className="sheet__actions">
            <button type="button" className="assistant__button sheet__danger" onClick={() => setConfirming(true)}>
              מחק
            </button>
            <button type="button" onClick={onClose}>
              סגור
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const DURATIONS = [
  { minutes: 30, label: 'חצי שעה' },
  { minutes: 60, label: 'שעה' },
  { minutes: 90, label: 'שעה וחצי' },
  { minutes: 120, label: 'שעתיים' },
];

function EventForm({
  draft,
  onClose,
  onCreate,
}: {
  draft: Draft;
  onClose: () => void;
  onCreate: (title: string, durationMinutes: number) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false);

  return (
    <div className="sheet" role="dialog" aria-label="אירוע חדש">
      <form
        className="sheet__panel"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          if (title.trim().length === 0) return;
          setBusy(true);
          void onCreate(title.trim(), duration);
        }}
      >
        <h3>
          אירוע חדש ב<span className="ltr-numerals">{draft.startTime}</span>
        </h3>

        <input
          className="assistant__input"
          value={title}
          onChange={(changeEvent) => setTitle(changeEvent.target.value)}
          placeholder="מה לקבוע?"
          aria-label="שם האירוע"
          autoFocus
        />

        <div className="assistant__examples">
          {DURATIONS.map((option) => (
            <button
              key={option.minutes}
              type="button"
              className="chip"
              aria-pressed={duration === option.minutes}
              onClick={() => setDuration(option.minutes)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="sheet__actions">
          <button
            type="submit"
            className="assistant__button"
            disabled={busy || title.trim().length === 0}
          >
            {busy ? 'קובע…' : 'קבע'}
          </button>
          <button type="button" onClick={onClose}>
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}
