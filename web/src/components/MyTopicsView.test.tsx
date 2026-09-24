import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubViewport } from '../test/viewport';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider as DesignSystemThemeProvider } from '@ki4jlu/design-system';
import axios from 'axios';
import type { KnowledgeBase } from '../types';
import { MyTopicsView, type MyTopicsViewProps } from './MyTopicsView';
import { translations } from '../translations';
import { ModalProvider } from '../contexts/ModalContext';
import { ToastProvider } from '../contexts/ToastContext';
import { AppNavProvider } from '../contexts/AppNavContext';
import { SharingProvider } from '../contexts/SharingContext';
import { KbSearchProvider } from '../contexts/KbSearchContext';
import { useKbRemoval } from '../hooks/useKbRemoval';
import { useSharing } from '../hooks/useSharing';
import { useKbSearchState } from '../hooks/useKbSearchState';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Modal (behind ModalProvider) calls useReducedMotion, which reads
// window.matchMedia — jsdom doesn't implement it, so the real ModalProvider
// every render mounts needs it stubbed (see KbSettingsPanel.test.tsx for the
// same pattern).

// A real in-memory Storage, installed fresh per test.
//
// useSectionOpen persists each section's open state in localStorage, so without
// this a test that expands a section decides the starting state of every test
// after it. That is not hypothetical: it is exactly how this file broke in CI
// while passing locally — jsdom's localStorage differs between the two
// environments (locally it is a bare object with no getItem/setItem, so the
// hook's try/catch silently fell back to defaultOpen every time and hid
// the leak). Owning the implementation here removes that difference: the
// persistence path is genuinely exercised on both machines, and each test
// starts from the defaults.
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
  } as Storage;
}

// Radix measures and captures pointers; jsdom implements neither. The shell
// brings the sidebar's `SidebarUserMenu` dropdown to this suite, so the same
// shim the admin suites use (AdminEvalTab.test.tsx:56) is needed here. It
// enables opening it with a click, nothing more. (`AppShell`'s mobile drawer
// was the second Radix widget behind this shim until design-system 0.30.0
// replaced it with a `BottomTabBar`.)
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  stubViewport();
  vi.stubGlobal('localStorage', memoryStorage());
  // The discovery panel fetches on mount; a bare auto-mocked axios.get
  // returns undefined and its .then() would throw. Individual describes
  // override this.
  mockedAxios.get.mockResolvedValue({ data: [] });
});

// The top-level jumps the chrome around HomeView reads off AppNavContext
// (three since KI-770, five since KI-783 added the „Geteilte Knowledge Bases"
// destination and the Overview row's own handler). Module-level spies: a fresh
// object per render would only add churn.
const NAV = {
  onViewMyTopics: vi.fn(),
  onViewSharedTopics: vi.fn(),
  onViewDiscover: vi.fn(),
  onViewTools: vi.fn(),
  onViewProfile: vi.fn(),
  onViewAdmin: vi.fn(),
};

// Cleared per test since KI-776: two tests now assert CALL COUNTS on these, and
// a module-level spy that is never reset would carry one test's clicks into the
// next.
beforeEach(() => {
  NAV.onViewMyTopics.mockClear();
  NAV.onViewSharedTopics.mockClear();
  NAV.onViewDiscover.mockClear();
  NAV.onViewTools.mockClear();
  NAV.onViewProfile.mockClear();
  NAV.onViewAdmin.mockClear();
});

// The REAL useSharing hook, published on the context HomeView now reads. It
// runs in its own component because it calls useToast() and therefore has to
// sit under ToastProvider, and it is the real hook rather than a stub because
// the share button's "don't also open the KB" behaviour lives inside it
// (useSharing.ts:27) — a stub would make every share assertion in this file a
// statement about the stub.
function SharingHarness({ children }: { children: React.ReactNode }) {
  const sharing = useSharing({ username: 'grace' });
  return <SharingProvider value={sharing}>{children}</SharingProvider>;
}

/**
 * The REAL `useKbSearchState`, published on the context the chrome's search
 * field and the discovery panel both read (card KI-787).
 *
 * Real, not a stub, for the same reason `SharingHarness` is: the behaviour
 * this card adds lives INSIDE the hook — writing a non-empty query expands
 * „KBs entdecken", which is what makes the header field reach a panel that is
 * unmounted while the section is closed. A stubbed `{ query, setQuery }` would
 * turn every assertion about that into a statement about the stub. It also
 * owns the section's `localStorage` key now, so it has to sit inside
 * `renderView` — the remount test above unmounts the whole tree.
 */
