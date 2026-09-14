import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import App from './App';
import { translations } from './translations';

/* ---------------------------------------------------------------------------
 * The test that KI-740's lesson demands for KI-770.
 *
 * KI-770 moved 20 of `HomeView`'s 38 props onto two NEW required contexts,
 * `SharingContext` and `AppNavContext`. Both `useSharingContext()` and
 * `useAppNav()` throw when their provider is missing, and the provider is
 * mounted in exactly one place: `AuthenticatedApp`'s `view === 'home'` branch.
 *
 * Neither of the suites that guard `HomeView` can see that mount. The story
 * file supplies its own providers in a harness, and `HomeView.test.tsx`
 * supplies its own in `renderView` — so if the app forgot to mount them, or
 * mounted them below the component instead of above it, all 12 stories and all
 * 22 unit tests would stay green while the overview threw on the route every
 * signed-in user lands on. That is the KI-740 failure mode verbatim, and
 * .storybook/preview.tsx says so in as many words: "any new globally provided
 * context here needs the same kind of test rather than the assurance of a
 * green story."
 *
 * So this file asserts the WIRING, not the view: it renders the real `App`
 * with a token in storage, i.e. the real ErrorBoundary / ThemeProvider /
 * MobileProvider / ToastProvider composition, the real lazy `AuthenticatedApp`,
 * the real `useSharing()` and the real `HomeView`, and looks for the overview's
 * own heading. No provider, no context and no hook is mocked — mocking them is
 * precisely what would hide the bug.
 *
 * ONLY the network is stubbed (axios and `fetch`), plus the browser APIs jsdom
 * does not implement.
 *
 * ORACLES, all independent of the code under test: translations.ts for the
 * expected heading (`myKBs`), WAI-ARIA's mapping of `h1` to `role="heading"`
 * with `level: 1`, and ErrorBoundary's own fallback copy ("Something went
 * wrong") as the negative check — a missing provider throws, App's outermost
 * boundary catches it, and that string is the observable signature.
 * ------------------------------------------------------------------------- */

// Same shape as App.unauthenticated.test.tsx: App reaches for `defaults` and
// `interceptors` at mount, and the authenticated tree's hooks for the verbs.
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

const mockedGet = axios.get as unknown as Mock;

/** A real in-memory Storage, installed fresh per test. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, v); },
  } as Storage;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  window.history.replaceState(null, '', '/');

  // A token and a user in storage are the whole authentication decision
  // App.tsx makes (App.tsx:37-55), so this is what puts the render on the
  // authenticated route.
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 'user-1', username: 'grace', role: 'user' }));
  localStorage.setItem('language', 'de');
  // The tour would otherwise open over the overview on a first visit.
  localStorage.setItem('onboardingCompleted', 'true');

  // Every GET the authenticated tree fires on mount answers empty. The point
  // is the provider tree, not the data.
  mockedGet.mockResolvedValue({ data: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The overview's own h1, waited for with an explicit timeout.
 *
 * The timeout is not flake-papering: `AuthenticatedApp` is a `lazy()` import
 * (App.tsx:24), so the first assertion in this file waits on a real dynamic
 * module load, and under the full suite's concurrency that alone exceeded
 * testing-library's 1000ms default — the file passed in isolation and failed
 * deterministically in `npm test`. What is being waited for is a module
 * fetch, not a behaviour, and a longer wait cannot make a broken provider
 * tree look correct: a missing provider throws synchronously during the
 * render and the heading never appears at all.
 *
 * ORACLE: translations.ts (`myKBs`) and WAI-ARIA's `h1` -> heading mapping.
 */
function findOverviewHeading() {
  return screen.findByRole(
    'heading',
    { level: 1, name: translations.myKBs.de },
    { timeout: 15000 },
  );
}

describe('App — the KB overview on the authenticated home route', () => {
  it('mounts every provider HomeView consumes, so the overview renders', async () => {
    render(<App />);

    // ORACLE: translations.ts + the ARIA mapping for h1. `HomeView` reached
    // `useSharingContext()` and `useAppNav()` during this render; had either
    // thrown, there would be no heading to find.
    expect(await findOverviewHeading()).toBeInTheDocument();

    // ORACLE: ErrorBoundary's own fallback copy. Belt and braces — a context
    // that threw inside a child that renders nothing would be invisible above.
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('renders the action-row controls that read the two new contexts', async () => {
    render(<App />);

    await findOverviewHeading();

    /* ORACLE: translations.ts for each accessible name. These four are exactly
     * the controls whose handlers stopped being props under KI-770 — the copy
     * button reads `SharingContext`, profile and agents read `AppNavContext`,
     * and logout reads `AuthContext.logout` instead of an `onLogout` prop. A
     * provider mounted but empty, or a handler wired to the wrong member,
     * still renders a button; what this pins is that the real app supplies all
     * four sources on this route. */
    expect(screen.getByRole('button', { name: translations.copyUsername.de })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translations.profile.de })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translations.myAgents.de })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translations.logout.de })).toBeInTheDocument();
  });
});
