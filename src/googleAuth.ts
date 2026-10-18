import { DRIVE_ENABLED, DRIVE_SCOPE, GOOGLE_CLIENT_ID, googleRedirectUri, prefersRedirectSignIn } from './driveConfig';
import { parseOAuthHash } from './driveFormat';
import { isIos, isStandalone } from './platform';

const TOKEN_KEY = 'swingframe.google.token';
const STATE_KEY = 'swingframe.google.state';
const NOTICE_KEY = 'swingframe.google.notice';

interface StoredToken {
  accessToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  scope?: string;
}

interface TokenClient {
  requestAccessToken: (override?: { prompt?: string }) => void;
}

type GoogleOauth = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
    prompt?: string;
  }) => TokenClient;
  revoke?: (accessToken: string, done?: () => void) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOauth } };
  }
}

export class PopupBlockedError extends Error {
  constructor() {
    super('Google could not open a sign-in window.');
    this.name = 'PopupBlockedError';
  }
}

export class DriveAuthError extends Error {
  constructor() {
    super('Google Drive needs you to connect again.');
    this.name = 'DriveAuthError';
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private mode. The token still lives in memory for this page. */
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Ignore. */
  }
}

let memoryToken: StoredToken | null = null;

function remember(token: StoredToken): void {
  memoryToken = token;
  writeJson(TOKEN_KEY, token);
}

export function clearGoogleToken(): void {
  memoryToken = null;
  removeKey(TOKEN_KEY);
}

export function googleConnected(): boolean {
  return currentToken() != null;
}

function currentToken(): StoredToken | null {
  const token = memoryToken ?? readJson<StoredToken>(TOKEN_KEY);
  if (!token?.accessToken || token.expiresAt <= Date.now() + 60_000) return null;
  memoryToken = token;
  return token;
}

export function takeGoogleNotice(): string | null {
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY);
    if (notice) sessionStorage.removeItem(NOTICE_KEY);
    return notice;
  } catch {
    return null;
  }
}

function rememberNotice(message: string): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, message);
  } catch {
    /* The next screen may not see it. The hash is still removed. */
  }
}

function rememberState(state: string): void {
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    /* localStorage below is the spare copy. */
  }
  try {
    localStorage.setItem(STATE_KEY, state);
  } catch {
    /* The sign-in can still finish if sessionStorage kept it. */
  }
}

function readState(): string | null {
  try {
    return sessionStorage.getItem(STATE_KEY) || localStorage.getItem(STATE_KEY);
  } catch {
    return null;
  }
}

function clearState(): void {
  try {
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* Ignore. */
  }
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    /* Ignore. */
  }
}

/** If Google sent us back with a token in the hash, store it and remove the hash. */
export function captureGoogleRedirect(): void {
  if (typeof window === 'undefined') return;
  const parsed = parseOAuthHash(window.location.hash);
  if (!parsed?.state?.startsWith('sf1.')) return;
  const expected = readState();
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  clearState();
  if (!expected || parsed.state !== expected) {
    rememberNotice('Google sign-in did not match this phone. Tap Connect again.');
    return;
  }
  if (parsed.kind === 'error') {
    rememberNotice(parsed.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in did not finish.');
    return;
  }
  if (!DRIVE_ENABLED) return;
  remember({ accessToken: parsed.accessToken, expiresAt: Date.now() + parsed.expiresIn * 1000 });
}

export function assertOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You are offline. Google Drive needs a connection.');
  }
}

function loadGis(): Promise<GoogleOauth> {
  const ready = window.google?.accounts?.oauth2;
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      const oauth = window.google?.accounts?.oauth2;
      if (oauth) resolve(oauth);
      else reject(new Error('Google sign-in did not load.'));
    };
    script.onerror = () => reject(new Error('Could not reach Google. Check the connection and try again.'));
    document.head.appendChild(script);
  });
}

export function startGoogleRedirect(): void {
  const state = `sf1.${crypto.randomUUID()}`;
  rememberState(state);
  const redirect = googleRedirectUri(window.location.origin, import.meta.env.BASE_URL || '/');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', DRIVE_SCOPE);
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('state', state);
  window.location.assign(url.href);
}

function popupSignIn(prompt: '' | 'select_account'): Promise<void> {
  return loadGis().then(
    (oauth) =>
      new Promise<void>((resolve, reject) => {
        const client = oauth.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: DRIVE_SCOPE,
          prompt,
          callback: (response) => {
            if (response.error || !response.access_token) {
              reject(new Error(response.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google did not return a token.'));
              return;
            }
            const expiresIn = Number(response.expires_in ?? 3600);
            remember({
              accessToken: response.access_token,
              expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
            });
            resolve();
          },
          error_callback: (error) => {
            if (error.type === 'popup_failed_to_open') {
              reject(new PopupBlockedError());
              return;
            }
            reject(new Error(error.type === 'popup_closed' ? 'Google sign-in was closed.' : 'Google sign-in did not finish.'));
          },
        });
        client.requestAccessToken({ prompt });
      }),
  );
}

/** Popup via the Google Identity Services token client. iOS standalone, or a blocked popup, uses a redirect. */
export function connectGoogle(): Promise<void> {
  if (!DRIVE_ENABLED) return Promise.reject(new Error('Google Drive is not set up in this copy of Swingframe.'));
  assertOnline();
  if (prefersRedirectSignIn(isIos(), isStandalone())) {
    startGoogleRedirect();
    return new Promise(() => undefined);
  }
  const prompt = currentToken() ? '' : 'select_account';
  return popupSignIn(prompt).catch((err: unknown) => {
    if (err instanceof PopupBlockedError) {
      startGoogleRedirect();
      return new Promise(() => undefined);
    }
    throw err;
  });
}

export async function getAccessToken(): Promise<string> {
  if (!DRIVE_ENABLED) throw new Error('Google Drive is not set up in this copy of Swingframe.');
  assertOnline();
  const token = currentToken();
  if (token) return token.accessToken;
  await connectGoogle();
  const fresh = currentToken();
  if (!fresh) throw new Error('Google Drive needs you to connect again.');
  return fresh.accessToken;
}

export function disconnectGoogle(): void {
  const token = currentToken()?.accessToken;
  clearGoogleToken();
  if (!token || !window.google?.accounts?.oauth2?.revoke) return;
  try {
    window.google.accounts.oauth2.revoke(token);
  } catch {
    /* Forgetting the token locally is enough. */
  }
}