function KbSearchHarness({ children }: { children: React.ReactNode }) {
  const kbSearch = useKbSearchState();
  return <KbSearchProvider value={kbSearch}>{children}</KbSearchProvider>;
}

// Every render goes through the providers HomeView's subtree actually needs in
// production. ToastProvider is not optional even for tests that never mean to
// touch the discovery panel: whether that panel mounts depends on persisted
// accordion state, so a bare render would fail or pass depending on what ran
// before it.
// The DESIGN SYSTEM's ThemeProvider, on top of the app providers.
//
// It is not decoration and it is not a stub: the chrome renders a
// `ThemeToggle`, and that toggle calls the design system's own `useTheme()`,
// which throws outright without this provider — measured, it is what made all
// 30 tests in this file fail at once when the shell landed. (KI-776 hit it
// because `AppShellLayout` rendered the toggle itself; since design-system
// 0.26.0 it is `AppChrome`'s sidebar footer that does — KI-788 — so the
// dependency is unchanged.) In
// production the app mounts it inside `contexts/ThemeContext.tsx`'s
// `ThemeProvider`, which this file replaces with a `vi.mock` factory; so the
// factory's replacement has to bring it back, or the harness would be missing a
// provider the real route supplies. (`App.authenticated-home.test.tsx` is the
// test that checks the real route actually supplies it — a harness can't.)
function renderView(ui: React.ReactElement) {
  return render(
    <DesignSystemThemeProvider>
      <ToastProvider>
        <ModalProvider>
          <SharingHarness>
            <AppNavProvider value={NAV}>
              <KbSearchHarness>{ui}</KbSearchHarness>
            </AppNavProvider>
          </SharingHarness>
        </ModalProvider>
      </ToastProvider>
    </DesignSystemThemeProvider>
  );
}

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    language: 'en',
    setLanguage: vi.fn(),
    resolvedTheme: 'light',
    setTheme: vi.fn(),
    t: (key: string) => {
      const entry = translations[key as keyof typeof translations];
      return entry ? entry.en : key;
    },
  }),
}));

// The caller's SYSTEM role, mutable per test. It is a separate axis from the
// KB role: the advanced-settings trigger needs BOTH, so a fixed 'user' here
// would make every one of those assertions unfalsifiable in one direction.
// vi.hoisted because vi.mock's factory is hoisted above this file's top-level
// statements.
const authState = vi.hoisted(() => ({ role: 'user' }));

beforeEach(() => { authState.role = 'user'; });

// `logout` is part of the mock since KI-770: HomeView's logout button reads it
// off this context instead of taking an onLogout prop.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', username: 'grace', role: authState.role },
    siteConfigs: {},
    logout: vi.fn(),
  }),
}));

const baseKb: KnowledgeBase = {
  id: 'kb-1',
  name: 'Security Advisories',
  description: null,
  userId: 'owner-1',
  createdAt: '2026-01-01T00:00:00Z',
  isPro: false,
  aiConfigId: null,
  chatModel: null,
  embeddingModel: null,
  rerankModel: null,
  ttsModel: null,
};

const noopProps = {
  globalKbs: [],
  currentKb: null,
  availableConfigs: [],
  onCreateKB: vi.fn(),
  onSelectKB: vi.fn(),
  onDeleteKB: vi.fn(),
  removingKb: false,
  onCreateGlobalKB: vi.fn(),
  onSubscriptionChange: vi.fn(),
  onOpenKbById: vi.fn(),
  onDeleteGlobalKB: vi.fn(),
  onOpenGlobalKbSettings: vi.fn(),
  onOpenKbSettings: vi.fn(),
  onRenameKB: vi.fn(),
  onToggleFavourite: vi.fn(),
  onUpdateKBSettings: vi.fn(),
  showSettings: false,
  setShowSettings: vi.fn(),
};

// RealRemovalMyTopicsView wires onDeleteKB to the real useKbRemoval hook (rather
// than noopProps' vi.fn() stub) so tests can exercise the actual delete /
// leave / unsubscribe decision, including the real confirmation dialog —
// which needs a real ModalProvider underneath, not a mocked showConfirm.
function RealRemovalMyTopicsView(props: { kbs: KnowledgeBase[]; globalKbs: KnowledgeBase[] } & Partial<MyTopicsViewProps>) {
  const { removeKb, removing } = useKbRemoval();
  const onDeleteKB = async (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    await removeKb(kb);
  };
  const merged = { ...noopProps, ...props, onDeleteKB, removingKb: removing } as MyTopicsViewProps;
  return <MyTopicsView {...merged} />;
}

