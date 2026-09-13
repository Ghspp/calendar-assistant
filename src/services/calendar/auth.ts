/**
 * Google OAuth via Google Identity Services (GIS).
 *
 * ALL token handling lives in this module. Nothing else in the codebase touches an
 * access token, a client id, or the GIS SDK — the calendar provider asks this module
 * for a token and is otherwise unaware of how authentication works.
 *
 * Architecture notes:
 *   - Pure client-side implicit flow. There is no backend and no client secret.
 *   - The token is held IN MEMORY only, never in localStorage. An access token is a
 *     bearer credential; persisting it to storage would expose it to any XSS on the
 *     origin. The cost is that a page reload needs a fresh token, which we try to get
 *     silently before falling back to asking the user.
 *   - Access tokens last about an hour and the implicit flow issues no refresh token.
 *     Silent renewal usually works while the Google session is alive, but third-party
 *     cookie restrictions mean it can fail, in which case the UI shows the connect
 *     state again. This is the accepted trade for having no server.
 *
 * This module performs I/O, so unlike the parser it legitimately reads the wall clock.
 */

/**
 * Read AND write events on the user's calendars.
 *
 * This is the narrowest scope that permits creating an event — Google offers no
 * finer-grained "create only" variant. It still cannot touch calendar settings,
 * sharing, or any other calendar the user has not granted.
 *
 * Widening this from the Stage 3 read-only scope means an existing grant no longer
 * covers what the app asks for, so Google will show the consent screen again on the
 * next connect. That is expected, not a bug.
 */
export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

/** Renew slightly early so a request cannot die mid-flight. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export type AuthState =
  | 'unconfigured'
  | 'signed-out'
  | 'signed-in';

export interface AuthFailure {
  kind: 'unconfigured' | 'script-blocked' | 'consent-required' | 'denied' | 'unknown';
  /** Hebrew, ready to display. */
  message: string;
  detail?: string;
}

export class GoogleAuthError extends Error {
  readonly kind: AuthFailure['kind'];
  readonly hebrewMessage: string;

  constructor(failure: AuthFailure) {
    super(failure.detail ?? failure.message);
    this.name = 'GoogleAuthError';
    this.kind = failure.kind;
    this.hebrewMessage = failure.message;
  }
}

/* ------------------------------------------------------------------ *
 * Minimal GIS typings. Declared here rather than pulling in a types
 * package, since this is the only file that touches the SDK.
 * ------------------------------------------------------------------ */

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GisErrorResponse {
  type?: string;
  message?: string;
}

interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GisTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GisTokenResponse) => void;
  error_callback?: (error: GisErrorResponse) => void;
}

