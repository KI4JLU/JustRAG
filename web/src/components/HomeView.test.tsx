import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider as DesignSystemThemeProvider } from '@ki4jlu/design-system';
import axios from 'axios';
import type { KnowledgeBase } from '../types';
import { HomeView, type HomeViewProps } from './HomeView';
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
// brings two Radix widgets to this suite that were not here before KI-776 —
// the sidebar's `SidebarUserMenu` dropdown and `AppShell`'s mobile drawer — so
// the same shim the admin suites use (AdminEvalTab.test.tsx:56) is needed here.
// It enables opening them with a click, nothing more.
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
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
  // The discovery panel fetches on mount; a bare auto-mocked axios.get
  // returns undefined and its .then() would throw. Individual describes
  // override this.
  mockedAxios.get.mockResolvedValue({ data: [] });
});

// expandSection clicks a section's disclosure trigger by its title. The
// accessible name also carries the item count (`SectionedGridLayout` renders it
// as a Badge inside the trigger), hence the substring match.
async function expandSection(title: string) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(title, 'i') }));
}

// The top-level jumps the chrome around HomeView reads off AppNavContext
// (three since KI-770, five since KI-783 added the „Geteilte Knowledge Bases"
// destination and the Overview row's own handler). Module-level spies: a fresh
// object per render would only add churn.
const NAV = {
  onViewHome: vi.fn(),
  onViewSharedKbs: vi.fn(),
  onViewProfile: vi.fn(),
  onViewAdmin: vi.fn(),
  onViewAgents: vi.fn(),
};

