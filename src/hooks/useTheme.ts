import { useCallback, useEffect, useState } from 'react';
import { loadPrefs, updatePrefs, type ThemePreference } from '../storage/prefs';

/**
 * Theme preference, persisted locally.
 *
 * 'system' removes the data-theme attribute entirely so the CSS falls through to
 * prefers-color-scheme; 'light'/'dark' stamp it and win over the media query.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemePreference>(() => loadPrefs().theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    updatePrefs({ theme: next });
  }, []);

  return { theme, setTheme };
}