interface GisNamespace {
  accounts: {
    oauth2: {
      initTokenClient(config: GisTokenClientConfig): GisTokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

declare global {
  // eslint-disable-next-line no-var
  var google: GisNamespace | undefined;
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/**
 * The OAuth client id, from VITE_GOOGLE_CLIENT_ID.
 *
 * Not a secret — it ships in the browser bundle and is visible to anyone. It is kept
 * in an env file only because it is specific to each developer's Google Cloud project.
 */
export function getClientId(): string | undefined {
  const value = import.meta.env['VITE_GOOGLE_CLIENT_ID'];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isConfigured(): boolean {
  return getClientId() !== undefined;
}

/* ------------------------------------------------------------------ *
 * SDK loading
 * ------------------------------------------------------------------ */

let scriptPromise: Promise<void> | undefined;

function loadGisScript(): Promise<void> {
  if (globalThis.google !== undefined) return Promise.resolve();
  if (scriptPromise !== undefined) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_SRC}"]`,
    );

    const handleLoad = () => resolve();
    const handleError = () =>
      reject(
        new GoogleAuthError({
          kind: 'script-blocked',
          message: 'לא ניתן לטעון את שירות ההתחברות של Google. בדוק את חיבור האינטרנט או חוסם פרסומות.',
        }),
      );

    if (existing !== null) {
      existing.addEventListener('load', handleLoad, { once: true });
      existing.addEventListener('error', handleError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  // A failed load must not be cached, or a retry can never succeed.
  scriptPromise.catch(() => {
    scriptPromise = undefined;
  });

  return scriptPromise;
}

/* ------------------------------------------------------------------ *
 * Token state — in memory only
 * ------------------------------------------------------------------ */

interface StoredToken {
  accessToken: string;
  expiresAtMs: number;
}

let storedToken: StoredToken | undefined;
let tokenClient: GisTokenClient | undefined;
let inFlight: Promise<string> | undefined;

/** Listeners for auth-state changes, so the UI can react without polling. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToAuthState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAuthState(): AuthState {
  if (!isConfigured()) return 'unconfigured';
  return getCachedAccessToken() !== undefined ? 'signed-in' : 'signed-out';
}

/** The current token, if one is held and not near expiry. */
export function getCachedAccessToken(): string | undefined {
  if (storedToken === undefined) return undefined;
  if (Date.now() >= storedToken.expiresAtMs) {
    storedToken = undefined;
    return undefined;
  }
  return storedToken.accessToken;
}

/** Forget the token. The Google session itself is untouched. */
export function signOut(): void {
  storedToken = undefined;
  notify();
}

/**
 * Forget the token AND revoke the grant, so the next connect shows full consent.
 * Useful when changing scopes during development.
 */
export function revokeAccess(): void {
  const token = storedToken?.accessToken;
  storedToken = undefined;
  notify();
  if (token !== undefined && globalThis.google !== undefined) {
    globalThis.google.accounts.oauth2.revoke(token);
  }
}

async function getTokenClient(clientId: string): Promise<GisTokenClient> {
  await loadGisScript();

  const gis = globalThis.google;
  if (gis === undefined) {
    throw new GoogleAuthError({
      kind: 'script-blocked',
      message: 'שירות ההתחברות של Google לא נטען.',
    });
  }

  if (tokenClient === undefined) {
    tokenClient = gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: CALENDAR_EVENTS_SCOPE,
      // Replaced per request below; GIS requires a callback at construction time.
      callback: () => undefined,
    });
  }

  return tokenClient;
}

export interface RequestTokenOptions {
  /**
   * Whether the user may be shown an account chooser or consent screen.
   *
   * Must be true only in response to a real user gesture — browsers block the popup
   * otherwise. false attempts a silent renewal and fails fast if consent is needed.
   */
  interactive: boolean;
}

/**
 * Obtain a usable access token, reusing the cached one when possible.
 *
 * Concurrent callers share one in-flight request rather than opening several popups.
 */
export async function requestAccessToken(options: RequestTokenOptions): Promise<string> {
  const cached = getCachedAccessToken();
  if (cached !== undefined) return cached;

  if (inFlight !== undefined) return inFlight;

  const clientId = getClientId();
  if (clientId === undefined) {
    throw new GoogleAuthError({
      kind: 'unconfigured',
      message: 'לא הוגדר מזהה לקוח של Google. ראה את הוראות ההתקנה ב-README.',
    });
  }

  inFlight = (async () => {
    const client = await getTokenClient(clientId);

    return new Promise<string>((resolve, reject) => {
      // GIS hands results to a callback, so bridge it onto this promise. The client is
      // reused across calls, so the handlers are reassigned per request.
      const mutableClient = client as GisTokenClient & GisTokenClientConfig;

      mutableClient.callback = (response: GisTokenResponse) => {
        if (response.error !== undefined || response.access_token === undefined) {
          reject(
            new GoogleAuthError({
              kind: response.error === 'access_denied' ? 'denied' : 'consent-required',
              message:
                response.error === 'access_denied'
                  ? 'ההרשאה נדחתה. כדי להציג את היומן יש לאשר גישה.'
                  : 'נדרשת התחברות מחדש ל-Google.',
              ...(response.error_description !== undefined
                ? { detail: response.error_description }
                : {}),
            }),
          );
          return;
        }

        const expiresInSeconds = response.expires_in ?? 3600;
        storedToken = {
          accessToken: response.access_token,
          expiresAtMs: Date.now() + expiresInSeconds * 1000 - EXPIRY_SAFETY_MARGIN_MS,
        };
        notify();
        resolve(response.access_token);
      };

      mutableClient.error_callback = (error: GisErrorResponse) => {
        reject(
          new GoogleAuthError({
            kind: 'unknown',
            message: 'ההתחברות ל-Google לא הושלמה.',
            ...(error.message !== undefined ? { detail: error.message } : {}),
          }),
        );
      };

      // prompt:'' asks for a silent grant and fails rather than showing any UI.
      client.requestAccessToken(options.interactive ? {} : { prompt: '' });
    });
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = undefined;
  }
}

/** Test seam: reset all module state between tests. */
export function resetAuthForTests(): void {
  storedToken = undefined;
  tokenClient = undefined;
  inFlight = undefined;
  scriptPromise = undefined;
  listeners.clear();
}
