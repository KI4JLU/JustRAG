import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import App from './App';
import { translations } from './translations';

/* ---------------------------------------------------------------------------
 * The route-level provider guard for „Geteilte Knowledge Bases" (card KI-783).
 *
 * WHY A SECOND FILE AND NOT A THIRD CASE IN `App.authenticated-home.test.tsx`.
 * That file's subject is the HOME branch of `AuthenticatedApp`; this card added
 * a SECOND branch, and a second branch is a second place the provider tree can
 * be got wrong. Keeping them apart means a failure names which route broke.
 *
 * WHAT IT GUARDS, in the exact terms its sibling states. `SharedKbsView` mounts
 * `AppChrome`, which calls `useSharingContext()` and `useAppNav()`; both throw
 * when their provider is missing, and both are mounted per branch in
 * `AuthenticatedApp`. `SharedKbsView.stories.tsx` supplies its own providers in
 * a harness, so all six stories would stay green if this branch forgot one —
 * which is the KI-740 failure mode verbatim: a screen that crashes on the route
 * every user reaches it by, while both component suites pass.
 *
 * IT IS ALSO THE ONLY PLACE THE NAVIGATION IS EXERCISED END TO END. The stories
 * assert that the sidebar row calls a spy; this file clicks the real row in the
 * real app and checks that the app actually arrives — the `ViewType` union
 * member, the render branch, and the `AppNavContext` wiring, in one path. A spy
 * cannot tell you that `setView('shared-kbs')` matches a branch.
 *
 * ONLY the network is stubbed (axios and `fetch`), plus the browser APIs jsdom
 * does not implement. No provider, no context and no hook is mocked — mocking
 * them is precisely what would hide the bug.
 *
 * ORACLES, all independent of the code under test: `translations.ts` for every
 * expected string, WAI-ARIA's `h1` -> heading mapping and its `aria-current`
 * contract, and `ErrorBoundary`'s own fallback copy ("Something went wrong") as
 * the negative check — a missing provider throws, App's outermost boundary
 * catches it, and that string is the observable signature.
 * ------------------------------------------------------------------------- */

