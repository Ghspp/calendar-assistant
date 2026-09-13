import { useState } from 'react';
import './App.css';
import { useTheme } from './hooks/useTheme';
import AssistantPanel from './screens/AssistantPanel';
import CalendarScreen from './screens/CalendarScreen';
import ParserDevPanel from './screens/ParserDevPanel';
import CalendarDebugPanel from './screens/CalendarDebugPanel';
import type { ThemePreference } from './storage/prefs';

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'בהיר' },
  { value: 'dark', label: 'כהה' },
  { value: 'system', label: 'מערכת' },
];

/**
 * Stage 0 scaffold screen.
 *
 * This is deliberately not the real home screen — it exists to verify that RTL layout,
 * the Hebrew font, the light/dark tokens and the build pipeline all work. It is replaced
 * by HomeScreen in Stage 5.
 *
 * It also hosts the temporary parser inspector (ParserDevPanel), which goes away once
 * the real assistant UI lands.
 */
export default function App() {
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<'assistant' | 'calendar'>('assistant');
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [showCalendarPanel, setShowCalendarPanel] = useState(false);

  return (
    <main className="app-shell">
      <header className="header">
        <h1>היומן שלי</h1>
        <div className="theme-toggle" role="group" aria-label="ערכת נושא">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={theme === option.value}
              onClick={() => setTheme(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <nav className="tabs" role="group" aria-label="מסכים">
        <button type="button" aria-pressed={tab === 'assistant'} onClick={() => setTab('assistant')}>
          🎙️ עוזר
        </button>
        <button type="button" aria-pressed={tab === 'calendar'} onClick={() => setTab('calendar')}>
          📅 יומן
        </button>
      </nav>

      {/* Both screens stay mounted so switching tabs does not discard a half-finished
          conversation or reload the calendar on every glance. */}
      <div hidden={tab !== 'assistant'}>
        <AssistantPanel />
      </div>
      <div hidden={tab !== 'calendar'}>
        <CalendarScreen />
      </div>

      <section className="panel">
        <h2>מצב הפרויקט</h2>
        <ul className="checklist">
          <li>
            <span className="mark">✓</span>
            <span>שלב 0 — תשתית, RTL, עברית, מצב בהיר/כהה, שעון להזרקה</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 1 — מנתח הפקודות בעברית</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 2 — בדיקת חפיפות ואימות</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 3 — חיבור ליומן Google</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 4 — קביעת אירועים מטקסט, כולל תזכורת</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 5 — זיהוי דיבור ותשובה קולית</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 6 — שיחה והשלמת פרטים חסרים</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 7 — שאלות על היומן וחיפוש שעה פנויה</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 8 — שינוי וביטול אירועים</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 9 — תצוגת יומן ויזואלית</span>
          </li>
          <li>
            <span className="mark">✓</span>
            <span>שלב 10 — התקנה למסך הבית, מצב לא מקוון, פריסה</span>
          </li>
        </ul>
        <p className="stage-note">
          מספרים ושעות מוצגים תמיד משמאל לימין:{' '}
          <span className="ltr-numerals">17:00–18:00</span>
        </p>
      </section>

      <button
        type="button"
        className="devpanel-toggle"
        aria-expanded={showDevPanel}
        onClick={() => setShowDevPanel((visible) => !visible)}
      >
        {showDevPanel ? 'הסתר כלי פיתוח' : 'הצג כלי פיתוח — בדיקת מנתח הפקודות'}
      </button>

      {showDevPanel ? <ParserDevPanel /> : null}

      <button
        type="button"
        className="devpanel-toggle"
        aria-expanded={showCalendarPanel}
        onClick={() => setShowCalendarPanel((visible) => !visible)}
      >
        {showCalendarPanel ? 'הסתר חיבור ליומן' : 'הצג כלי פיתוח — חיבור ליומן Google'}
      </button>

      {showCalendarPanel ? <CalendarDebugPanel /> : null}
    </main>
  );
}
