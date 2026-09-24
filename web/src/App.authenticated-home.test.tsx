import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { stubViewport } from './test/viewport';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  stubViewport();
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
    { level: 1, name: translations.myTopics.de },
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
     * WHERE THEY ARE SINCE KI-776, and why the assertions had to change SHAPE
     * while the oracle did not. The shell moved them out of a flat action row:
     * copy / profile / logout are `DropdownMenuItem`s inside
     * `SidebarUserMenu` — a CLOSED Radix dropdown, so they are not in the
     * document at all until it is opened. Opening it is therefore part of what
     * this test pins now, and it makes the check strictly stronger: the trigger
     * has to render, respond, and carry the handlers behind it.
     *
     * „MEINE AGENTEN" IS NO LONGER ONE OF THEM. KI-782 gated the row on
     * `isSystemAdmin`, and this assertion pinned its absence for the ordinary
     * `user` this file seeds. On 18.09.2026 the row was removed outright, so
     * the absence is no longer a statement about a gate and the assertion says
     * nothing about this route that the admin case would not also say. Deleted
     * rather than kept as a tautology. */

    // The trigger's accessible name is the username SidebarUserMenu shows,
    // which is the one this file seeds into localStorage above.
    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    // „Benutzername kopieren" was removed from the menu (developer, 24.09.2026).
    expect(menu.queryByRole('menuitem', { name: translations.copyUsername.de })).toBeNull();
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
   * for every accessible name (`adminSettings`, `adminDashboard`) and
   * WAI-ARIA's button / menuitem / heading role mappings.
   *
   * („shows the agents row to a system admin" sat here and is deleted: the row
   * was removed from the nav on 18.09.2026. `AgentsView` keeps its two in-KB
   * routes, both behind `canOpenKbAdvancedSettings`, and neither is on this
   * route to assert.)
   * -------------------------------------------------------------------- */
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
  /* -----------------------------------------------------------------------
   * The appearance preferences live in the settings window (developer,
   * 24.09.2026), opened from the user menu's „Einstellungen" item: colour
   * scheme, Style and language under General, the account under Profile.
   * Asserted on the real route because this is the app's only colour-scheme
   * control — if it went missing, no type error or build step would notice.
   *
   * ORACLES: WAI-ARIA's menu/dialog/combobox roles as testing-library resolves
   * them, and src/translations.ts for every name.
   * -------------------------------------------------------------------- */
  it('opens the settings window from the user menu, with the preferences in it', async () => {
    seedUser('admin');
    render(<App />);
    await findOverviewHeading();
    expect(screen.queryByRole('group', { name: translations.colorScheme.de })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    // profile, admin settings, settings, logout.
    expect(menu.getAllByRole('menuitem')).toHaveLength(4);
    await userEvent.click(menu.getByRole('menuitem', { name: translations.settings.de }));

    const dialog = within(await screen.findByRole('dialog', { name: translations.settings.de }));
    expect(dialog.getByRole('heading', { level: 2, name: translations.settingsGeneral.de })).toBeInTheDocument();
    expect(dialog.getByRole('combobox', { name: translations.appearance.de })).toHaveTextContent(translations.themeSystemShort.de);
    expect(dialog.getByRole('combobox', { name: translations.uiShape.de })).toHaveTextContent(translations.uiShapeRounded.de);
    expect(dialog.getByRole('combobox', { name: translations.languageLabel.de })).toHaveTextContent('Deutsch');
    expect(dialog.getByRole('combobox', { name: translations.contrast.de })).toHaveTextContent(translations.themeSystemShort.de);
    expect(dialog.getByRole('combobox', { name: translations.accentColor.de })).toHaveTextContent(translations.accent_standard.de);

    await userEvent.click(dialog.getByRole('button', { name: translations.settingsProfile.de }));
    expect(dialog.getByRole('heading', { level: 2, name: translations.settingsProfile.de })).toBeInTheDocument();
    expect(dialog.getByText('@grace')).toBeInTheDocument();
  });

  // ORACLE: translations.ts, both languages.
  it('names the settings item and window in the session language', async () => {
    localStorage.setItem('language', 'en');
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: translations.myTopics.en }, { timeout: 15000 });

    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    await userEvent.click(menu.getByRole('menuitem', { name: translations.settings.en }));
    const dialog = within(await screen.findByRole('dialog', { name: translations.settings.en }));
    expect(dialog.getByRole('heading', { level: 2, name: translations.settingsGeneral.en })).toBeInTheDocument();
    expect(dialog.queryByText(translations.settingsGeneral.de)).toBeNull();
  });

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

  /* -------------------------------------------------------------------------
   * KI-787 added a THIRD required context, `KbSearchContext`, and put its one
   * consumer in the chrome — so this file's whole reason for existing applies
   * to it verbatim. `useKbSearch()` throws without a provider; the provider is
   * mounted in exactly one place (`AuthenticatedApp`'s two view branches); and
   * `HomeView.test.tsx` and the story file both supply their own harness, so
   * both would stay green if the route forgot it. The test below is the only
   * thing in the repo that can see the real mount.
   * ---------------------------------------------------------------------- */
  it('mounts KbSearchContext on the route, so the chrome search renders and searches', async () => {
    render(<App />);
    await findOverviewHeading();

    // ORACLE: translations.ts for the accessible name. Its presence means
    // `useKbSearch()` resolved during the real render — had the provider been
    // missing, AppChrome would have thrown and the heading above would not
    // exist either.
    const field = screen.getByLabelText(translations.catalogSearchPlaceholder.de);

    // ORACLE: ErrorBoundary's own fallback copy, as the negative check.
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();

    /* ORACLE: the recorded request URL. This is the half a render assertion
       cannot give: the field, the context, the overview's collapsed „KBs
       entdecken" section and the panel's debounced fetch are four separate
       pieces, and only the request proves they are connected end to end on the
       real route. The section starts closed and its body unmounted, so this
       also pins KI-787's deliberate behaviour change — typing expands it. */
    expect(mockedGet).not.toHaveBeenCalledWith(expect.stringContaining('/api/kb/catalog'));
    await userEvent.type(field, 'Recht');
    await waitFor(
      () => { expect(mockedGet).toHaveBeenCalledWith(expect.stringContaining('q=Recht')); },
      { timeout: 2000 },
    );
  }, 20000);

  /* KI-787 also DELETED the chrome's page label, which had rendered „Meine
   * Knowledge Bases" as a `<p>` directly above the content template's `<h1>`
   * with the same words. ORACLE: translations.ts plus the design system's own
   * rule that `pageLabel` is a `<p>` and never a heading — so „the label is
   * gone" is „no <p> carries that text", while the `<h1>` this file already
   * waits for proves the page kept its real title. */
  it('shows the page title only as the content template\'s h1, with no chrome label above it', async () => {
    render(<App />);
    await findOverviewHeading();

    const asParagraph = screen.getAllByText(translations.myTopics.de).filter(el => el.tagName === 'P');
    expect(asParagraph).toEqual([]);
  });
});
