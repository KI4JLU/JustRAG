import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

/**
 * The signed-in user, written where `App` reads it.
 *
 * The SYSTEM ROLE became an axis of this file with KI-782: the sidebar's
 * agents row and the user menu's admin entry are gated on it, so a fixture
 * that only ever said `user` could no longer see either control, and one that
 * only ever said `admin` could not tell a gate from an unconditional render.
 * Called from `beforeEach` with the ordinary role; the two admin tests
 * re-seed before they render.
 */
function seedUser(role: 'user' | 'admin') {
  localStorage.setItem('user', JSON.stringify({ id: 'user-1', username: 'grace', role }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // The sidebar's user menu is a Radix dropdown: it measures and captures
  // pointers, and jsdom implements neither. Same shim the admin suites use
  // (AdminEvalTab.test.tsx:56) — it enables opening the menu with a click,
  // nothing more.
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
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
  seedUser('user');
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
     * still renders a control; what this pins is that the real app supplies all
     * four sources on this route.
     *
     * WHERE THEY ARE SINCE KI-776, and why three of the four assertions had to
     * change SHAPE while the oracle did not. The shell moved them out of a flat
     * action row: „Meine Agenten" is a sidebar `NavItem`, i.e. still a button on
     * the page, while copy / profile / logout are `DropdownMenuItem`s inside
     * `SidebarUserMenu` — a CLOSED Radix dropdown, so they are not in the
     * document at all until it is opened. Opening it is therefore part of what
     * this test pins now, and it makes the check strictly stronger: the trigger
     * has to render, respond, and carry the four handlers behind it.
     *
     * WHAT KI-782 CHANGED HERE, and it is an ORACLE change rather than a
     * locator one: „Meine Agenten" is gated on `isSystemAdmin`, and this
     * file's fixture is an ordinary `user`, so the row is now ABSENT on this
     * route. The `AppNavContext` half of the wiring is therefore checked by
     * the admin test below, where the row exists; the assertion here is the
     * BEHAVIOUR change itself — a non-admin's overview no longer offers the
     * agents screen. */
    expect(screen.queryByRole('button', { name: translations.myAgents.de })).toBeNull();

    // The trigger's accessible name is the username SidebarUserMenu shows,
    // which is the one this file seeds into localStorage above.
    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByRole('menuitem', { name: translations.copyUsername.de })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: translations.profile.de })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: translations.logout.de })).toBeInTheDocument();
    // The admin entry KI-782 moved into this menu is gated on the same system
    // role, so an ordinary user must not find it here either.
    expect(menu.queryByRole('menuitem', { name: translations.adminSettings.de })).toBeNull();
  });

  /* -----------------------------------------------------------------------
   * KI-782, the admin side of both gates — on the REAL route.
   *
   * Why here and not only in `HomeView.test.tsx`: that suite mocks
   * `AuthContext` and supplies `AppNavContext` from a harness, so it can say
   * what `AppChrome` does with a role and a spy, and nothing about what the
   * assembled app does with a stored user. This file renders `App` with only
   * the network stubbed, which is the only place the two can be compared.
   *
   * The admin console has NO other entry point since Stage 7b deleted the
   * floating admin button, so the click path is exercised end to end rather
   * than asserted as a rendered name: the item must reach `setView('admin')`
   * and the admin view must actually come up.
   *
   * ORACLES, both independent of the code under change: src/translations.ts
   * for every accessible name (`myAgents`, `adminSettings`, `adminDashboard`)
   * and WAI-ARIA's button / menuitem / heading role mappings.
   * -------------------------------------------------------------------- */
  it('shows the agents row to a system admin', async () => {
    seedUser('admin');
    render(<App />);

    await findOverviewHeading();

    expect(screen.getByRole('button', { name: translations.myAgents.de })).toBeInTheDocument();
  });

  it('reaches the admin console from the user menu', async () => {
    seedUser('admin');
    render(<App />);

    await findOverviewHeading();

    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    await userEvent.click(menu.getByRole('menuitem', { name: translations.adminSettings.de }));

    /* ORACLE: translations.ts (`adminDashboard`) + the h1 mapping. `AdminUI`
     * is a lazy import behind a Suspense boundary, hence the same generous
     * timeout `findOverviewHeading` explains — a module fetch, not a
     * behaviour, is what is being waited for. */
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: translations.adminDashboard.de },
        { timeout: 15000 },
      ),
    ).toBeInTheDocument();
  });

  /* Card KI-781 gave the onboarding-tour trigger a stable `id` so it can be
   * addressed by the tour itself or by external scripting. An `id` is only
   * worth anything if it resolves to exactly ONE element, and that is a
   * property of the rendered DOCUMENT, not of the component: `AuthenticatedApp`
   * could grow a second mount point, or another component could take the same
   * id, and the component's own source would still look correct. This file is
   * where that can be seen, because it renders the real `App` down to the real
   * `view === 'home'` branch with only the network stubbed.
   *
   * ORACLES, both independent of the code under change:
   *  - `document.querySelectorAll` / `getElementById` — the DOM's own id
   *    semantics, supplied by jsdom, not by anything this card wrote. The
   *    count is the assertion; a duplicated id makes it 2 and fails.
   *  - `translations.ts` (`onboardingReopenTour`) for the accessible name,
   *    which pins that the id landed on the TOUR trigger and not on some other
   *    button that happens to exist on the overview.
   *
   * Deliberately NOT asserted: the corner it sits in. The position is inline
   * CSS with no layout in jsdom, so any such assertion would only restate the
   * style object back to itself — no independent oracle exists for it here,
   * and a green assertion would be worse than none. */
  it('renders the onboarding-tour trigger under exactly one stable id', async () => {
    render(<App />);

    await findOverviewHeading();

    // ORACLE: the DOM's id semantics. Unique means exactly one, not >= one.
    const matches = document.querySelectorAll('#onboarding-tour-trigger');
    expect(matches).toHaveLength(1);

    // ORACLE: translations.ts — the id is on the tour trigger specifically.
    const trigger = document.getElementById('onboarding-tour-trigger');
    expect(trigger?.tagName).toBe('BUTTON');
    expect(trigger).toHaveAccessibleName(translations.onboardingReopenTour.de);
  });
});
