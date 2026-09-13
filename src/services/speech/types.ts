/**
 * Speech recognition abstraction.
 *
 * The app talks to this interface, never to the Web Speech API directly. That keeps the
 * browser's quirks in one file and leaves room for an on-device Whisper provider later
 * without touching the UI.
 *
 * Honest note about what the browser provider actually does: Chrome streams the audio
 * to Google's servers for transcription. Calendar contents never leave the device
 * except to the Calendar API, and all parsing is local — but the raw voice clip is not
 * processed on-device.
 */

export type SpeechErrorKind =
  /** The browser has no Web Speech API at all (Firefox). */
  | 'unsupported'
  /** getUserMedia and the speech API both require HTTPS or localhost. */
  | 'insecure-context'
  /** The user refused the microphone, or the site is blocked from using it. */
  | 'permission-denied'
  /** Listening finished without hearing anything. */
  | 'no-speech'
  /** No microphone, or it is in use by something else. */
  | 'audio-capture'
  /** The recognition service could not be reached. */
  | 'network'
  /** Stopped deliberately. Not really a failure. */
  | 'aborted'
  | 'unknown';

export interface SpeechError {
  kind: SpeechErrorKind;
  /** Hebrew, ready to display. */
  message: string;
}

export interface SpeechResult {
  transcript: string;
  /**
   * False for a live partial guess, true for the settled text.
   * Only a final result should be acted on — interim text changes as you speak.
   */
  isFinal: boolean;
  confidence?: number;
}

export interface SpeechHandlers {
  onResult: (result: SpeechResult) => void;
  onError: (error: SpeechError) => void;
  /** Always called when the session finishes, whether it succeeded or not. */
  onEnd: () => void;
  onStart?: () => void;
}

export interface SpeechSession {
  /** Stop listening and keep whatever was heard. */
  stop: () => void;
  /** Stop listening and discard the result. */
  abort: () => void;
}

export interface SpeechStartOptions {
  /** BCP-47 tag. Defaults to he-IL. */
  lang?: string;
}

export interface SpeechProvider {
  /** False when this browser cannot do speech recognition at all. */
  readonly isSupported: boolean;
  /** Why it is unsupported, when it is. */
  readonly unsupportedReason?: SpeechError;
  /**
   * Begin listening. Must be called from a real user gesture — browsers refuse
   * otherwise, and some refuse silently.
   */
  start: (handlers: SpeechHandlers, options?: SpeechStartOptions) => SpeechSession;
}

export const HEBREW_LANG = 'he-IL';

/** Hebrew wording for each failure. Kept beside the taxonomy so none is forgotten. */
export const SPEECH_ERROR_MESSAGES: Record<SpeechErrorKind, string> = {
  unsupported: 'הדפדפן הזה לא תומך בזיהוי דיבור. אפשר להקליד את הפקודה במקום.',
  'insecure-context': 'זיהוי דיבור דורש חיבור מאובטח (HTTPS). אפשר להקליד את הפקודה במקום.',
  'permission-denied': 'אין גישה למיקרופון. יש לאשר את ההרשאה בהגדרות הדפדפן.',
  'no-speech': 'לא שמעתי כלום. נסה שוב.',
  'audio-capture': 'לא נמצא מיקרופון זמין.',
  network: 'שירות זיהוי הדיבור אינו זמין כרגע.',
  aborted: 'ההקלטה הופסקה.',
  unknown: 'אירעה שגיאה בזיהוי הדיבור.',
};

export function speechError(kind: SpeechErrorKind): SpeechError {
  return { kind, message: SPEECH_ERROR_MESSAGES[kind] };
}
