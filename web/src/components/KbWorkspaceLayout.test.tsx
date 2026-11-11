import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppShellLayoutProps } from '@ki4jlu/design-system';
import { KbWorkspaceLayout } from './KbWorkspaceLayout';

/* ---------------------------------------------------------------------------
 * What this file can and cannot assert, after the move to `AppShellLayout`.
 *
 * `KbWorkspaceLayout` no longer BUILDS a three-column frame — it hands one to
 * the design system and injects content plus controlled state. So the thing
 * under test is the wiring, and the honest way to read it is to capture what
 * the shell is handed. `AppShellLayout` is therefore replaced by a stub that
 * records its props and renders the three areas unconditionally; everything
 * else in `@ki4jlu/design-system` stays real (`importOriginal`), so `Logo` and
 * `Button` are the shipped components.
 *
 * THE ORACLE IS NOT THIS COMPONENT'S OUTPUT. The left and right sidebar mocks
 * below carry DELIBERATELY DIFFERENT numbers (320 vs 500) and opposite open
 * states, so a wiring that reads the left state into the right column — the
 * mistake this file is here to catch — comes out red rather than plausible.
 * The arrangement itself (which column is where, how it collapses, what the
 * rail looks like) is the design system's own contract and is measured in its
 * repo, not re-asserted here against a stub that cannot perform layout.
 * ------------------------------------------------------------------------- */
let shellProps: Partial<AppShellLayoutProps> = {};

vi.mock('@ki4jlu/design-system', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    AppShellLayout: (props: AppShellLayoutProps) => {
      shellProps = props;
      return (
        <div data-testid="app-shell">
          <div data-testid="shell-nav">{props.nav}</div>
          <div data-testid="shell-main">{props.children}</div>
          {/* Wie die echte Shell: `showRight={false}` nimmt die Spalte aus der
              Desktop-Anordnung; der Stub kennt nur diese Anordnung. */}
          {props.rightPanel && props.showRight !== false && (
            <div data-testid="shell-right">{props.rightPanel.content}</div>
          )}
        </div>
      );
    },
  };
});

vi.mock('./sources/SourcesPanel', () => ({ SourcesPanel: () => <div data-testid="sources-panel" /> }));
vi.mock('./history/HistoryPanel', () => ({ HistoryPanel: () => <div data-testid="history-panel" /> }));
vi.mock('./ChatView', () => ({ ChatView: () => <div data-testid="chat-view" /> }));
// The search reads four contexts of its own; its behaviour is
// App.authenticated-workspace-search.test.tsx's subject, not this file's.
vi.mock('./WorkspaceSearch', () => ({ WorkspaceSearch: () => <div data-testid="workspace-search" /> }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
// The history buttons read the router; their subject is the desktop title bar.
vi.mock('./HistoryControls', () => ({ HistoryControls: () => null }));
// Reads the chat context; its own test covers it.
vi.mock('./DesktopMenuCommands', () => ({ DesktopMenuCommands: () => null }));
const navigateTo = vi.fn();
vi.mock('../routing/navigation', () => ({ useAppNavigate: () => navigateTo }));
// What the gear is told about the topic's settings; the diff itself is
// topicSettingsDiff.test.ts's subject.
let settingsDiff = { isCustomized: false, changedKeys: [] as string[], labels: [] as string[], count: 0 };
const useTopicSettingsDiff = vi.fn<(...args: unknown[]) => typeof settingsDiff>(() => settingsDiff);
vi.mock('../hooks/useTopicSettingsDiff', () => ({
  useTopicSettingsDiff: (...args: unknown[]) => useTopicSettingsDiff(...args),
}));
// Wer schaut: Standard ist ein fremder Nutzer ohne KB-Rolle. Tests, die den
// Eigentümer oder einen KB-Admin brauchen, setzen `authUser` / `kbExtra` um.
let authUser: { id?: string; role: string } = { role: 'user' };
let kbExtra: Record<string, unknown> = {};
let siteConfigs: Record<string, string> = {};
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: authUser, siteConfigs }) }));

