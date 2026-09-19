import { useState } from 'react';
import './App.css';
import { useTheme } from './hooks/useTheme';
import AssistantPanel from './screens/AssistantPanel';
import CalendarScreen from './screens/CalendarScreen';
import type { ThemePreference } from './storage/prefs';

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'בהיר' },
  { value: 'dark', label: 'כהה' },
  { value: 'system', label: 'מערכת' },
];

/**
 * The app shell: a theme switch, and two tabs over the assistant and the calendar.
 */
export default function App() {
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<'assistant' | 'calendar'>('assistant');

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
    </main>
  );
}
