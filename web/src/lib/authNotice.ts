/**
 * A one-time message for the sign-in page (for example after a database
 * restore signed everyone out). Kept in sessionStorage so it survives the
 * sign-out redirect but not a new browser session.
 */
export type AuthNotice = { kind: 'restored'; message?: string; safety?: string };

const KEY = 'auth_notice';

export function setAuthNotice(n: AuthNotice) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(n));
  } catch {
    /* storage unavailable */
  }
}

export function readAuthNotice(): AuthNotice | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const n = raw ? JSON.parse(raw) : null;
    return n && n.kind === 'restored' ? n : null;
  } catch {
    return null;
  }
}

export function clearAuthNotice() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