const handleGoHome = vi.fn();
let kbView = 'chat';
const setKbView = vi.fn();

vi.mock('../contexts/KbCoreContext', () => ({
  useKbCore: () => ({
    currentKb: { id: 'kb1', name: 'TEST', ...kbExtra },
    kbView,
    setKbView,
    handleGoHome,
    kbMgmt: { handleRenameKB: vi.fn() },
  }),
}));

const setIsLeftSidebarOpen = vi.fn();
const setIsRightSidebarOpen = vi.fn();
const setLeftSidebarWidth = vi.fn();
const setRightSidebarWidth = vi.fn();
const setSystemPromptOpen = vi.fn();

// Links/Rechts bewusst UNTERSCHIEDLICH: eine Verdrahtung, die den linken
// Zustand in die rechte Spalte schreibt, wird daran rot statt plausibel.
vi.mock('../contexts/KbLayoutContext', () => ({
  useKbLayout: () => ({
    sidebar: {
      isLeftSidebarOpen: true, isRightSidebarOpen: false,
      leftSidebarWidth: 320, rightSidebarWidth: 500,
      setIsLeftSidebarOpen, setIsRightSidebarOpen,
      setLeftSidebarWidth, setRightSidebarWidth,
    },
    systemPromptOpen: false,
    setSystemPromptOpen,
  }),
}));

const noSwipe = { onTouchStart: vi.fn(), onTouchEnd: vi.fn() };

beforeEach(() => {
  shellProps = {};
  kbView = 'chat';
  authUser = { role: 'user' };
  siteConfigs = {};
  kbExtra = {};
  settingsDiff = { isCustomized: false, changedKeys: [], labels: [], count: 0 };
  vi.clearAllMocks();
});

const renderLayout = (mobileTab: 'history' | 'chat' | 'files' = 'chat', setMobileTab = vi.fn()) => {
  const result = render(
    <KbWorkspaceLayout mobileTab={mobileTab} setMobileTab={setMobileTab} swipeHandlers={noSwipe} />,
  );
  return { ...result, setMobileTab };
};

describe('KbWorkspaceLayout — was die Shell bekommt', () => {
  it('hängt den Verlauf in die Navigationsspalte und den Chat in den Hauptbereich', () => {
    renderLayout();
    expect(screen.getByTestId('shell-nav')).toContainElement(screen.getByTestId('history-panel'));
    expect(screen.getByTestId('shell-main')).toContainElement(screen.getByTestId('chat-view'));
  });

  it('verdrahtet links den linken und rechts den rechten Sidebar-Zustand', () => {
    renderLayout();
    expect(shellProps.leftOpen).toBe(true);              // isLeftSidebarOpen
    expect(shellProps.onLeftOpenChange).toBe(setIsLeftSidebarOpen);
    expect(shellProps.rightPanel?.isOpen).toBe(false);   // isRightSidebarOpen, NICHT der linke
    expect(shellProps.rightPanel?.onOpenChange).toBe(setIsRightSidebarOpen);

    // Breiten und Griffe (DS 0.36.0): links `leftWidth`/`leftResize`, rechts
    // `width`/`resize` am Panel. Die Zahlen sind die des Mocks (320 / 500),
    // die Grenzen die exportierten des Hooks — und jede Seite bekommt IHREN
    // Setter, sonst zöge ein Griff die andere Spalte.
    expect(shellProps.leftWidth).toBe(320);
    expect(shellProps.leftResize).toMatchObject({ minWidth: 150, maxWidth: 600 });
    expect(shellProps.leftResize?.onWidthChange).toBe(setLeftSidebarWidth);
    expect(shellProps.rightPanel?.width).toBe(500);
    expect(shellProps.rightPanel?.resize).toMatchObject({ minWidth: 360, maxWidth: 800 });
    expect(shellProps.rightPanel?.resize?.onWidthChange).toBe(setRightSidebarWidth);
  });

  it('gibt der Shell drei Reiter mit ihrer Bereichszuordnung — kein Workspace mehr', () => {
    renderLayout();
    expect(shellProps.mobileTabs?.map(tab => [tab.id, tab.pane])).toEqual([
      ['history', 'left'],
      ['chat', 'main'],
      ['files', 'right'],
    ]);
  });

  it('reicht die Swipe-Handler an die Wurzel der Shell durch', () => {
    renderLayout();
    expect(shellProps.onTouchStart).toBe(noSwipe.onTouchStart);
    expect(shellProps.onTouchEnd).toBe(noSwipe.onTouchEnd);
  });
});