// Same shape as the sibling suites: App reaches for `defaults` and
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
  // Radix measures and captures pointers; jsdom implements neither. Same shim
  // the sibling suites use — it enables clicking the shell's widgets, nothing
  // more.
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

  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 'user-1', username: 'grace', role: 'user' }));
  localStorage.setItem('language', 'de');
  // The tour would otherwise open over the overview on a first visit.
  localStorage.setItem('onboardingCompleted', 'true');

  // Every GET the authenticated tree fires on mount answers empty. The point
  // is the provider tree and the route, not the data.
  mockedGet.mockResolvedValue({ data: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The overview's own h1 — the starting point, because the app boots on 'home'.
 *
 * The timeout is not flake-papering: `AuthenticatedApp` is a `lazy()` import
 * (App.tsx:24), so the first assertion waits on a real dynamic module load,
 * which under the full suite's concurrency exceeds testing-library's 1000ms
 * default. What is waited for is a module fetch, not a behaviour, and a longer
 * wait cannot make a broken provider tree look correct: a missing provider
 * throws synchronously during render and the heading never appears at all.
 */
function findOverviewHeading() {
  return screen.findByRole(
    'heading',
    { level: 1, name: translations.myKBs.de },
    { timeout: 15000 },
  );
}

describe('App — the „Geteilte Knowledge Bases" view on the authenticated route', () => {
  it('reaches the view from the sidebar row with every provider it consumes mounted', async () => {
    render(<App />);
    await findOverviewHeading();

    // ORACLE: translations.ts. The row the developer's nav spec names, on the
    // page the app boots to, NOT yet the current page.
    const row = screen.getByRole('button', { name: translations.sharedKbs.de });
    expect(row).not.toHaveAttribute('aria-current');

    await userEvent.click(row);

    /* ORACLE: translations.ts + the ARIA mapping for h1. `SharedKbsView`
     * reached `useSharingContext()` and `useAppNav()` during this render, via
     * `AppChrome`; had either thrown, there would be no heading to find. This
     * is also the only assertion in the repo that proves the union member, the
     * render branch and the context wiring line up. */
    expect(
      await screen.findByRole('heading', { level: 1, name: translations.sharedKbs.de }),
    ).toBeInTheDocument();

    // And the overview is gone — a branch that fell through to 'home' would
    // otherwise satisfy nothing above except by accident.
    expect(
      screen.queryByRole('heading', { level: 1, name: translations.myKBs.de }),
    ).not.toBeInTheDocument();

    // ORACLE: ErrorBoundary's own fallback copy. Belt and braces — a context
    // that threw inside a child rendering nothing would be invisible above.
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('marks the row as the current page and offers the way back', async () => {
    render(<App />);
    await findOverviewHeading();

    await userEvent.click(screen.getByRole('button', { name: translations.sharedKbs.de }));
    await screen.findByRole('heading', { level: 1, name: translations.sharedKbs.de });

    /* ORACLE: WAI-ARIA's `aria-current` contract plus translations.ts. Exactly
     * one element on the page may claim to be the current one, and it has to be
     * the row just used. Asserted as the full set rather than a single positive
     * check, because "and drops off the others" is the half a careless `active`
     * wiring gets wrong — and the `AppShell` renders its nav TWICE (sidebar +
     * mobile drawer), so a second copy of the attribute is a live possibility
     * rather than a hypothetical. */
    const current = document.querySelectorAll('[aria-current]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(translations.sharedKbs.de);

    // ORACLE: translations.ts. The way back exists, is not current, and works —
    // without it this view would be a dead end in an app that has no router and
    // therefore no browser Back.
    const overview = screen.getByRole('button', { name: translations.home.de });
    expect(overview).not.toHaveAttribute('aria-current');
    await userEvent.click(overview);
    expect(await findOverviewHeading()).toBeInTheDocument();
  });

  /* ---------------------------------------------------------------------
   * The minimised sidebar, on the real route (card KI-789).
   *
   * WHY IT IS HERE AND NOT IN A COMPONENT SUITE. Three of the four claims can
   * only be made where the whole app is mounted:
   *  - „both views pick it up" is a statement about `AppChrome` being the ONE
   *    shell both branches of `AuthenticatedApp` mount. A component suite
   *    renders one view and could not tell a shared chrome from two copies
   *    that happen to agree;
   *  - „survives a reload" is a statement about a fresh mount reading
   *    `localStorage` back, which is what `unmount()` + a second `render`
   *    reproduces — the closest a jsdom suite gets to F5, and the only half of
   *    the claim a test can make (the browser's own restart is not testable
   *    here, and is not asserted);
   *  - the state is genuinely persisted, rather than held in a module-level
   *    variable that would survive a remount for the wrong reason. The
   *    `localStorage` key is read directly and spelled out, so a renamed key
   *    is a failure rather than a silent loss of everyone's preference.
   *
   * ORACLES, none of them this repo's code: `translations.ts` for the two
   * toggle names and the nav rows, WAI-ARIA's `aria-expanded` /
   * `aria-controls` contract as testing-library and jsdom resolve them, and
   * the `'1'`/`'0'` encoding this app has stored booleans under since Stage 7b
   * (`useSectionOpen`), written out here rather than imported.
   *
   * NOT asserted here: that the column actually gets narrower, or that the row
   * labels stop being painted. jsdom applies no stylesheet and would agree
   * with anything; `AppShellCollapsed` in `HomeView.stories.tsx` measures both
   * in Chromium.
   * ------------------------------------------------------------------- */
  it('remembers the minimised sidebar across the view switch and a remount', async () => {
    const first = render(<App />);
    await findOverviewHeading();

    /* ORACLE: translations.ts. The toggle exists at all only because
       `AppChrome` passes `onCollapsedChange` — `Sidebar` renders none without
       a handler, with no type error and no failing gate — so its presence is
       asserted, never inferred. It is named for what pressing it does. */
    const toggle = screen.getByRole('button', { name: translations.collapseNavigation.de });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // ORACLE: WAI-ARIA. `aria-controls` must RESOLVE to the navigation
    // landmark it expands; `Sidebar` mints that id per mount with `useId`, so
    // nothing outside the design system can supply it.
    const nav = screen.getByRole('navigation', { name: translations.mainNavigation.de });
    expect(toggle.getAttribute('aria-controls')).toBe(nav.id);

    await userEvent.click(toggle);

    // Same control, other direction — it has to survive collapsing, because it
    // is the only way back out.
    expect(screen.getByRole('button', { name: translations.expandNavigation.de }))
      .toBe(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    /* ORACLE: the storage encoding above. This is the fact the remount below
       depends on; asserting only the remount would pass just as well against a
       module-level variable. */
    expect(localStorage.getItem('justrag.chrome.sidebar.collapsed')).toBe('1');

    /* THE A11Y CLAIM. Every nav row keeps its accessible name in the collapsed
       state — `NavItem` moves it from the visible text to `aria-label`, and
       only for rows that were given a `label`. A row missing one does not
       fail: it silently refuses to collapse. Both rows an ordinary user has
       are checked; the admin-gated third is checked in HomeView.test.tsx and
       in `AppShellCollapsed`. ORACLE: translations.ts. */
    for (const name of [translations.home.de, translations.sharedKbs.de]) {
      expect(within(nav).getByRole('button', { name })).toBeInTheDocument();
    }

    // The second view, mounting the SAME `AppChrome`.
    await userEvent.click(within(nav).getByRole('button', { name: translations.sharedKbs.de }));
    await screen.findByRole('heading', { level: 1, name: translations.sharedKbs.de });
    expect(screen.getByRole('button', { name: translations.expandNavigation.de }))
      .toHaveAttribute('aria-expanded', 'false');

    // The reload. A fresh tree, the same storage.
    first.unmount();
    render(<App />);
    await findOverviewHeading();
    expect(screen.getByRole('button', { name: translations.expandNavigation.de }))
      .toHaveAttribute('aria-expanded', 'false');

    // And back out, so the preference is a toggle rather than a trap.
    await userEvent.click(screen.getByRole('button', { name: translations.expandNavigation.de }));
    expect(screen.getByRole('button', { name: translations.collapseNavigation.de }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('justrag.chrome.sidebar.collapsed')).toBe('0');
  });

  it('shows the empty state rather than the overview when nothing is shared', async () => {
    render(<App />);
    await findOverviewHeading();

    await userEvent.click(screen.getByRole('button', { name: translations.sharedKbs.de }));
    await screen.findByRole('heading', { level: 1, name: translations.sharedKbs.de });

    /* ORACLE: translations.ts. `GET /api/kb` answers `[]` here, so the split
     * yields no shared rows and the view has to say so. It shares this string
     * with the overview's section deliberately (one sentence for one absence),
     * which is why the heading above is asserted first — the string alone
     * would not distinguish the two screens. */
    expect(screen.getByText(translations.homeSharedWithMeEmpty.de)).toBeInTheDocument();
  });

  /* -------------------------------------------------------------------------
   * The chrome's catalog search on a view that has no catalog (card KI-787).
   *
   * `KbSearchContext` is a third required context, and this branch mounts it
   * separately from the home branch — so „the overview works" says nothing
   * about this one. What the field DOES here is the card's one reversible
   * assumption: typing navigates to the overview with the query applied,
   * chosen over hiding the field (a control that vanishes between views reads
   * as a bug) and over leaving it inert (a control that lies).
   *
   * // TODO: the navigate-on-type behaviour is the PM's assumption on KI-787,
   * // not a developer ruling — not yet confirmed.
   *
   * ORACLES: translations.ts for the accessible name, WAI-ARIA's h1 mapping
   * for which page is on screen, and the recorded request URL for „the query
   * survived the jump". The last one is the half that a heading assertion
   * alone would miss: navigating with the query DROPPED would look identical.
   * ---------------------------------------------------------------------- */
  it('carries the chrome search here too, and typing lands on the overview with the query applied', async () => {
    render(<App />);
    await findOverviewHeading();

    await userEvent.click(screen.getByRole('button', { name: translations.sharedKbs.de }));
    await screen.findByRole('heading', { level: 1, name: translations.sharedKbs.de });

    /* One keystroke is all it takes, and it is all this call can deliver: the
       jump swaps the whole view branch, so the element `type()` was handed is
       detached before the second character. That is not a quirk of the test —
       it is the remount a real user's second keystroke hits too, which is why
       the chrome hands the caret back (`focusPending`). */
    await userEvent.type(screen.getByLabelText(translations.catalogSearchPlaceholder.de), 'R');

    // Back on the overview...
    expect(
      await screen.findByRole('heading', { level: 1, name: translations.myKBs.de }),
    ).toBeInTheDocument();

    /* ...and the user can keep typing without touching the mouse. ORACLE:
       `userEvent.keyboard` types into whatever the DOCUMENT says is focused —
       it is handed no element. It therefore reaches the rebuilt field only if
       the caret was really moved there; otherwise these four characters go to
       `<body>` and the query stays „R". */
    await userEvent.keyboard('echt');
    expect(screen.getByLabelText(translations.catalogSearchPlaceholder.de)).toHaveValue('Recht');

    // ...and the query drove the catalog: only the panel fires this, and it
    // only exists while „KBs entdecken" is expanded, which the keystroke did.
    await waitFor(
      () => { expect(mockedGet).toHaveBeenCalledWith(expect.stringContaining('q=Recht')); },
      { timeout: 2000 },
    );
  }, 20000);
});
