import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
