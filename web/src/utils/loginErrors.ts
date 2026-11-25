import { errorInfo, userErrorKey } from './userErrors';

/**
 * The translation key for a refused password login. The login answers 401
 * for wrong credentials and 400 for a malformed name or password; both mean
 * the credentials are not valid. 403 and 429 keep their shared messages; no
 * response or a 5xx means signing in is not possible right now, which must
 * not read as wrong credentials. The backend's `error` text is never shown.
 */
export function loginErrorKey(err: unknown): string {
  const key = userErrorKey(errorInfo(err), 'invalidCredentials');
  if (key === 'errorServiceUnavailable' || key === 'errorUnexpected') return 'loginUnavailable';
  if (key === 'errorForbidden' || key === 'errorRateLimited') return key;
  return 'invalidCredentials';
}

/** OIDC callback codes (`?oidc_error=`) that ask the user to start over. */
const OIDC_EXPIRED = new Set(['state_missing', 'state_mismatch', 'verifier_missing', 'code_missing']);
/** OIDC callback codes that mean the identity provider is not reachable. */
const OIDC_UNAVAILABLE = new Set(['provider_unavailable', 'provider_init_failed']);
/** OIDC callback codes that mean the account has no usable e-mail address. */
const OIDC_NO_EMAIL = new Set(['email_missing', 'email_unverified']);

/**
 * The translation key for an OIDC callback's `oidc_error` code; any other
 * code is the generic SSO failure. The code itself is never shown.
 */
export function oidcErrorKey(code: string): string {
  if (OIDC_EXPIRED.has(code)) return 'oidcLoginExpired';
  if (OIDC_UNAVAILABLE.has(code)) return 'oidcLoginUnavailable';
  if (OIDC_NO_EMAIL.has(code)) return 'oidcLoginNoEmail';
  return 'oidcLoginFailed';
}