// Cleared per test since KI-776: two tests now assert CALL COUNTS on these, and
// a module-level spy that is never reset would carry one test's clicks into the
// next.
beforeEach(() => {
  NAV.onViewHome.mockClear();
  NAV.onViewSharedKbs.mockClear();
  NAV.onViewProfile.mockClear();
  NAV.onViewAdmin.mockClear();
  NAV.onViewAgents.mockClear();
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
  onUpdateKBSettings: vi.fn(),
  showSettings: false,
  setShowSettings: vi.fn(),
};

// RealRemovalHomeView wires onDeleteKB to the real useKbRemoval hook (rather
// than noopProps' vi.fn() stub) so tests can exercise the actual delete /
// leave / unsubscribe decision, including the real confirmation dialog —
// which needs a real ModalProvider underneath, not a mocked showConfirm.
function RealRemovalHomeView(props: { kbs: KnowledgeBase[]; globalKbs: KnowledgeBase[] } & Partial<HomeViewProps>) {
  const { removeKb, removing } = useKbRemoval();
  const onDeleteKB = async (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    await removeKb(kb);
  };
  const merged = { ...noopProps, ...props, onDeleteKB, removingKb: removing } as HomeViewProps;
  return <HomeView {...merged} />;
}

// Same providers as renderView, but with onDeleteKB wired to the real
// useKbRemoval hook: badge tests and real-removal-flow tests (subscriber
// unsubscribe) both go through it, and showConfirm's dialog actually renders
// because ModalProvider is real rather than mocked.
function renderHomeView(overrides: Partial<HomeViewProps> & { kbs?: KnowledgeBase[]; globalKbs?: KnowledgeBase[] } = {}) {
  const { kbs = [], globalKbs = [], ...rest } = overrides;
  return renderView(<RealRemovalHomeView kbs={kbs} globalKbs={globalKbs} {...rest} />);
}

/* ---------------------------------------------------------------------------
 * The shell KI-776 put this view on.
 *
 * `AppShellLayout` renders the sidebar twice — a sticky column from `lg` up and
 * a Radix Dialog drawer below it — from ONE node, and which of the two is
 * visible is pure CSS. jsdom applies no stylesheet, so this suite cannot make a
 * statement about the breakpoint; what it CAN check, and what a story in the
 * browser runner cannot (measured on this card: the story pipeline's dev-mode
 * Tailwind output emits `.lg:hidden` before `.flex`, so the top bar never hides
 * there either), is that the drawer is wired to THIS app's nav and user menu
 * rather than to an empty slot.
 *
 * ORACLES, both independent of the code under test: WAI-ARIA's `dialog` /
 * `navigation` / `button` role mappings as @testing-library implements them,
 * and src/translations.ts for every accessible name.
 * ------------------------------------------------------------------------- */
describe('HomeView app shell', () => {
  it('opens the mobile drawer with the same nav rows and user menu as the sidebar', async () => {
    authState.role = 'admin';
    renderView(<HomeView kbs={[]} {...noopProps} />);

    // Closed: one navigation landmark, the sticky sidebar's.
    expect(screen.getAllByRole('navigation')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: translations.openNavigation.en }));

    const drawer = within(await screen.findByRole('dialog'));
    // ORACLE: translations.ts. All three nav rows, including the admin one the
    // mocked system role above unlocks, plus the user-menu trigger — i.e. the
    // `nav` and `sidebarFooter` slots both reach the drawer copy.
    expect(drawer.getByRole('button', { name: translations.home.en })).toHaveAttribute('aria-current', 'page');
    /* ORACLE-LEVEL ADDITION (KI-783), not a locator change: the nav set itself
       grew by one row. `aria-current` must be on the Overview row and NOT on
       this one — the overview is the page being rendered — which is the half
       that a naive `active` wiring gets wrong. */
    expect(drawer.getByRole('button', { name: translations.sharedKbs.en })).not.toHaveAttribute('aria-current');
    expect(drawer.getByRole('button', { name: translations.myAgents.en })).toBeInTheDocument();
    /* ORACLE-LEVEL CHANGE (KI-782), not a locator change: „Admin settings" is
       no longer a nav row at all. It is a `DropdownMenuItem` inside the user
       menu, so it is absent from the nav slot in BOTH copies — which is the
       half of the move that a careless "add it to the menu" edit gets wrong by
       leaving the row behind and shipping the control twice. The menu itself
       is asserted in its own test below. */
    expect(drawer.queryByRole('button', { name: translations.adminSettings.en })).toBeNull();
    expect(drawer.getByRole('button', { name: /^@grace/ })).toBeInTheDocument();
  });

  /* KI-788, and it is a LIMITATION being recorded rather than a feature.
   *
   * The colour-scheme switch carries `id="theme-toggle"` so the tour — or any
   * script outside React — can address it. An id is a document-level promise,
   * and `AppShell` renders the SAME sidebar node twice: the sticky desktop
   * column, plus the drawer copy while the drawer is open. Nothing in
   * `AppChrome` can tell the two mounts apart, because the design system keeps
   * `SidebarSurfaceContext` private and exports only `useSidebarCollapsed`.
   *
   * So: unique in every closed-drawer state (which is every desktop state and
   * the mobile default — asserted on the real route in
   * `App.authenticated-home.test.tsx`), and duplicated while the drawer is
   * open, with `getElementById` returning the desktop copy that is
   * `display:none` at that breakpoint. That is pinned here rather than left to
   * be discovered: if the design system grows a way to de-duplicate, this test
   * turns red and the limitation is re-read instead of forgotten.
   *
   * ORACLES: the DOM's id semantics and WAI-ARIA's dialog role mapping — both
   * jsdom's, neither this repo's. */
  it('duplicates the theme toggle id while the mobile drawer is open', async () => {
    renderView(<HomeView kbs={[]} {...noopProps} />);

    // Closed: the promise holds.
    expect(document.querySelectorAll('#theme-toggle')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: translations.openNavigation.en }));
    await screen.findByRole('dialog');

    // Open: two mounts of one node, hence two elements under one id.
    expect(document.querySelectorAll('#theme-toggle')).toHaveLength(2);
    // And the one an external script would get is the desktop column's.
    expect(document.getElementById('theme-toggle')).toBe(
      document.querySelectorAll('#theme-toggle')[0],
    );
  });

  /* ---------------------------------------------------------------------
   * The minimise toggle, and the mobile drawer's relationship to it (KI-789).
   *
   * WHAT THIS FILE CAN SAY, AND WHAT IT DELIBERATELY CANNOT. jsdom applies no
   * stylesheet, so nothing here is a statement about width or about text being
   * painted — `AppShellCollapsed` in `HomeView.stories.tsx` measures those in
   * Chromium. What jsdom CAN see is the DOM contract, and the two facts below
   * are exactly that:
   *
   *  1. EVERY NAV ROW KEEPS AN ACCESSIBLE NAME, and it is now an `aria-label`
   *     rather than the visible text. This is the a11y risk of the whole
   *     feature, and it has a silent failure mode in both directions:
   *     `NavItem` collapses only a row it was given a `label` for, so a row
   *     missing one keeps rendering full width next to collapsed neighbours
   *     (no error, no warning, no type failure); and a row that collapsed
   *     without one would lose its name entirely. Asserting the `aria-label`
   *     — not merely that the name resolves — is what distinguishes the
   *     collapsed row from a row that quietly declined to collapse. All three
   *     rows, hence the admin fixture.
   *
   *  2. THE MOBILE DRAWER IS UNAFFECTED, which is the known-risk half.
   *     `AppShell` renders ONE sidebar node twice, and the drawer copy
   *     suppresses both the toggle and the collapsed width by design (its
   *     `SidebarSurfaceContext`), so a user who minimised the column on the
   *     desktop must still get a full-width, toggle-less drawer on mobile. The
   *     `#theme-toggle` duplication recorded in the test above is also checked
   *     to be unchanged at exactly two — collapsing must not add a third
   *     element under that id.
   *
   * ORACLES: `src/translations.ts` for every name, and WAI-ARIA's button /
   * dialog role mappings plus the DOM's id semantics as jsdom implements them.
   * Neither is derived from this repo's components.
   * ------------------------------------------------------------------- */
  it('collapses the sidebar without taking a name off any nav row', async () => {
    authState.role = 'admin';
    renderView(<HomeView kbs={[]} {...noopProps} />);

    const nav = within(screen.getByRole('navigation', { name: translations.mainNavigation.en }));
    const ROWS = [translations.home.en, translations.sharedKbs.en, translations.myAgents.en];

    // Expanded: the visible text IS the name, so there is no aria-label to
    // override it (and none to drift from it).
    for (const name of ROWS) {
      expect(nav.getByRole('button', { name })).not.toHaveAttribute('aria-label');
    }

    await userEvent.click(screen.getByRole('button', { name: translations.collapseNavigation.en }));

    // Collapsed: same three names, now carried by aria-label. A row that had
    // refused to collapse would still resolve by name and would fail here.
    for (const name of ROWS) {
      expect(nav.getByRole('button', { name })).toHaveAttribute('aria-label', name);
    }

    // The user menu is the only route to sign-out, so it has to survive too.
    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByRole('menuitem', { name: translations.logout.en })).toBeInTheDocument();
  });

  it('leaves the mobile drawer full width and toggle-less while the sidebar is minimised', async () => {
    authState.role = 'admin';
    renderView(<HomeView kbs={[]} {...noopProps} />);

    await userEvent.click(screen.getByRole('button', { name: translations.collapseNavigation.en }));
    // One toggle while the drawer is closed: the desktop column's.
    expect(screen.getAllByRole('button', { name: translations.expandNavigation.en })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: translations.openNavigation.en }));
    const drawer = within(await screen.findByRole('dialog'));

    // The drawer copy carries NO toggle, in either direction — a minimise
    // control inside a full-height modal would have nothing to minimise.
    expect(drawer.queryByRole('button', { name: translations.expandNavigation.en })).toBeNull();
    expect(drawer.queryByRole('button', { name: translations.collapseNavigation.en })).toBeNull();

    // And its rows are the EXPANDED form: no aria-label, i.e. the visible text
    // is still their name — while the desktop copy behind it stays collapsed.
    for (const name of [translations.home.en, translations.sharedKbs.en, translations.myAgents.en]) {
      expect(drawer.getByRole('button', { name })).not.toHaveAttribute('aria-label');
    }

    // The known `#theme-toggle` duplication is unchanged at two mounts —
    // collapsing neither removes the desktop copy nor adds a third.
    expect(document.querySelectorAll('#theme-toggle')).toHaveLength(2);
  });

  it('routes the sidebar nav rows to the AppNavContext jumps', async () => {
    authState.role = 'admin';
    renderView(<HomeView kbs={[]} {...noopProps} />);

    // ORACLE: the module-level spies in NAV. The sidebar copy is the first in
    // the document, so an unscoped query reaches it while the drawer is closed.
    await userEvent.click(screen.getByRole('button', { name: translations.myAgents.en }));
    expect(NAV.onViewAgents).toHaveBeenCalledTimes(1);

    /* KI-783's new destination, asserted the same way: the row has to reach
       the jump, not merely exist. This is what makes „the sidebar row has a
       destination" a fact rather than a claim — the row and the view were
       added by one card precisely so this could be checked in one place. */
    await userEvent.click(screen.getByRole('button', { name: translations.sharedKbs.en }));
    expect(NAV.onViewSharedKbs).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: translations.home.en }));
    expect(NAV.onViewHome).toHaveBeenCalledTimes(1);
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
  it('hides the agents row and the admin entry from a non-admin', async () => {
    authState.role = 'user';
    renderView(<HomeView kbs={[]} {...noopProps} />);

    // The two unconditional rows are still there, so a failure here says
    // "the gate ate the wrong row" rather than "the nav did not render".
    expect(screen.getByRole('button', { name: translations.home.en })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: translations.sharedKbs.en })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: translations.myAgents.en })).toBeNull();

    // And the admin entry is absent from its NEW home as well, i.e. the move
    // did not lose the gate on the way into the dropdown.
    await userEvent.click(screen.getByRole('button', { name: /^@grace/ }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.queryByRole('menuitem', { name: translations.adminSettings.en })).toBeNull();
    expect(menu.getByRole('menuitem', { name: translations.profile.en })).toBeInTheDocument();
  });

  it('offers the admin entry in the user menu for an admin, and it routes', async () => {
    authState.role = 'admin';
    renderView(<HomeView kbs={[]} {...noopProps} />);

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
describe('HomeView members-dialog trigger', () => {
  it('shows the trigger for a caller whose myRole is admin', async () => {
    const kb: KnowledgeBase = { ...baseKb, myRole: 'admin' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.getByRole('button', { name: translations.share.en })).toBeInTheDocument();
  });

  it('shows the trigger for a caller whose myRole is owner', () => {
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    expect(screen.getByRole('button', { name: translations.share.en })).toBeInTheDocument();
  });

  it('hides the trigger for a caller whose myRole is edit', async () => {
    const kb: KnowledgeBase = { ...baseKb, myRole: 'edit' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.queryByRole('button', { name: translations.share.en })).not.toBeInTheDocument();
  });

  it('hides the trigger for a caller whose myRole is view', async () => {
    const kb: KnowledgeBase = { ...baseKb, myRole: 'view' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.queryByRole('button', { name: translations.share.en })).not.toBeInTheDocument();
  });
});

// KbSettingsPanel (RAG settings / evals / workflow) is the KB "advanced
// settings" surface, and its endpoints sit on kbAdvancedChain: a system role in
// {api-user, admin, superadmin} AND KB role admin or better. The trigger must
// therefore be hidden in exactly the cases the server refuses — both terms, not
// the members button's KB-role-only gate, which is what it wrongly shared
// before. The share button beside it deliberately keeps that looser gate, and
// the last case here pins the two apart.
describe('HomeView KB-settings trigger', () => {
  const label = translations.kbAdvancedSettings.en;

  it('hides the trigger from a plain user who OWNS the KB', async () => {
    authState.role = 'user';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  });

  it('still offers the plain owner the members dialog — only the advanced surface is gated', () => {
    authState.role = 'user';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    expect(screen.getByRole('button', { name: translations.share.en })).toBeInTheDocument();
  });

  it('shows the trigger for an api-user who owns the KB, and hands the KB to the callback', async () => {
    authState.role = 'api-user';
    const onOpenKbSettings = vi.fn();
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<HomeView kbs={[kb]} {...noopProps} onOpenKbSettings={onOpenKbSettings} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(onOpenKbSettings).toHaveBeenCalledWith(kb, expect.anything());
  });

  it('shows the trigger for a system admin who is KB admin but not owner', async () => {
    authState.role = 'admin';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'admin' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('shows the trigger for a superadmin', () => {
    authState.role = 'superadmin';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('hides the trigger from an api-user who is only an editor — the KB role still counts', async () => {
    authState.role = 'api-user';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'edit' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  });
});

// Renaming is owner-only on a private KB (kbaccess.CanRename on the server;
// canRenameKb here). The pencil must not appear on a shared card whose caller
// is a mere admin member — that role edits everything else, not the name.
describe('HomeView rename trigger', () => {
  const label = translations.renameKb.en;

  it('shows the pencil to the owner and hands the KB to onRenameKB', async () => {
    authState.role = 'user';
    const onRenameKB = vi.fn();
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<HomeView kbs={[kb]} {...noopProps} onRenameKB={onRenameKB} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(onRenameKB).toHaveBeenCalledWith(kb, expect.anything());
  });

  it('does not open the KB when the pencil is clicked', async () => {
    authState.role = 'user';
    const onSelectKB = vi.fn();
    const kb: KnowledgeBase = { ...baseKb, myRole: 'owner' };
    renderView(<HomeView kbs={[kb]} {...noopProps} onSelectKB={onSelectKB} onRenameKB={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(onSelectKB).not.toHaveBeenCalled();
  });

  it.each(['admin', 'edit', 'view'] as const)('hides the pencil from a %s member', async (role) => {
    authState.role = 'user';
    const kb: KnowledgeBase = { ...baseKb, myRole: role };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  });

  it('hides the pencil from a system admin who is only an admin member of a private KB', async () => {
    authState.role = 'admin';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'admin' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  });

  it('shows the pencil to a superadmin on a shared private KB', async () => {
    authState.role = 'superadmin';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'admin' };
    renderView(<HomeView kbs={[kb]} {...noopProps} />);
    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });
});

// The overview splits GET /api/kb into "mine" and "shared with me" on myRole
// alone — the backend returns one list, and both sections render the same
// card, so the partition is the only thing keeping a KB out of the wrong
// section.
describe('HomeView owned/shared split', () => {
  const owned: KnowledgeBase = { ...baseKb, id: 'kb-own', name: 'Owned KB', myRole: 'owner' };
  const shared: KnowledgeBase = { ...baseKb, id: 'kb-shared', name: 'Shared KB', myRole: 'edit' };

  it('puts an owned KB in the always-open "my KBs" section and a shared one behind the collapsed section', async () => {
    renderView(<HomeView kbs={[owned, shared]} {...noopProps} />);

    // "Meine KBs" is open by default, "Mit mir geteilt" is not.
    expect(screen.getByText('Owned KB')).toBeInTheDocument();
    expect(screen.queryByText('Shared KB')).not.toBeInTheDocument();

    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.getByText('Shared KB')).toBeInTheDocument();
  });

  // Also the guard on the storage stub above: if localStorage were inert (as
  // it is in some jsdom builds), the second render would fall back to
  // defaultOpen and this would fail — which is what stops the rest of the
  // file from silently not exercising persistence at all.
  it('remembers a section it was told to expand across a remount', async () => {
    const { unmount } = renderView(<HomeView kbs={[owned, shared]} {...noopProps} />);
    await expandSection(translations.homeSharedWithMe.en);
    expect(screen.getByText('Shared KB')).toBeInTheDocument();
    unmount();

    renderView(<HomeView kbs={[owned, shared]} {...noopProps} />);
    expect(screen.getByText('Shared KB')).toBeInTheDocument();
  });

  it('reports the per-section counts on the headers', () => {
    renderView(<HomeView kbs={[owned, shared]} {...noopProps} />);
    expect(screen.getByRole('button', { name: new RegExp(`${translations.myKBs.en}\\s*1`, 'i') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`${translations.homeSharedWithMe.en}\\s*1`, 'i') })).toBeInTheDocument();
  });
});

// auto_subscribe defaults to false (Phase 2): a newly published global KB
// shows up in the catalog but not in anyone's overview until they subscribe,
// so "globalKbs: []" is the default state for every new user, not an edge
// case. The Discover trigger must therefore be reachable from the
// globalKbs.length === 0 branch too, for every authenticated user — not just
// admins (the mocked useAuth user above has role: 'user').
describe('HomeView discovery accordion', () => {
  // The only test in this file that actually mounts KbCatalogPanel, which
  // calls useToast — hence the provider here rather than around every render.
  it('offers discovery to a non-admin with no favorites, and mounts the catalog only once expanded', async () => {
    renderView(<HomeView kbs={[]} {...noopProps} globalKbs={[]} />);

    // Collapsed: the panel is unmounted, so it has not fetched anything yet.
    expect(mockedAxios.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/kb/catalog'));

    await expandSection(translations.discoverKbs.en);

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('/api/kb/catalog'));
    });
  });

  it('does not gate discovery behind admin/superadmin', () => {
    // Spelled out against the admin-gated create-KB button in the same
    // section, to pin the distinction: create stays admin-only, discover
    // does not (the mocked useAuth user has role: 'user').
    renderView(<HomeView kbs={[]} {...noopProps} globalKbs={[]} />);
    expect(screen.getByRole('button', { name: new RegExp(translations.discoverKbs.en, 'i') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: translations.createGlobalKB.en })).not.toBeInTheDocument();
  });

  it('shows exactly one discovery header when the caller already has favorites', () => {
    const globalKb: KnowledgeBase = { ...baseKb, id: 'gkb-1', isGlobal: true };
    renderView(<HomeView kbs={[]} {...noopProps} globalKbs={[globalKb]} />);
    expect(screen.getAllByRole('button', { name: new RegExp(translations.discoverKbs.en, 'i') })).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------------------
 * The catalog search in the chrome bar (card KI-787).
 *
 * WHAT THE CARD ACTUALLY ASKED FOR: a MOVE. The field that used to sit inside
 * „KBs entdecken" is now the shell's top bar, and the bar's page label is gone
 * — so „there is exactly one of it" is as much of the requirement as „it
 * works", and every test below has a negative half for that reason.
 *
 * ORACLES, none of them restating a constant the components also read:
 *  - `translations.ts` for the accessible name and the section title. The test
 *    reads the table; the components look the key up. A renamed key fails
 *    both, a re-worded string fails neither — which is correct, the wording is
 *    not what is under test.
 *  - the rendered DOM for „how many search fields exist" and „is the section's
 *    body mounted": `getAllByLabelText(...).length` and the presence of the
 *    catalog's own nodes, counted off the document rather than off any value
 *    the component reports about itself.
 *  - `mockedAxios.get`'s recorded URLs for „the keystroke reached the fetch".
 *    The request is the panel's observable output and the URL is assembled
 *    from the query — a component that rendered the letters but never searched
 *    fails here and nowhere else.
 *  - WAI-ARIA's `h1` -> heading mapping for the page title that STAYS, against
 *    `getAllByText` for the label that GOES. Those two together are what
 *    „removed the duplicate, kept the real one" means; asserting only the
 *    absence would also pass if the page had lost its heading entirely.
 * ------------------------------------------------------------------------ */
describe('HomeView chrome search (KI-787)', () => {
  // The file's outer beforeEach re-arms `axios.get` but does not clear its
  // call log, and two tests below assert that the catalog was NOT fetched
  // yet — an assertion the preceding test's calls would answer for them.
  beforeEach(() => { mockedAxios.get.mockClear(); });

  it('renders exactly one catalog search field, and it is not inside the discovery section', async () => {
    renderView(<HomeView kbs={[]} {...noopProps} globalKbs={[]} />);

    // Collapsed section, and the field is already there: it cannot be the
    // panel's, because the panel is not mounted.
    expect(screen.getAllByLabelText(translations.catalogSearchPlaceholder.en)).toHaveLength(1);

    await expandSection(translations.discoverKbs.en);
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('/api/kb/catalog'));
    });

    // Expanding it did NOT add a second one — the panel kept none of its own.
    expect(screen.getAllByLabelText(translations.catalogSearchPlaceholder.en)).toHaveLength(1);
  });

  it('expands the collapsed discovery section when the header field is typed into, and searches', async () => {
    renderView(<HomeView kbs={[]} {...noopProps} globalKbs={[]} />);

    // The section starts closed (useSectionOpen('discover', false)) and its
    // body is unmounted, so nothing has been fetched.
    expect(mockedAxios.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/kb/catalog'));

    await userEvent.type(screen.getByLabelText(translations.catalogSearchPlaceholder.en), 'Recht');

    // ORACLE: the request URL. Reaching it at all proves the section expanded,
    // because the component that fires it only exists while it is open.
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('q=Recht'));
    });

    // And the disclosure really is open, not just mounted: the trigger says so.
    expect(screen.getByRole('button', { name: new RegExp(translations.discoverKbs.en, 'i') }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves a closed section closed when the query is cleared back to empty', async () => {
    renderView(<HomeView kbs={[]} {...noopProps} globalKbs={[]} />);

    const field = screen.getByLabelText(translations.catalogSearchPlaceholder.en);
    await userEvent.type(field, 'x');
    expect(screen.getByRole('button', { name: new RegExp(translations.discoverKbs.en, 'i') }))
      .toHaveAttribute('aria-expanded', 'true');

    // Clearing is not a request to open anything, so the section the user
    // closes afterwards stays closed — the field must not re-open it.
    await userEvent.click(screen.getByRole('button', { name: new RegExp(translations.discoverKbs.en, 'i') }));
    await userEvent.clear(field);
    expect(screen.getByRole('button', { name: new RegExp(translations.discoverKbs.en, 'i') }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the page title once — as the content template\'s h1, with no chrome label repeating it', async () => {
    renderView(<HomeView kbs={[]} {...noopProps} globalKbs={[]} />);

    // The heading stays: it is the page's own, owned by SectionedGridLayout.
    expect(await screen.findByRole('heading', { level: 1, name: translations.myKBs.en })).toBeInTheDocument();

    /* And nothing else says it in the chrome. The design system is explicit
       that `pageLabel` is a `<p>` and never a heading, so „the bar's label is
       gone" is exactly „no <p> carries these words" — the same locator
       `AppShellGeometry` uses to find the bar in Chromium. Counting ALL
       elements with the text would be wrong rather than stricter: the „Meine
       KBs" SECTION header legitimately repeats it one level down, and did
       before this card too. */
    const asParagraph = screen.getAllByText(translations.myKBs.en).filter(el => el.tagName === 'P');
    expect(asParagraph).toEqual([]);
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
describe('KB visibility badge', () => {
  it('shows "personal" for a private KB with only the owner', async () => {
    renderHomeView({ kbs: [{ ...baseKb, id: 'kb-1', name: 'Meine KB', visibility: 'private', memberCount: 1, myRole: 'owner' }] });
    expect(await screen.findByText(/persönlich|personal/i)).toBeInTheDocument();
  });

  it('shows the member count for a shared private KB', async () => {
    renderHomeView({ kbs: [{ ...baseKb, id: 'kb-1', name: 'Team-KB', visibility: 'private', memberCount: 4, myRole: 'owner' }] });
    expect(await screen.findByText(/geteilt \(4\)|shared \(4\)/i)).toBeInTheDocument();
  });

  it('shows "public" on a public KB card, regardless of member count', async () => {
    renderHomeView({
      globalKbs: [{ ...baseKb, id: 'gkb-1', name: 'Katalog-KB', visibility: 'public', isPublished: true, memberCount: 1 }],
    });
    expect(await screen.findByText(/öffentlich|public/i)).toBeInTheDocument();
  });

  // Vor dem Fix trug die oeffentliche Karte einen eigenen statischen
  // "Global"-Chip, waehrend der 'public'-Zweig des Badges unerreichbar war.
  it('renders the shared badge, not the old static global chip, on a public KB card', async () => {
    renderHomeView({
      globalKbs: [{ ...baseKb, id: 'gkb-1', name: 'Katalog-KB', visibility: 'public', isPublished: true }],
    });
    expect(await screen.findByText(translations.visibilityPublic.en)).toBeInTheDocument();
    expect(screen.queryByText(translations.globalBadge.en)).not.toBeInTheDocument();
  });
});

// Task 10: the KB card's message chip and freshness line read the usage
// ledger's turnCount/lastActivityAt now, not the old messageCount/
// lastMessageAt pair the backend no longer sends.
describe('KB card turn chip and freshness line', () => {
  it('counts turns and reads lastActivityAt for the freshness line', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    renderHomeView({
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

// The star on a Favoriten card is a favorites toggle and nothing else. It
// must never drop a membership or delete chats — not for a plain subscriber
// and not for a curator who happens to hold a kb_members row on the same
// public KB — and the confirmation has to say so, including that the KB stays
// findable under "KBs entdecken".
describe('remove action on a Favoriten card', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.delete.mockReset();
  });

  it('unsubscribes instead of leaving, and does not warn about chats', async () => {
    mockedAxios.delete.mockResolvedValue({ status: 204 });

    renderHomeView({
      globalKbs: [{ ...baseKb, id: 'kb-1', name: 'Katalog-KB', visibility: 'public', isPublished: true }],
    });

    await userEvent.click(await screen.findByRole('button', { name: translations.removeFromFavorites.en }));

    // Wait for the confirmation dialog to actually mount before asserting on
    // its content.
    const dialog = await screen.findByRole('dialog');

    // Die Zusage im Dialog: Chats bleiben, die KB bleibt auffindbar. (Auf
    // "Discover KBs" muss im Dialog geprueft werden — der Accordion-Header
    // traegt denselben Text.)
    expect(dialog).toHaveTextContent(/your chats are kept/i);
    expect(dialog).toHaveTextContent(/discover kbs/i);
    await userEvent.click(screen.getByRole('button', { name: /bestätigen|confirm/i }));

    await waitFor(() => {
      expect(mockedAxios.delete).toHaveBeenCalledWith(
        expect.stringContaining('/api/kb/kb-1/subscription')
      );
    });
    expect(mockedAxios.delete).not.toHaveBeenCalledWith(
      expect.stringContaining('/membership')
    );
  });

  // Der Regressionsfall: derselbe Klick lief fuer einen Kurator frueher in
  // den Leave-Zweig und nahm dessen Chats mit.
  it('does not leave the KB when the caller is a curator (myRole=admin)', async () => {
    mockedAxios.delete.mockResolvedValue({ status: 204 });

    renderHomeView({
      globalKbs: [{ ...baseKb, id: 'kb-1', name: 'Katalog-KB', visibility: 'public', isPublished: true, myRole: 'admin' }],
    });

    await userEvent.click(await screen.findByRole('button', { name: translations.removeFromFavorites.en }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /bestätigen|confirm/i }));

    await waitFor(() => {
      expect(mockedAxios.delete).toHaveBeenCalledWith(
        expect.stringContaining('/api/kb/kb-1/subscription')
      );
    });
    expect(mockedAxios.delete).not.toHaveBeenCalledWith(expect.stringContaining('/membership'));
    // Kein /membership/impact-Lookup: es gibt nichts abzuwaegen.
    expect(mockedAxios.get).not.toHaveBeenCalledWith(expect.stringContaining('/membership/impact'));
  });
});
