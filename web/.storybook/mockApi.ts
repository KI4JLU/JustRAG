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

/* ---------------------------------------------------------------------------
 * THE SECOND NETWORK BOUNDARY (card KI-728)
 *
 * Everything above intercepts axios. This app has a second, independent HTTP
 * client: `authFetch` in src/api.ts, a thin wrapper around the browser's own
 * `window.fetch`. An axios adapter cannot see it — the two do not share a
 * transport — so a story whose component reaches the backend through
 * `authFetch` gets a real request against the Storybook origin.
 *
 * That matters for the admin tabs, and it is why KI-728's claim-time
 * measurement ("AdminAgentTab: zero network calls") is true of the FILE and
 * false of the SCREEN: `grep -cE 'axios\.|fetch\('` over AdminAgentTab.tsx
 * returns 0, but the tab renders two children that fetch on mount —
 * AdminMCPSection (`GET /api/admin/mcp/status`, AdminMCPSection.tsx:152) and
 * AdminAgentMetricsCard (`GET /api/admin/agent-metrics`,
 * AdminAgentMetricsCard.tsx:152) — and AdminEvalTab reaches
 * `GET /api/kb/{id}/agents` through `fetchKbAgents`
 * (src/components/agents/api.ts:104). All three go through `authFetch`.
 * Unmocked, each renders its own `Error: HTTP 404` box, which is a false
 * signal for the reviewer this card exists to serve.
 *
 * So the three are answered here, at the `window.fetch` boundary, on the same
 * terms as the axios half: matched by METHOD and URL, with everything above
 * the transport left real (the real effect, the real `API_BASE_URL`
 * construction, the real `r.ok` check, the real `.catch()`). The patch is
 * installed ONLY when a story asks for one of these responses, so the 43
 * stories that existed before this card run with `window.fetch` untouched;
 * anything unmatched is handed to the original `fetch`, which is what keeps
 * LegalPage's fetch of /legal/*.html on Storybook's static dir.
 *
 * Known limit, same as for the axios half: the patch answers before the
 * browser's own XHR/CORS/response-header handling, so none of that is
 * exercised. A `Response` object is constructed, so `r.ok`, `r.status` and
 * `r.json()` are the browser's real implementations rather than a double.
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

  /* -- AdminEvalTab, axios half (card KI-728). Both the admin prefix
   * (/api/admin/eval) and the KB-scoped one (/api/kb/{id}/eval) end in the
   * same three path tails, so one pattern serves both `basePath` modes. -- */
  /** GET {basePath}/golden-sets */
  evalGoldenSets?: unknown;
  /** GET {basePath}/golden-sets/jobs */
  evalGoldenSetJobs?: unknown;
  /** GET {basePath}/runs?limit&offset[&status] */
  evalRuns?: unknown;

  /* -- The authFetch (window.fetch) half. See the block comment above. -- */
  /** GET /api/admin/mcp/status — AdminMCPSection, a child of AdminAgentTab. */
  mcpStatus?: unknown;
  /** GET /api/admin/agent-metrics?window=… — AdminAgentMetricsCard. */
  agentMetrics?: unknown;
  /** GET /api/kb/{id}/agents — AdminEvalTab's team select, via fetchKbAgents. */
  kbAgents?: unknown;
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
  /* AdminEvalTab. `/eval/` rather than the full prefix, so the same pattern
   * matches basePath='/api/admin/eval' and basePath='/api/kb/{id}/eval'. */
  evalGoldenSetJobs: /\/eval\/golden-sets\/jobs(\?|$)/,
  evalGoldenSets: /\/eval\/golden-sets(\?|$)/,
  evalRuns: /\/eval\/runs(\?|$)/,
} as const;

/**
 * The authFetch endpoints, in the order they are tried. A `RegExp` per route,
 * matched against the absolute URL the component built.
 */
const FETCH_URLS = {
  mcpStatus: /\/api\/admin\/mcp\/status(\?|$)/,
  agentMetrics: /\/api\/admin\/agent-metrics(\?|$)/,
  kbAgents: /\/api\/kb\/[^/]+\/agents(\?|$)/,
} as const;

/**
 * Patches `window.fetch` for the routes a story declared and returns the
 * restore. Anything unmatched is handed to the ORIGINAL fetch, so a story that
 * declares one route does not take the others off the network.
 *
 * `url` is read the way the Fetch standard defines the first argument — a
 * string, a `URL`, or a `Request` — rather than assuming the string form,
 * because `authFetch` forwards whatever its caller passed.
 */
function installFetchMock(routes: Array<[RegExp, unknown]>): () => void {
  // `.bind(window)`, not a bare reference: `fetch` is a method on the global
  // object, and some engines reject a detached call to it ("Illegal
  // invocation"). The passthrough branch below is the only caller, and no
  // story in the suite currently reaches it — so this would be an untested
  // path failing in the one situation it exists for.
  // TODO: the passthrough branch is not covered by an assertion; no current
  // story both installs this patch and requests an unmatched URL.
  const original = window.fetch;
  const passthrough = original.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [pattern, body] of routes) {
      if (pattern.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
    }
    return passthrough(input, init);
  };
  return () => {
    window.fetch = original;
  };
}

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

  /* -- AdminEvalTab (card KI-728) --------------------------------------- */

  // `/golden-sets/jobs` FIRST, for the same reason retrieval-quality is first
  // above: registration order decides, and `/golden-sets(\?|$)` would not
  // match `/golden-sets/jobs` — but the reverse ordering mistake is the easy
  // one to make later, so the specific pattern stays in front.
  if (params.evalGoldenSetJobs !== undefined) {
    mock.onGet(URLS.evalGoldenSetJobs).reply(200, params.evalGoldenSetJobs);
  }
  if (params.evalGoldenSets !== undefined) {
    mock.onGet(URLS.evalGoldenSets).reply(200, params.evalGoldenSets);
  }
  if (params.evalRuns !== undefined) {
    mock.onGet(URLS.evalRuns).reply(200, params.evalRuns);
  }
  // The kick-off POST. 202 with no body is what the component's success path
  // needs (it only awaits the promise, then toasts and refetches); a story
  // that submits therefore exercises the real request, not a short-circuit.
  // Registered whenever the runs list is mocked, because a story that can
  // list runs is a story where the form can be submitted.
  if (params.evalRuns !== undefined) {
    mock.onPost(URLS.evalRuns).reply(202, {});
  }

  /* Endpoints deliberately NOT answered, so the story shows what production
   * shows rather than a fiction: `POST {basePath}/golden-sets` (upload — needs
   * a real file), `POST {basePath}/golden-sets/generate`,
   * `GET {basePath}/golden-sets/{id}` (download) and the DELETEs. They fall
   * through to `onNoMatch: 'passthrough'`, i.e. a 404 from the Storybook
   * origin, which the component surfaces as its own error toast. */

  /* -- The authFetch half ------------------------------------------------ */

  const fetchRoutes: Array<[RegExp, unknown]> = [];
  for (const key of ['mcpStatus', 'agentMetrics', 'kbAgents'] as const) {
    if (params[key] !== undefined) fetchRoutes.push([FETCH_URLS[key], params[key]]);
  }

  const restoreFetch = fetchRoutes.length > 0 ? installFetchMock(fetchRoutes) : null;

  return () => {
    mock.restore();
    restoreFetch?.();
  };
}
