import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubViewport } from '../test/viewport';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider as DesignSystemThemeProvider } from '@ki4jlu/design-system';
import axios from 'axios';
import type { KnowledgeBase } from '../types';
import { SharedTopicsView } from './SharedTopicsView';
import { translations } from '../translations';
import { ModalProvider } from '../contexts/ModalContext';
import { ToastProvider } from '../contexts/ToastContext';
import { AppNavProvider } from '../contexts/AppNavContext';
import { SharingProvider } from '../contexts/SharingContext';
import { KbSearchProvider } from '../contexts/KbSearchContext';
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

/* `RealRemovalSharedTopicsView` / `renderSharedTopicsView` stood here — the
   harness that wired `onDeleteKB` to the real `useKbRemoval` hook. Its only
   callers were the two public-card tests deleted above; every case left in this
   file renders through `renderView` with the noop props. */


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
/* ---------------------------------------------------------------------------
 * `SharedTopicsView` — „Geteiltes Wissen" (18.09.2026).
 *
 * WHERE THESE CASES CAME FROM. All of them were in `HomeView.test.tsx` and
 * rendered the overview's „Mit mir geteilt" section. They moved here with the
 * list itself: the overview no longer renders a shared or a global topic at
 * all, so on `MyTopicsView` every one of them asserted against an empty page
 * and passed for the wrong reason.
 *
 * ONE DELIBERATE EDIT during the move: the `expandSection('Mit mir geteilt')`
 * call is gone from each. Both sections are open on first visit here — a user
 * who navigated to this page asked for both lists — so clicking the trigger
 * would CLOSE the section and hide the card the assertion is looking for.
 * ------------------------------------------------------------------------- */


/* ---------------------------------------------------------------------------
 * „Thema hinzufügen" — the tile, which NAVIGATES rather than creating.
 *
 * WHAT IT REPLACED, because the distinction is the whole point: a „Wissen
 * teilen" tile sat here first, with a picker and a hand-off to the sharing
 * flow. All three of its tests passed and the feature was still wrong — sharing
 * a topic you own puts it in somebody ELSE's „Geteiltes Wissen", so nothing
 * reachable from this page ever added a row to it. Those tests are gone with
 * it. This one asserts the property that made the replacement acceptable: the
 * tile makes no claim about this page's list, it just leaves for the catalog.
 *
 * ORACLE: the `onViewDiscover` spy in this file's `NAV`, i.e. the callback
 * `AppNavProvider` hands down — the view cannot reach it or fake it, and it is
 * the identical handler the „Entdecken" nav row uses.
 * ------------------------------------------------------------------------- */
describe('SharedTopicsView add-topic tile', () => {
  it('sends the user to Entdecken, and changes nothing on this page', async () => {
    const shared: KnowledgeBase = { ...baseKb, id: 'kb-shared', myRole: 'edit' };
    renderView(<SharedTopicsView kbs={[shared]} {...noopProps} />);

    await userEvent.click(screen.getByRole('button', { name: translations.addTopic.en }));

    expect(NAV.onViewDiscover).toHaveBeenCalledTimes(1);
    // It is a jump, not a mutation: no dialog, and the list is untouched.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is the whole of the page when nothing is shared yet', () => {
    renderView(<SharedTopicsView kbs={[]} {...noopProps} />);

    /* The tile IS the empty state (a placeholder above it was removed as a
       restatement of it), so this is the assertion that an empty page is not a
       blank one. */
    expect(screen.getByRole('button', { name: translations.addTopic.en })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Knowledge Base öffnen/ })).toBeNull();
  });
});

describe('SharedTopicsView card actions', () => {
  /* Two labels, because these cases came from two different describes in the
     old file and each had its own `label`: the settings gate is the advanced
     panel, the pencil is rename. Collapsing them to one const made the pencil
     cases assert against the wrong control. */
  const label = translations.kbAdvancedSettings.en;
  const renameLabel = translations.renameKb.en;
  it('shows the trigger for a caller whose myRole is admin', async () => {
    const kb: KnowledgeBase = { ...baseKb, myRole: 'admin' };
    renderView(<SharedTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.getByRole('button', { name: translations.share.en })).toBeInTheDocument();
  });

  it('hides the trigger for a caller whose myRole is edit', async () => {
    const kb: KnowledgeBase = { ...baseKb, myRole: 'edit' };
    renderView(<SharedTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.queryByRole('button', { name: translations.share.en })).not.toBeInTheDocument();
  });

  it('hides the trigger for a caller whose myRole is view', async () => {
    const kb: KnowledgeBase = { ...baseKb, myRole: 'view' };
    renderView(<SharedTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.queryByRole('button', { name: translations.share.en })).not.toBeInTheDocument();
  });

  it('shows the trigger for a system admin who is KB admin but not owner', async () => {
    authState.role = 'admin';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'admin' };
    renderView(<SharedTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('hides the trigger from an api-user who is only an editor — the KB role still counts', async () => {
    authState.role = 'api-user';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'edit' };
    renderView(<SharedTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.queryByRole('button', { name: renameLabel })).not.toBeInTheDocument();
  });

  it('hides the pencil from a system admin who is only an admin member of a private KB', async () => {
    authState.role = 'admin';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'admin' };
    renderView(<SharedTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.queryByRole('button', { name: renameLabel })).not.toBeInTheDocument();
  });

  it('shows the pencil to a superadmin on a shared private KB', async () => {
    authState.role = 'superadmin';
    const kb: KnowledgeBase = { ...baseKb, myRole: 'admin' };
    renderView(<SharedTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.getByRole('button', { name: renameLabel })).toBeInTheDocument();
  });

  /* Two tests stood here and are deleted (18.09.2026): „shows public on a
     public KB card" and „renders the shared badge, not the old static global
     chip". Both rendered a `globalKbs` fixture through `PublicKbCard` — a
     component no view mounts any more, because global topics moved to
     „Entdecken", which draws them with the catalog's own card. The badge logic
     they pinned lives on in `visibilityBadge`; what they asserted it through
     does not. */

  it.each(['admin', 'edit', 'view'] as const)('hides the pencil from a %s member', async (role) => {
    authState.role = 'user';
    const kb: KnowledgeBase = { ...baseKb, myRole: role };
    renderView(<SharedTopicsView kbs={[kb]} {...noopProps} />);
    expect(screen.queryByRole('button', { name: renameLabel })).not.toBeInTheDocument();
  });


});