// Same providers as renderView, but with onDeleteKB wired to the real
// useKbRemoval hook: badge tests and real-removal-flow tests (subscriber
// unsubscribe) both go through it, and showConfirm's dialog actually renders
// because ModalProvider is real rather than mocked.
function renderMyTopicsView(overrides: Partial<MyTopicsViewProps> & { kbs?: KnowledgeBase[]; globalKbs?: KnowledgeBase[] } = {}) {
  const { kbs = [], globalKbs = [], ...rest } = overrides;
  return renderView(<RealRemovalMyTopicsView kbs={kbs} globalKbs={globalKbs} {...rest} />);
}

/* ---------------------------------------------------------------------------
 * The shell KI-776 put this view on — REWRITTEN for design-system 0.30.0.
 *
 * There is no drawer any more. The shell used to render the sidebar node TWICE
 * (a sticky column from `lg` up, a Radix Dialog below it) and let CSS decide
 * which was visible; 0.30.0 replaced that with one area at a time plus a
 * `BottomTabBar`, chosen in JavaScript from `useIsDesktop`. That is the reason
 * this block could be rewritten rather than relabelled: the arrangement is now
 * decided by a value this suite can set (`stubViewport`), so the narrow case is
 * genuinely reachable here instead of being a CSS statement jsdom could not
 * make.
 *
 * ORACLES, all independent of the code under test: WAI-ARIA's `navigation` /
 * `complementary` / `button` role mappings as @testing-library implements them,
 * the DOM's own id semantics, and src/translations.ts for every accessible name.
 * ------------------------------------------------------------------------- */
