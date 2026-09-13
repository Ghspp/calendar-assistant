import { useMemo, useState } from 'react';
import './ParserDevPanel.css';
import { parseCommand } from '../services/parser';
import { fixedClock } from '../utils/clock';
import type { ParsedCommand } from '../types/parser';

/**
 * DEVELOPMENT ONLY — parser inspector.
 *
 * A scratch tool for eyeballing what the Stage 1 parser produces for a given Hebrew
 * command. It reads nothing and writes nothing: no calendar, no network, no speech.
 * The only thing it calls is the pure parseCommand().
 *
 * Delete this screen once the real assistant UI exists.
 */

const PRESETS: string[] = [
  'תקבע לי פגישה עם דניאל מחר בשש',
  'תקבע לי פגישה עם דניאל מחר בשש בערב לשעה',
  'שים לי פגישה ביום ראשון ב-10 בבוקר עד 11',
  'תקבע לי ארוחת ערב עם חברים ביום שישי בשמונה לשעתיים',
  'תקבע לי פגישה עם דניאל מחר',
  'שים לי חוג כדורגל מחר בחמש לשעה',
  'תקבע לי אימון מחר בשעה 17:00',
  'בטל את הפגישה עם דניאל מחר',
  'העבר את הפגישה עם דניאל למחר בשמונה',
  'מה יש לי מחר?',
  'אני פנוי מחר בשש?',
  'מצא לי שעה פנויה של שעתיים מחר',
];

/** Format a Date as the value a datetime-local input expects (local wall clock). */
function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

type ParseOutcome =
  | { ok: true; command: ParsedCommand }
  | { ok: false; message: string };

export default function ParserDevPanel() {
  const [text, setText] = useState<string>(PRESETS[0] ?? '');
  // Pinning a reference time makes 'מחר' reproducible while inspecting.
  const [referenceTime, setReferenceTime] = useState<string>(() =>
    toDateTimeLocalValue(new Date()),
  );

  const outcome = useMemo<ParseOutcome>(() => {
    try {
      const instant = new Date(referenceTime);
      if (Number.isNaN(instant.getTime())) {
        return { ok: false, message: 'זמן הייחוס אינו תקין' };
      }
      return { ok: true, command: parseCommand(text, fixedClock(instant)) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }, [text, referenceTime]);

  return (
    <section className="devpanel" aria-label="כלי פיתוח — בדיקת מנתח הפקודות">
      <p className="devpanel__banner">
        <span className="devpanel__banner-tag">DEV</span>
        <span>כלי פיתוח זמני — בדיקת מנתח הפקודות בלבד. אינו מחובר ליומן ואינו יוצר אירועים.</span>
      </p>

      <div className="devpanel__field">
        <label className="devpanel__label" htmlFor="devpanel-command">
          פקודה בעברית
        </label>
        <textarea
          id="devpanel-command"
          className="devpanel__input"
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="תקבע לי פגישה עם דניאל מחר בשש"
        />
      </div>

      <div className="devpanel__field">
        <span className="devpanel__label">דוגמאות</span>
        <div className="devpanel__presets">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="devpanel__preset"
              aria-pressed={text === preset}
              onClick={() => setText(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      <div className="devpanel__field">
        <label className="devpanel__label" htmlFor="devpanel-now">
          זמן ייחוס — מה הפרסר מחשיב כ״עכשיו״
        </label>
        <input
          id="devpanel-now"
          className="devpanel__input"
          type="datetime-local"
          value={referenceTime}
          onChange={(event) => setReferenceTime(event.target.value)}
        />
        <p className="devpanel__hint">
          נקרא כשעון מקומי ומוזרק לפרסר. שינוי הערך משנה תאריכים יחסיים כמו ״מחר״.
        </p>
      </div>

      {outcome.ok ? <Summary command={outcome.command} /> : null}

      <pre className="devpanel__json" dir="ltr">
        {outcome.ok
          ? JSON.stringify(outcome.command, null, 2)
          : `// parse error\n${outcome.message}`}
      </pre>
    </section>
  );
}

/** At-a-glance read of the two things that matter most: open questions and gaps. */
function Summary({ command }: { command: ParsedCommand }) {
  return (
    <div className="devpanel__summary">
      <span className="devpanel__chip devpanel__chip--none">{command.intent}</span>

      {command.ambiguities.length === 0 ? (
        <span className="devpanel__chip devpanel__chip--ok">ללא אי-בהירות</span>
      ) : (
        command.ambiguities.map((ambiguity) => (
          <span key={ambiguity.slot} className="devpanel__chip devpanel__chip--ask">
            {ambiguity.slot}: {ambiguity.question}{' '}
            <span className="ltr-numerals">{ambiguity.candidates.join(' / ')}</span>
          </span>
        ))
      )}

      {command.missing.length === 0 ? (
        <span className="devpanel__chip devpanel__chip--ok">אין מידע חסר</span>
      ) : (
        <span className="devpanel__chip devpanel__chip--error">
          חסר: {command.missing.join(', ')}
        </span>
      )}
    </div>
  );
}