describe('KbWorkspaceLayout — Systemmeldung (KI-936)', () => {
  it('gibt der Shell keine Meldung, solange keine eingeschaltet ist', () => {
    renderLayout();
    expect(shellProps.notice).toBeNull();
    expect(shellProps.status).toBeNull();
  });

  it('hängt eine Störung als Banner in den notice-Slot der Shell', () => {
    siteConfigs = { system_notice_enabled: 'true', system_notice_text: 'Dienst gestört', system_notice_tone: 'error' };
    renderLayout();
    expect(shellProps.notice).toBeTruthy();
    expect(shellProps.status).toBeNull();
    expect(shellProps.noticeLabel).toBe('systemNotice');
  });

  it('hängt jede andere Meldung als Pille in den status-Slot der Shell', () => {
    siteConfigs = { system_notice_enabled: 'true', system_notice_text: 'Hohe Auslastung', system_notice_tone: 'warning' };
    renderLayout();
    expect(shellProps.status).toBeTruthy();
    expect(shellProps.notice).toBeNull();
  });
});

describe('KbWorkspaceLayout Quellen-Sichtbarkeit', () => {
  it('nimmt die Quellenspalte nie heraus — es gibt keine Workspace-Ansicht mehr (22.09.2026)', () => {
    // Bis zum 22.09.2026 blendete `showRight={false}` die Spalte im Workspace
    // aus. Die Ansicht ist nicht mehr erreichbar (KbViewType = 'chat'), also
    // gibt es keinen Zustand, in dem die Spalte fehlen dürfte.
    renderLayout();
    expect(screen.getByTestId('sources-panel')).toBeInTheDocument();
    expect(shellProps.showRight).toBeUndefined();
    expect(setIsRightSidebarOpen).not.toHaveBeenCalled();
  });
});

describe('KbWorkspaceLayout Reiter-Ableitung', () => {
  it('zieht kbView beim Wechsel auf „chat" mit', async () => {
    const setMobileTab = vi.fn();
    renderLayout('chat', setMobileTab);
    shellProps.onMobileTabChange?.('chat');
    expect(setKbView).toHaveBeenCalledWith('chat');
    expect(setMobileTab).toHaveBeenCalledWith('chat');
  });

  it('meldet für „chat" immer „chat" als aktiv — kbView hat keinen zweiten Wert mehr', () => {
    renderLayout('chat');
    expect(shellProps.activeMobileTab).toBe('chat');
  });

  it('lässt „history" und „files" unangetastet — die sind nie mehrdeutig', () => {
    renderLayout('history');
    expect(shellProps.activeMobileTab).toBe('history');
  });
});