describe('AppChrome, through the view that mounts it', () => {
  it('reaches the nav column and the user menu through the narrow-screen tab bar', async () => {
    authState.role = 'admin';
    stubViewport(false);
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);

    /* Below `lg` the page is the area on screen, so the nav column is NOT in
       the tree at all — that is the arrangement, not a bug, and it is what
       makes the tab bar load-bearing rather than decorative. */
    expect(screen.queryByRole('navigation', { name: translations.mainNavigation.en })).toBeNull();

    const tabBar = within(screen.getByRole('navigation', { name: translations.switchArea.en }));
    await userEvent.click(tabBar.getByRole('button', { name: translations.navigationTab.en }));

    const column = within(screen.getByRole('complementary', { name: translations.mainNavigation.en }));
    /* ORACLE: translations.ts. All three nav rows, including the admin one the
       mocked system role above unlocks, plus the user-menu trigger — i.e. the
       `nav` and `sidebarFooter` slots both reach the narrow arrangement. This
       is the assertion the old drawer test made; only the route changed. */
    expect(column.getByRole('button', { name: translations.myTopics.en })).toHaveAttribute('aria-current', 'page');
    expect(column.getByRole('button', { name: translations.sharedTopics.en })).not.toHaveAttribute('aria-current');
    /* „Admin settings" is not a nav row (KI-782) — it is a `DropdownMenuItem`
       inside the user menu, so it is absent from the nav slot here too. */
    expect(column.queryByRole('button', { name: translations.adminSettings.en })).toBeNull();
    expect(column.getByRole('button', { name: /^@grace/ })).toBeInTheDocument();
  });

  it('returns to the content after a nav row is chosen on a narrow screen', async () => {
    stubViewport(false);
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);

    const tabBar = within(screen.getByRole('navigation', { name: translations.switchArea.en }));
    await userEvent.click(tabBar.getByRole('button', { name: translations.navigationTab.en }));
    await userEvent.click(screen.getByRole('button', { name: translations.sharedTopics.en }));

    /* The jump itself still happens — that is the row's own handler, untouched.
       What this pins is the tab handoff `AppChrome` adds on top of it: staying
       on the nav column after a choice reads as a dead tap, so the shell is put
       back on the page. `main` is the landmark the design system renders only
       for the main area, so its presence IS the statement. */
    expect(NAV.onViewSharedTopics).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: translations.mainNavigation.en })).toBeNull();
  });

  /* The user menu — and with it language, colour scheme and Style — is
   * reachable in every arrangement: expanded, collapsed to the rail (where
   * `SidebarUserMenu` renders as its avatar), and on a narrow screen.
   * ORACLE: WAI-ARIA's menu/menuitem mapping and translations.ts. */
  it('keeps the user menu with its settings item reachable in every arrangement', async () => {
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);
    const schemeItem = translations.settings.en;

    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: schemeItem })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: translations.collapseNavigation.en }));
    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: schemeItem })).toBeInTheDocument();
  });

  it('mounts the user menu once on a narrow screen too', async () => {
    stubViewport(false);
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);

    const tabBar = within(screen.getByRole('navigation', { name: translations.switchArea.en }));
    await userEvent.click(tabBar.getByRole('button', { name: translations.navigationTab.en }));

    expect(screen.getAllByRole('button', { name: /^@grace/ })).toHaveLength(1);
  });

  /* ---------------------------------------------------------------------
   * The minimise toggle (KI-789).
   *
   * WHAT THIS FILE CAN SAY, AND WHAT IT DELIBERATELY CANNOT. jsdom applies no
   * stylesheet, so nothing here is a statement about width or about text being
   * painted. The pixels are the design system's own now — its
   * `WithCollapsibleColumns` story measures in Chromium that a row actually
   * fits `SIDE_PANEL_RAIL_WIDTH`, which is where that claim belongs since the
   * rail is its geometry, not this app's. (`AppShellCollapsed` used to make
   * that measurement here against the old 80px `Sidebar` column; it was deleted
   * with the column it measured.) What jsdom CAN see is the DOM contract:
   *
   *  EVERY NAV ROW KEEPS AN ACCESSIBLE NAME, and while collapsed it is an
   *  `aria-label` rather than the visible text. This is the a11y risk of the
   *  whole feature, and it has a silent failure mode in both directions:
   *  `NavItem` collapses only a row it was given a `label` for, so a row
   *  missing one keeps rendering full width next to collapsed neighbours (no
   *  error, no warning, no type failure); and a row that collapsed without one
   *  would lose its name entirely. Asserting the `aria-label` — not merely that
   *  the name resolves — is what distinguishes the collapsed row from a row
   *  that quietly declined to collapse. All three rows, hence the admin fixture.
   *
   * ORACLES: `src/translations.ts` for every name, and WAI-ARIA's button role
   * and accessible-name mappings as jsdom implements them. Neither is derived
   * from this repo's components.
   * ------------------------------------------------------------------- */
  it('collapses the sidebar without taking a name off any nav row', async () => {
    authState.role = 'admin';
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);

    /* RE-QUERIED EACH TIME, never captured once. Design-system 0.31.0 MOVES the
       nav between two mount points — `content` while the column is expanded,
       `collapsedPreview` (the rail) while it is collapsed — so React unmounts
       one `<nav>` and mounts another. A reference taken before the click keeps
       pointing at the detached node, whose rows are the pre-collapse ones: the
       assertions below would then read a stale tree and fail for a reason that
       has nothing to do with the claim. That the node moves rather than being
       duplicated is deliberate (a second mount would duplicate every `id` and
       `aria-current`), and this is the cost of it. */
    const navRows = () =>
      within(screen.getByRole('navigation', { name: translations.mainNavigation.en }));
    const ROWS = [translations.myTopics.en, translations.sharedTopics.en, translations.discoverTopics.en, translations.tools.en];

    // Expanded: the visible text IS the name, so there is no aria-label to
    // override it (and none to drift from it).
    for (const name of ROWS) {
      expect(navRows().getByRole('button', { name })).not.toHaveAttribute('aria-label');
    }

    await userEvent.click(screen.getByRole('button', { name: translations.collapseNavigation.en }));

    /* Collapsed: same three names, now carried by aria-label, and still exactly
       ONE navigation landmark — the move must not leave the old one behind.
       A row that had refused to collapse would still resolve by name and would
       fail the aria-label assertion. */
    expect(screen.getAllByRole('navigation', { name: translations.mainNavigation.en })).toHaveLength(1);
    for (const name of ROWS) {
      expect(navRows().getByRole('button', { name })).toHaveAttribute('aria-label', name);
    }

    // The user menu is the only route to sign-out, so it has to survive too.
    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByRole('menuitem', { name: translations.logout.en })).toBeInTheDocument();
  });

  it('ignores the minimised state on a narrow screen and renders no collapse toggle there', async () => {
    authState.role = 'admin';
    const desktop = renderView(<MyTopicsView kbs={[]} {...noopProps} />);

    // Minimise on the desktop arrangement; the preference is now stored.
    await userEvent.click(screen.getByRole('button', { name: translations.collapseNavigation.en }));
    expect(screen.getAllByRole('button', { name: translations.expandNavigation.en })).toHaveLength(1);

    /* UNMOUNTED before the second render, not left standing: `cleanup` only
       runs between tests, so a second `renderView` here would put two shells in
       one document and every query below would match twice. The stored flag is
       what has to survive the remount — that is the point of the test — and it
       lives in `localStorage`, not in the tree. */
    desktop.unmount();

    stubViewport(false);
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);
    const tabBar = within(screen.getByRole('navigation', { name: translations.switchArea.en }));
    await userEvent.click(tabBar.getByRole('button', { name: translations.navigationTab.en }));

    const column = within(screen.getByRole('complementary', { name: translations.mainNavigation.en }));
    /* NO toggle in either direction. Below `lg` the column IS the screen, so a
       control that collapsed it would leave nothing — and pressing it would
       also destroy the desktop preference on the way out. */
    expect(column.queryByRole('button', { name: translations.expandNavigation.en })).toBeNull();
    expect(column.queryByRole('button', { name: translations.collapseNavigation.en })).toBeNull();

    /* And the rows are the EXPANDED form even though the stored preference says
       minimised: no `aria-label`, i.e. the visible text is still their name.
       `NavItem` takes that from `SidebarCollapsedContext`, which the narrow
       arrangement does not provide — the column is not a `SidePanel` there. */
    for (const name of [translations.myTopics.en, translations.sharedTopics.en, translations.discoverTopics.en, translations.tools.en]) {
      expect(column.getByRole('button', { name })).not.toHaveAttribute('aria-label');
    }

    // The user menu is the only route to sign-out, so it has to survive here.
    await userEvent.click(column.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByRole('menuitem', { name: translations.logout.en })).toBeInTheDocument();
  });

  it('keeps the user menu reachable in the collapsed rail', async () => {
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);

    await userEvent.click(screen.getByRole('button', { name: translations.collapseNavigation.en }));

    /* THE POINT OF design-system PR #30, asserted from the consumer side: the
       footer moves into the 60px rail instead of being hidden with the body, so
       sign-out is still reachable while minimised. `toBeVisible` is what makes
       this a real statement — the control was in the DOM before the fix too,
       inside the `hidden` region, so `getByRole` alone would have passed. */
    const trigger = screen.getByRole('button', { name: /^@grace/ });
    expect(trigger).toBeVisible();

    await userEvent.click(trigger);
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByRole('menuitem', { name: translations.logout.en })).toBeInTheDocument();
  });

  it('routes the sidebar nav rows to the AppNavContext jumps', async () => {
    authState.role = 'admin';
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);

    /* ORACLE: the module-level spies in NAV. One mount per node since
       design-system 0.30.0, so an unscoped query reaches the only row there is.
       („Meine Agenten" was the third row asserted here; it was removed from the
       nav on 18.09.2026 and `AppNavContext.onViewAgents` with it.) */
    await userEvent.click(screen.getByRole('button', { name: translations.discoverTopics.en }));
    expect(NAV.onViewDiscover).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: translations.tools.en }));
    expect(NAV.onViewTools).toHaveBeenCalledTimes(1);

    /* KI-783's new destination, asserted the same way: the row has to reach
       the jump, not merely exist. This is what makes „the sidebar row has a
       destination" a fact rather than a claim — the row and the view were
       added by one card precisely so this could be checked in one place. */
    await userEvent.click(screen.getByRole('button', { name: translations.sharedTopics.en }));
    expect(NAV.onViewSharedTopics).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: translations.myTopics.en }));
    expect(NAV.onViewMyTopics).toHaveBeenCalledTimes(1);
  });

  /* ---------------------------------------------------------------------
   * KI-782's role gate, asserted from BOTH sides.
   *
   * ORACLE-LEVEL, and stated as such: the nav SET now depends on the caller's
   * system role. A suite that only rendered the admin case could not tell
   * „gated" from „always visible", which is why the non-admin case below is
   * the one carrying the behaviour change — a non-admin loses the agents
   * screen, since this row is their only entry to it.
   *
   * ORACLES: src/translations.ts for every accessible name and WAI-ARIA's
   * button/menuitem role mappings — neither derived from the component. The
   * role axis is `authState`, the same mutable fixture the KB-role tests use.
   * ------------------------------------------------------------------- */
  it('hides the admin entry from a non-admin, and keeps every nav row', async () => {
    authState.role = 'user';
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);

    /* Every nav row is unconditional now — „Meine Agenten" was the only gated
       one and it is gone (18.09.2026) — so what this test still checks is the
       ADMIN ENTRY's gate, below. The four rows are asserted first so a failure
       says "the nav did not render" rather than "the gate ate a row". */
    for (const name of [translations.myTopics.en, translations.sharedTopics.en,
                        translations.discoverTopics.en, translations.tools.en]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }

    // And the admin entry is absent from its NEW home as well, i.e. the move
    // did not lose the gate on the way into the dropdown.
    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.queryByRole('menuitem', { name: translations.adminSettings.en })).toBeNull();
    expect(menu.getByRole('menuitem', { name: translations.profile.en })).toBeInTheDocument();
  });

  it('offers the admin entry in the user menu for an admin, and it routes', async () => {
    authState.role = 'admin';
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);

    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));

    /* ORACLE: the NAV spy. Clicking is the assertion, not rendering: the
       admin UI has had no other entry point since the floating admin button
       was deleted, so an item that renders but reaches nothing would lock
       admins out of the console entirely. */
    await userEvent.click(menu.getByRole('menuitem', { name: translations.adminSettings.en }));
    expect(NAV.onViewAdmin).toHaveBeenCalledTimes(1);
  });
});

