import { describe, it, expect } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { loginErrorKey, oidcErrorKey } from './loginErrors';

function refusal(status: number, error = 'Invalid username or password'): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = { data: { error }, status, statusText: '', headers: {}, config: { headers: {} } as unknown as InternalAxiosRequestConfig };
  return err;
}

// Oracle: go-backend/internal/authhandler/handler.go Login — 401 wrong
// credentials, 400 malformed name/password, 500 internal; the login route's
// limiter answers 429. docs/user-error-messages.md A23–A25.
describe('loginErrorKey', () => {
  it.each([401, 400, 404])('maps %i to invalidCredentials', (status) => {
    expect(loginErrorKey(refusal(status))).toBe('invalidCredentials');
  });

  it('keeps the shared 403 and 429 messages', () => {
    expect(loginErrorKey(refusal(403))).toBe('errorForbidden');
    expect(loginErrorKey(refusal(429))).toBe('errorRateLimited');
  });

  it.each([500, 502, 503])('maps %i to loginUnavailable, not wrong credentials', (status) => {
    expect(loginErrorKey(refusal(status, 'Internal server error'))).toBe('loginUnavailable');
  });

  it('maps no response to loginUnavailable', () => {
    expect(loginErrorKey(new AxiosError('Network Error'))).toBe('loginUnavailable');
  });
});

// Oracle: the oidcErrRedirect codes in go-backend/internal/authhandler/oidc.go.
describe('oidcErrorKey', () => {
  it.each([
    ['state_missing', 'oidcLoginExpired'],
    ['state_mismatch', 'oidcLoginExpired'],
    ['verifier_missing', 'oidcLoginExpired'],
    ['code_missing', 'oidcLoginExpired'],
    ['provider_unavailable', 'oidcLoginUnavailable'],
    ['provider_init_failed', 'oidcLoginUnavailable'],
    ['email_missing', 'oidcLoginNoEmail'],
    ['email_unverified', 'oidcLoginNoEmail'],
    ['code_exchange_failed', 'oidcLoginFailed'],
    ['something_new', 'oidcLoginFailed'],
  ])('maps %s to %s', (code, key) => {
    expect(oidcErrorKey(code)).toBe(key);
  });
});
