/* Where a single sign-on login returns to.
 *
 * A password login happens on the page the user is on, so the URL survives it
 * by itself. SSO does not: it is a top-level navigation to the identity
 * provider, and the callback always lands on "/". So the SSO button parks the
 * current path here first and the login screen restores it after the
 * callback. sessionStorage, as for the invite-link token (useJoinLink.ts):
 * it survives the round trip within the tab and nothing longer.
 */

import { sessionStore } from '../utils/sessionStore';

export const POST_LOGIN_PATH_KEY = 'postLoginPath';

/** Only an in-app path: one leading slash (no `//host`), no backslash or
 * control character (browsers read `/\host` as `//host`), not an API route. */
export function isAppPath(path: string): boolean {
  // eslint-disable-next-line no-control-regex
  return path.startsWith('/') && !path.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(path)
    && path !== '/api' && !path.startsWith('/api/');
}

/** Parks `path` (pathname + search) for the login that follows. "/" needs no parking. */
export function parkPostLoginPath(path: string): void {
  const s = sessionStore();
  if (!s) return;
  if (path === '/' || !isAppPath(path)) {
    s.removeItem(POST_LOGIN_PATH_KEY);
    return;
  }
  s.setItem(POST_LOGIN_PATH_KEY, path);
}

/** Returns the parked path and clears it, or null. */
export function takePostLoginPath(): string | null {
  const s = sessionStore();
  if (!s) return null;
  const path = s.getItem(POST_LOGIN_PATH_KEY);
  s.removeItem(POST_LOGIN_PATH_KEY);
  return path && isAppPath(path) ? path : null;
}
