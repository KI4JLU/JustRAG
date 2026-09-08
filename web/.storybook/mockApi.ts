import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

/**
 * Story-level API mocking, at the network boundary.
 *
 * The login page has no props that describe its state: everything visible on
 * it is derived inside the component from ONE response, `GET
 * /api/auth/providers` (see src/Login.tsx — `oidcProvider = providers.find(p
 * => p.type === 'oidc')`, `ldapActive = providers.some(p => p.type ===
 * 'ldap')`). So a story must supply that response and nothing else. Handing
 * `Login` a doubled child, a fake hook or a pre-computed `showOidcButton`
 * would render a component the app never renders.
 *
 * The interception point is axios's `adapter` — the last layer before the
 * XHR — reached through `axios-mock-adapter`, a published library rather than
 * a hand-rolled patch. Everything above it is the real thing: the real
 * `useEffect`, the real URL construction from `API_BASE_URL`, the real
 * `res.data.providers ?? []` handling, the real `.catch()` fallback. Requests
 * are matched by METHOD and URL, exactly as an HTTP-level mock would.
 *
 * Known limit, stated rather than glossed: the browser's own XHR, CORS and
 * response headers are NOT exercised, because the adapter answers before
 * them. A service-worker mock (MSW) would cover those too, at the price of
 * shipping a mock service worker through web/public — a file that would then
 * be part of the production bundle of a repo we do not own. `onNoMatch:
 * 'passthrough'` keeps everything unmatched on the real network, which is why
 * LegalPage's `fetch()` of /legal/*.html still hits Storybook's static dir.
 */

export interface MockAuthProvider {
  id: string;
  type: string;
  name: string;
}

/** The exact shape of GET /api/auth/providers. */
export interface MockAuthConfig {
  providers: MockAuthProvider[];
  localAuthEnabled: boolean;
}

/** The failure half of POST /api/auth/login, used by the error-state story. */
export interface MockLoginRejection {
  status: number;
  body: { error?: string };
}

export interface ApiMockParameters {
  authProviders?: MockAuthConfig;
  loginRejection?: MockLoginRejection;
}

/** Installs the handlers and returns the teardown. */
export function installApiMock(params: ApiMockParameters): () => void {
  const mock = new MockAdapter(axios, { onNoMatch: 'passthrough' });

  if (params.authProviders) {
    // Tail-anchored: API_BASE_URL is the Storybook origin at runtime
    // (.storybook/env.ts), so the URL axios is handed is absolute.
    mock.onGet(/\/api\/auth\/providers$/).reply(200, params.authProviders);
  }

  if (params.loginRejection) {
    mock
      .onPost(/\/api\/auth\/login$/)
      .reply(params.loginRejection.status, params.loginRejection.body);
  }

  return () => mock.restore();
}