describe('KbWorkspaceLayout Chrome-Leiste', () => {
  it('trägt den Pfad „Bereich / Thema" — der Bereich als Weg zurück, das Thema als aktuelle Seite', () => {
    renderLayout();
    render(<div data-testid="page-label">{shellProps.pageLabel}</div>);
    const label = within(screen.getByTestId('page-label'));
    // ORACLE: the WAI-ARIA breadcrumb pattern — a named navigation whose last
    // entry is the current page and not a control.
    expect(label.getByRole('navigation', { name: 'breadcrumbNav' })).toBeInTheDocument();
    // The section is a link to its overview's own URL; nothing else is a control.
    expect(label.getByRole('link', { name: 'sharedTopics' })).toHaveAttribute('href', '/shared');
    expect(label.queryAllByRole('button')).toEqual([]);
    expect(label.getByText('TEST')).toHaveAttribute('aria-current', 'page');
    // The back arrow it replaces is gone.
    expect(screen.queryByRole('button', { name: 'backToOverview' })).toBeNull();
    // Der alte Reiter-Block (Chat / Bericht / Mindmap / Workspace) und die
    // rechte Knopfgruppe (Sprache, Teilen, KB-Einstellungen) sind mit der
    // `chat-header` gegangen und haben hier keinen Ersatz — das ist Absicht
    // und Aufgabe der Folgekarte. Rechts steht seit dem 22.09.2026 nur das
    // System-Prompt-Zahnrad, und das auch nur für Eigentümer und KB-Admins:
    // ein fremder Nutzer ohne KB-Rolle sieht dort nichts.
    expect(screen.queryByRole('button', { name: 'mindMap' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shareKb' })).not.toBeInTheDocument();
    // Rechts steht nur das Zahnrad, und das nicht für diesen Nutzer (KI-844:
    // die Suche sitzt wieder im `search`-Slot, nicht in `headerActions`).
    expect(shellProps.headerActions).toBeUndefined();
  });

  it('gibt die Leiste ohne Suchfeld weiter — die Themensuche ist eine Palette; `headerActions` hält nur das Zahnrad', () => {
    authUser = { id: 'u1', role: 'user' };
    kbExtra = { userId: 'u1' };
    renderLayout();
    // The bar has no search field any more: „Suchen" in the history column
    // (HistoryPanel) or ⌘K opens the palette, which is closed at rest.
    expect(shellProps.search).toBeUndefined();
    expect(screen.queryByTestId('workspace-search')).toBeNull();
    render(<div data-testid="actions">{shellProps.headerActions}</div>);
    const actions = screen.getByTestId('actions');
    // ORACLE: the DOM of the slot — exactly one control, the gear, and no search.
    expect(within(actions).getAllByRole('button')).toEqual([within(actions).getByRole('button', { name: 'topicSettingsButton' })]);
    expect(within(actions).queryByTestId('workspace-search')).toBeNull();
    // The way back stayed in `pageLabel`.
    render(<div>{shellProps.pageLabel}</div>);
    expect(screen.getByRole('link', { name: 'sharedTopics' })).toBeInTheDocument();
  });

  it('zeigt dem Eigentümer das System-Prompt-Zahnrad und schaltet damit den Editor', async () => {
    authUser = { id: 'u1', role: 'user' };
    kbExtra = { userId: 'u1' };
    renderLayout();
    render(<div>{shellProps.headerActions}</div>);
    const gear = screen.getByRole('button', { name: 'topicSettingsButton' });
    // It opens a dialog; it is not a toggle, so it is never „pressed".
    expect(gear).toHaveAttribute('aria-haspopup', 'dialog');
    expect(gear).not.toHaveAttribute('aria-pressed');
    await userEvent.click(gear);
    expect(setSystemPromptOpen).toHaveBeenCalledWith(true);
  });

  it('markiert das Zahnrad nicht als gedrückt, wenn das Thema einen eigenen Prompt hat — dafür steht der Punkt', () => {
    authUser = { id: 'u1', role: 'user' };
    kbExtra = { userId: 'u1', systemPrompt: 'Antworte kurz.' };
    settingsDiff = { isCustomized: true, changedKeys: ['role'], labels: ['asstTabRole'], count: 1 };
    renderLayout();
    render(<div data-testid="actions">{shellProps.headerActions}</div>);
    const gear = within(screen.getByTestId('actions')).getByRole('button');
    expect(gear).not.toHaveAttribute('aria-pressed');
    expect(gear.querySelector('[data-slot="topic-settings-dot"]')).not.toBeNull();
    // The diff is read for this topic, and again when the settings window closes.
    expect(useTopicSettingsDiff).toHaveBeenLastCalledWith('kb1', false);
  });

  it('zeigt einem KB-Admin ohne Eigentum das Zahnrad ebenfalls', () => {
    authUser = { id: 'u2', role: 'user' };
    kbExtra = { userId: 'u1', myRole: 'admin' };
    renderLayout();
    render(<div>{shellProps.headerActions}</div>);
    expect(screen.getByRole('button', { name: 'topicSettingsButton' })).toBeInTheDocument();
  });

  it('verbirgt das Zahnrad vor einem Nutzer, dessen id nur zufällig fehlt (kein Eigentum aus undefined === undefined)', () => {
    authUser = { role: 'user' };
    kbExtra = { userId: undefined };
    renderLayout();
    expect(shellProps.headerActions).toBeUndefined();
  });

  it('führt mit einem Klick auf das Logo zur Übersicht', async () => {
    renderLayout();
    render(<div>{shellProps.logo}</div>);
    await userEvent.click(screen.getByRole('button', { name: 'goToHome' }));
    expect(handleGoHome).toHaveBeenCalledTimes(1);
  });

  it('führt vom eigenen Thema über handleGoHome zurück zu „Mein Wissen", nicht über handleViewHome', async () => {
    kbExtra = { myRole: 'owner' };
    renderLayout();
    render(<div>{shellProps.pageLabel}</div>);
    await userEvent.click(screen.getByRole('link', { name: 'myTopics' }));
    expect(handleGoHome).toHaveBeenCalledTimes(1);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  // ORACLE: the three overviews a topic is listed in — own, shared with me,
  // public — are the app's own split (splitKbsByOwnership, visibility).
  it.each([
    ['ein geteiltes Thema', { myRole: 'edit' }, 'sharedTopics', 'shared-topics'],
    ['ein öffentliches Thema', { myRole: 'view', visibility: 'public' }, 'discoverTopics', 'discover'],
  ] as const)('führt für %s in dessen Bereich zurück und setzt die Ansicht auf den Chat', async (_name, extra, label, view) => {
    kbExtra = extra;
    renderLayout();
    render(<div>{shellProps.pageLabel}</div>);
    await userEvent.click(screen.getByRole('link', { name: label }));
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith({ view });
    expect(setKbView).toHaveBeenCalledWith('chat');
    expect(handleGoHome).not.toHaveBeenCalled();
  });
});

// Oracle: backend contract 2026-10-16 — seeSources is the base of every
// source right (add, download and manage all require it), so without it the
// sources column has nothing usable to show. The UI rule: what cannot be used
// is not rendered — no column, no rail, no mobile tab.
describe('KbWorkspaceLayout — the sources column follows seeSources', () => {
  const caps = (seeSources: boolean) => ({
    seeSources, addSources: false, downloadSources: false, seeCitations: true, manageSources: false,
  });

  it('hands the shell a sources column and a files tab with seeSources', () => {
    kbExtra = { capabilities: caps(true) };
    renderLayout();
    expect(shellProps.rightPanel).toBeDefined();
    expect(shellProps.mobileTabs?.map(tab => tab.id)).toEqual(['history', 'chat', 'files']);
  });

  it('hands the shell no sources column and no files tab without seeSources', () => {
    kbExtra = { capabilities: caps(false) };
    renderLayout();
    expect(shellProps.rightPanel).toBeUndefined();
    expect(screen.queryByTestId('sources-panel')).not.toBeInTheDocument();
    expect(shellProps.mobileTabs?.map(tab => tab.id)).toEqual(['history', 'chat']);
  });

  it('shows the chat when a swipe left the mobile tab on files without seeSources', () => {
    kbExtra = { capabilities: caps(false) };
    renderLayout('files');
    expect(shellProps.activeMobileTab).toBe('chat');
  });

  it('keeps the column for a backend without capabilities', () => {
    renderLayout();
    expect(shellProps.rightPanel).toBeDefined();
  });

  // Oracle: translations keys — the column's title sits in its header row
  // (beside the collapse toggle) and names what the column offers: adding
  // sources for a caller with addSources, the plain source list otherwise.
  it.each([
    [true, 'addSources'],
    [false, 'sources'],
  ])('titles the column header for addSources=%s with %s', (addSources, title) => {
    kbExtra = { capabilities: { ...caps(true), addSources } };
    renderLayout();
    render(<div>{shellProps.rightPanel?.header}</div>);
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
  });
});