// The members-dialog trigger used to be gated on kb.userId === user.id
// (owner-only), which made the whole `admin` tier unreachable from the UI —
// a KB admin who isn't the owner could never open the dialog to manage
// members or hand out roles. It must key on myRole instead.
describe('MyTopicsView members-dialog trigger', () => {

  it('shows the trigger for a caller whose myRole is owner', () => {
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<MyTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.getByRole('button', { name: translations.share.en })).toBeInTheDocument();
  });


});

// KbSettingsPanel (RAG settings / evals / workflow) is the KB "advanced
// settings" surface, and its endpoints sit on kbAdvancedChain: a system role in
// {api-user, admin, superadmin} AND KB role admin or better. The trigger must
// therefore be hidden in exactly the cases the server refuses — both terms, not
// the members button's KB-role-only gate, which is what it wrongly shared
// before. The share button beside it deliberately keeps that looser gate, and
// the last case here pins the two apart.
describe('MyTopicsView KB-settings trigger', () => {
  const label = translations.kbAdvancedSettings.en;

  it('hides the trigger from a plain user who OWNS the KB', async () => {
    authState.role = 'user';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<MyTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  });

  it('still offers the plain owner the members dialog — only the advanced surface is gated', () => {
    authState.role = 'user';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<MyTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.getByRole('button', { name: translations.share.en })).toBeInTheDocument();
  });

  it('shows the trigger for an api-user who owns the KB, and hands the KB to the callback', async () => {
    authState.role = 'api-user';
    const onOpenKbSettings = vi.fn();
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<MyTopicsView kbs={[kb]} {...noopProps} onOpenKbSettings={onOpenKbSettings} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(onOpenKbSettings).toHaveBeenCalledWith(kb, expect.anything());
  });


  it('shows the trigger for a superadmin', () => {
    authState.role = 'superadmin';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<MyTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

});

// Renaming is owner-only on a private KB (kbaccess.CanRename on the server;
// canRenameKb here). The pencil must not appear on a shared card whose caller
// is a mere admin member — that role edits everything else, not the name.
describe('MyTopicsView rename trigger', () => {
  const label = translations.renameKb.en;

  it('shows the pencil to the owner and hands the KB to onRenameKB', async () => {
    authState.role = 'user';
    const onRenameKB = vi.fn();
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<MyTopicsView kbs={[kb]} {...noopProps} onRenameKB={onRenameKB} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(onRenameKB).toHaveBeenCalledWith(kb, expect.anything());
  });

  it('does not open the KB when the pencil is clicked', async () => {
    authState.role = 'user';
    const onSelectKB = vi.fn();
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<MyTopicsView kbs={[kb]} {...noopProps} onSelectKB={onSelectKB} onRenameKB={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(onSelectKB).not.toHaveBeenCalled();
  });


});

// Three displayed states from two stored ones (visibility + memberCount).
// memberCount counts the owner too, hence <= 1 rather than === 0.
//
// The fixtures have to respect where each state can actually come from, or the
// test proves nothing about production. GET /api/kb hard-filters
// `WHERE kb.visibility = 'private'`, so the `kbs` prop can never hold a public
// KB; public ones arrive through GET /api/kb/global, i.e. the `globalKbs` prop.
// The earlier version of this file passed `kbs: [{ visibility: 'public' }]` —
// a shape the backend cannot produce — and so kept a dead badge branch green.
/* The badge, and only the badge.
 *
 * „Persönlich" and „Geteilt" are FILTER CHIPS on this page as well now, so an
 * unscoped `getByText(/persönlich/i)` matches two elements — the chip and the
 * badge — and fails for a reason that has nothing to do with the badge. These
 * queries are scoped to the card list; the chips live in the filter row above
 * it, which is a sibling of the grid rather than part of it. */
function inCards() {
  const card = document.querySelector('.home-view__kb-card');
  if (card === null) throw new Error('no KB card rendered');
  return within(card as HTMLElement);
}

/* ---------------------------------------------------------------------------
 * Favourites lead the list, whatever the filter.
 *
 * ORACLE: the fixture's own order, inverted. The two topics are given in
 * NON-favourite-first order (`plain` before `starred`), so a view that simply
 * rendered `kbs` as it received them would fail — which is what makes this a
 * statement about the ordering rather than about the fixture.
 *
 * Read off the DOM in document order via the cards' own name buttons, not off
 * any value the component reports about itself.
 * ------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
 * The filter row: selecting, and clearing by pressing the same chip again.
 *
 * ORACLE: which cards are on screen, read off the DOM — not the chip's own
 * `aria-pressed`, which would only say the row agrees with itself. A filter
 * that highlighted correctly and filtered nothing passes that and fails this.
 * ------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
 * Managing categories: add, rename, delete.
 *
 * WHY IT MATTERS THAT ALL THREE ARE HERE: the „+" chip was create-only for a
 * while, so a typo was permanent and an unwanted category could not be removed
 * — the `PATCH` and `DELETE` endpoints existed the whole time with nothing
 * calling them. These cases are what stop that regressing.
 *
 * ORACLE: the recorded axios calls — METHOD and URL — which is the observable
 * output of each action, plus the chip row's own contents for what the user
 * ends up seeing. Asserting the dialog's internal state instead would pass
 * against a dialog that never made a request.
 * ------------------------------------------------------------------------- */
describe('MyTopicsView category manager', () => {
  const CATEGORY = { id: 'cat-1', name: 'Forschung', sortOrder: 0 };

  beforeEach(() => {
    mockedAxios.get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/api/kb-user-categories') ? [CATEGORY] : [] }),
    );
    mockedAxios.post.mockResolvedValue({ data: { id: 'cat-2', name: 'Lehre', sortOrder: 0 } });
    mockedAxios.patch.mockResolvedValue({ data: { ...CATEGORY, name: 'Projekte' } });
    mockedAxios.delete.mockResolvedValue({ status: 204 });
  });

  async function openManager() {
    renderView(<MyTopicsView kbs={[]} {...noopProps} />);
    // The existing category has to have arrived, or the list is empty for a
    // reason that has nothing to do with the action under test.
    await screen.findByRole('button', { name: CATEGORY.name });
    await userEvent.click(screen.getByRole('button', { name: translations.manageCategories.en }));
    return within(await screen.findByRole('dialog'));
  }

  it('creates one, and it appears as a chip', async () => {
    const dialog = await openManager();

    await userEvent.type(dialog.getByLabelText(translations.newCategoryPrompt.en), 'Lehre');
    await userEvent.click(dialog.getByRole('button', { name: translations.add.en }));

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/kb-user-categories'),
      expect.objectContaining({ name: 'Lehre' }),
    );
    /* Closed first: Radix marks everything outside an open dialog
       `aria-hidden`, so the chip row is genuinely unreachable to a screen
       reader — and to `getByRole` — until it is. Asserting through the dialog
       would have been asserting against the wrong document state. Closing is
       also the real flow.
 
       And the chip row gained it, which is the point: the hook owns the list,
       not the dialog, so the two cannot disagree about what exists. */
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Lehre' })).toBeInTheDocument();
  });

  it('renames one through PATCH', async () => {
    const dialog = await openManager();

    await userEvent.click(dialog.getByRole('button', { name: `${translations.renameCategory.en}: ${CATEGORY.name}` }));
    const field = dialog.getByLabelText(translations.renameCategory.en);
    await userEvent.clear(field);
    await userEvent.type(field, 'Projekte');
    await userEvent.click(dialog.getByRole('button', { name: translations.save.en }));

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/kb-user-categories/${CATEGORY.id}`),
      expect.objectContaining({ name: 'Projekte' }),
    );
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Projekte' })).toBeInTheDocument();
  });

  it('asks before deleting, and only then calls DELETE', async () => {
    const dialog = await openManager();

    await userEvent.click(dialog.getByRole('button', { name: `${translations.deleteCategory.en}: ${CATEGORY.name}` }));
    // The question is in the row itself — no second modal on top of this one.
    expect(dialog.getByText(translations.confirmDeleteCategory.en)).toBeInTheDocument();
    expect(mockedAxios.delete).not.toHaveBeenCalled();

    await userEvent.click(dialog.getByRole('button', { name: translations.delete.en }));

    expect(mockedAxios.delete).toHaveBeenCalledWith(
      expect.stringContaining(`/api/kb-user-categories/${CATEGORY.id}`),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: CATEGORY.name })).toBeNull();
    });
  });
});

describe('MyTopicsView filter chips', () => {
  const personal: KnowledgeBase = { ...baseKb, id: 'kb-p', name: 'Nur ich', myRole: 'owner', memberCount: 1 };
  const shared: KnowledgeBase = { ...baseKb, id: 'kb-s', name: 'Mit Team', myRole: 'owner', memberCount: 4 };

  function names(): string[] {
    return Array.from(document.querySelectorAll('.home-view__kb-name-btn')).map(el => el.textContent ?? '');
  }

  it('narrows to the chosen chip and clears on a second press', async () => {
    renderView(<MyTopicsView kbs={[personal, shared]} {...noopProps} />);
    await screen.findByText('Nur ich');
    expect(names()).toHaveLength(2);

    const personalChip = screen.getByRole('button', { name: translations.filterPersonal.en });
    await userEvent.click(personalChip);
    expect(names()).toEqual(['Nur ich']);

    /* The same chip again — not „Alle" — and the full list is back. This is the
       half that distinguishes a toggle from a plain radio row. */
    await userEvent.click(screen.getByRole('button', { name: translations.filterPersonal.en }));
    expect(names()).toHaveLength(2);
  });

  it('is a no-op to press Alle while it is already active', async () => {
    renderView(<MyTopicsView kbs={[personal, shared]} {...noopProps} />);
    await screen.findByText('Nur ich');

    await userEvent.click(screen.getByRole('button', { name: translations.filterAll.en }));
    expect(names()).toHaveLength(2);
  });
});

describe('MyTopicsView ordering', () => {
  const plain: KnowledgeBase = { ...baseKb, id: 'kb-plain', name: 'Zuletzt', myRole: 'owner', isFavourite: false };
  const starred: KnowledgeBase = { ...baseKb, id: 'kb-star', name: 'Zuerst', myRole: 'owner', isFavourite: true };

  function renderedOrder(): string[] {
    return Array.from(document.querySelectorAll('.home-view__kb-name-btn'))
      .map(el => el.textContent ?? '');
  }

  it('puts a favourite ahead of a topic given before it', async () => {
    renderView(<MyTopicsView kbs={[plain, starred]} {...noopProps} />);
    await screen.findByText('Zuletzt');

    expect(renderedOrder()).toEqual(['Zuerst', 'Zuletzt']);
  });

  it('leaves the order alone when nothing is starred', async () => {
    renderView(<MyTopicsView kbs={[plain, { ...starred, isFavourite: false }]} {...noopProps} />);
    await screen.findByText('Zuletzt');

    // The server's order is the only ordering promise the API makes, so an
    // all-or-nothing list must come through untouched.
    expect(renderedOrder()).toEqual(['Zuletzt', 'Zuerst']);
  });
});

describe('KB visibility badge', () => {
  it('shows "personal" for a private KB with only the owner', async () => {
    renderMyTopicsView({ kbs: [{ ...baseKb, id: 'kb-1', name: 'Meine KB', visibility: 'private', memberCount: 1, myRole: 'owner' }] });
    // The harness's `t` answers in English, so wait on the fixture's own name.
    await screen.findByText('Meine KB');
    expect(inCards().getByText(/persönlich|personal/i)).toBeInTheDocument();
  });

  it('shows the member count for a shared private KB', async () => {
    renderMyTopicsView({ kbs: [{ ...baseKb, id: 'kb-1', name: 'Team-KB', visibility: 'private', memberCount: 4, myRole: 'owner' }] });
    expect(await screen.findByText(/geteilt \(4\)|shared \(4\)/i)).toBeInTheDocument();
  });


});

// Task 10: the KB card's message chip and freshness line read the usage
// ledger's turnCount/lastActivityAt now, not the old messageCount/
// lastMessageAt pair the backend no longer sends.
describe('KB card turn chip and freshness line', () => {
  it('counts turns and reads lastActivityAt for the freshness line', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    renderMyTopicsView({
      kbs: [{
        ...baseKb, id: 'kb-1', name: 'Meine KB', memberCount: 1, myRole: 'owner',
        turnCount: 9, lastActivityAt: twoHoursAgo,
      }],
    });
    expect(await screen.findByText(translations.kbMessagesChip.en.replace('{n}', '9'))).toBeInTheDocument();
    // Assert the relative-time UNIT, not just the constant "Last active"
    // prefix: lastActiveLabel falls back to kb.createdAt (fixed at
    // baseKb's 2026-01-01, i.e. many months before "now") whenever
    // lastActivityAt isn't read, which would still satisfy a prefix-only
    // match. The fixture's lastActivityAt is 2 hours ago, so only the
    // real read renders an "hour" unit — the fallback renders "day(s)".
    expect(screen.getByText(new RegExp(`${translations.kbLastActive.en}.*hour`, 'i'))).toBeInTheDocument();
  });
});

