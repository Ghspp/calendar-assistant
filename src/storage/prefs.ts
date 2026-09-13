/**
 * Local user preferences.
 *
 * Only non-sensitive UI preferences live here. Calendar contents are never written to
 * localStorage — they are fetched from Google on demand and kept in memory only.
 *
 * Every access is wrapped: localStorage throws in private mode and in some embedded
 * webviews, and must never take the app down.
 */

const PREFS_KEY = 'voice-calendar.prefs.v1';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface Prefs {
  theme: ThemePreference;
  /** Whether the assistant reads its answers aloud. */
  speakReplies: boolean;
}

export const defaultPrefs: Prefs = {
  theme: 'system',
  speakReplies: true,
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...defaultPrefs };

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...defaultPrefs };

    const record = parsed as Record<string, unknown>;
    const theme = record['theme'];
    const speakReplies = record['speakReplies'];

    return {
      theme: isThemePreference(theme) ? theme : defaultPrefs.theme,
      speakReplies:
        typeof speakReplies === 'boolean' ? speakReplies : defaultPrefs.speakReplies,
    };
  } catch {
    return { ...defaultPrefs };
  }
}

/** Update one preference, leaving the rest untouched. */
export function updatePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...patch };
  savePrefs(next);
  return next;
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable or full. The preference simply will not persist.
  }
}
