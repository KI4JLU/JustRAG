/* What an expired session does for a single-sign-on user.
 *
 * The app's own token ends long before the identity provider's session. So
 * an expired token is no reason to log out there: the app starts the SSO
 * login again, the provider answers without asking while its session lives
 * (and with its login page when it does not), and the user is back on the
 * page they were on. The logout endpoint is for the logout button only.
 *
 * One attempt per REAUTH_COOLDOWN_MS: a login whose fresh token is refused at
 * once would otherwise send the tab round and round. Within the window the
 * app shows its login page instead.
 */

import { API_BASE_URL } from '../api';
import { sessionStore } from '../utils/sessionStore';
import { parkPostLoginPath } from './postLoginPath';

export const SSO_REAUTH_AT_KEY = 'ssoReauthAt';
export const REAUTH_COOLDOWN_MS = 60_000;

/** Records an SSO re-login and parks `path` (pathname + search) for the
 * return. False when one started less than REAUTH_COOLDOWN_MS ago, or when
 * the tab cannot remember it in sessionStorage — the caller then shows
 * the login page and starts nothing. */
export function startSsoReauth(path: string, now: number = Date.now()): boolean {
  const s = sessionStore();
  if (!s) return false;
  try {
    const last = Number(s.getItem(SSO_REAUTH_AT_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < REAUTH_COOLDOWN_MS) return false;
    s.setItem(SSO_REAUTH_AT_KEY, String(now));
    parkPostLoginPath(path);
  } catch {
    // Storage is full or refuses access: no guard, so no re-login.
    return false;
  }
  return true;
}

/** Leaves the app for the SSO login. Its own function so a test can watch it. */
export function goToSsoLogin(): void {
  window.location.href = `${API_BASE_URL}/api/auth/oidc/login`;
}

/** Starts the app over from what is stored. Its own function so a test can watch it. */
export function reloadPage(): void {
  window.location.reload();
}
