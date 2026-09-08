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

/* ---------------------------------------------------------------------------
 * DASHBOARDS (card KI-714, Stage 4b)
 *
 * The three dashboards are the same case as Login, one level up: each derives
 * its whole rendered state from GET responses and takes no props that describe
 * it (Dashboard takes only `kbId`/`kbName`; the two admin dashboards take no
 * props at all). So the stories set responses, never internals.
 *
 * `*Pending` is what makes a LOADING story real rather than a screenshot of
 * one: the handler returns a promise that never settles, so the component sits
 * in exactly the state a slow backend puts it in — its own `loading` state,
 * reached through its own effect. `beforeEach`'s teardown restores the adapter
 * when the story is switched, so a hanging request cannot leak into the next.
 * The types below are structural mirrors of the components' own response
 * interfaces; they are deliberately NOT imported from the components, so a
 * fixture cannot silently follow a change in the code under test.
 * ------------------------------------------------------------------------- */

/** A promise that never settles — the loading state, held open. */
const never = () => new Promise<never>(() => {});

export interface ApiMockParameters {
  authProviders?: MockAuthConfig;
  loginRejection?: MockLoginRejection;
  /** GET /api/kb/{id}/analytics */
  kbAnalytics?: unknown;
  /** GET /api/kb/{id}/analytics/retrieval-quality */
  kbRetrievalQuality?: unknown;
  /** GET /api/admin/kb-overview */
  kbOverview?: unknown;
  /** GET /api/system-health/live */
  systemHealthLive?: unknown;
  /** GET /api/system-health/history (one shape answers all four metrics) */
  systemHealthHistory?: unknown;
  /** POST /api/system-health/ai-check */
  aiCheck?: unknown;
  /** Endpoints whose request must hang, so the story shows the loading state. */
  pending?: Array<
    | 'kbAnalytics'
    | 'kbRetrievalQuality'
    | 'kbOverview'
    | 'systemHealthLive'
    | 'systemHealthHistory'
  >;
}

/**
 * Tail-anchored URL patterns. API_BASE_URL is the Storybook origin at runtime
 * (.storybook/env.ts), so the URL axios is handed is absolute; the query
 * string is matched by axios-mock-adapter separately from the path, which is
 * why `analytics` needs the `(\?|$)` tail — `Dashboard` always appends `?…`.
 */
const URLS = {
  kbAnalytics: /\/api\/kb\/[^/]+\/analytics(\?|$)/,
  kbRetrievalQuality: /\/api\/kb\/[^/]+\/analytics\/retrieval-quality(\?|$)/,
  kbOverview: /\/api\/admin\/kb-overview$/,
  systemHealthLive: /\/api\/system-health\/live$/,
  systemHealthHistory: /\/api\/system-health\/history$/,
} as const;

/** Installs the handlers and returns the teardown. */
export function installApiMock(params: ApiMockParameters): () => void {
  const mock = new MockAdapter(axios, { onNoMatch: 'passthrough' });

  if (params.authProviders) {
    mock.onGet(/\/api\/auth\/providers$/).reply(200, params.authProviders);
  }

  if (params.loginRejection) {
    mock
      .onPost(/\/api\/auth\/login$/)
      .reply(params.loginRejection.status, params.loginRejection.body);
  }

  const pending = new Set(params.pending ?? []);

  // retrieval-quality FIRST: axios-mock-adapter matches handlers in
  // registration order, and `/analytics(\?|$)` would otherwise swallow
  // `/analytics/retrieval-quality?…` before the more specific pattern is
  // reached.
  if (pending.has('kbRetrievalQuality')) {
    mock.onGet(URLS.kbRetrievalQuality).reply(never);
  } else if (params.kbRetrievalQuality !== undefined) {
    mock.onGet(URLS.kbRetrievalQuality).reply(200, params.kbRetrievalQuality);
  } else {
    // Dashboard treats a failure here as "optional data absent" and keeps
    // rendering, so 404 is the honest default rather than an empty object.
    mock.onGet(URLS.kbRetrievalQuality).reply(404, { error: 'not configured' });
  }

  for (const key of ['kbAnalytics', 'kbOverview', 'systemHealthLive', 'systemHealthHistory'] as const) {
    if (pending.has(key)) {
      mock.onGet(URLS[key]).reply(never);
    } else if (params[key] !== undefined) {
      mock.onGet(URLS[key]).reply(200, params[key]);
    }
  }

  if (params.aiCheck !== undefined) {
    mock.onPost(/\/api\/system-health\/ai-check$/).reply(200, params.aiCheck);
  }

  return () => mock.restore();
}
