import { render, screen } from '@testing-library/react';
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
vi.mock('./KbHeaderTitle', () => ({ KbHeaderTitle: () => <span data-testid="kb-header-title" /> }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
// Wer schaut: Standard ist ein fremder Nutzer ohne KB-Rolle. Tests, die den
// Eigentümer oder einen KB-Admin brauchen, setzen `authUser` / `kbExtra` um.
let authUser: { id?: string; role: string } = { role: 'user' };
let kbExtra: Record<string, unknown> = {};
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: authUser }) }));

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
  kbExtra = {};
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
    expect(shellProps.rightPanel?.resize).toMatchObject({ minWidth: 300, maxWidth: 800 });
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
  it('trägt Zurück-Knopf und KB-Namen, und keinen der abgelösten Kopfleisten-Knöpfe', () => {
    renderLayout();
    render(<div>{shellProps.pageLabel}</div>);
    expect(screen.getByTestId('kb-header-title')).toBeInTheDocument();
    const back = screen.getByRole('button', { name: 'backToOverview' });
    expect(back).toBeInTheDocument();
    // Der alte Reiter-Block (Chat / Bericht / Mindmap / Workspace) und die
    // rechte Knopfgruppe (Sprache, Teilen, KB-Einstellungen) sind mit der
    // `chat-header` gegangen und haben hier keinen Ersatz — das ist Absicht
    // und Aufgabe der Folgekarte. Rechts steht seit dem 22.09.2026 nur das
    // System-Prompt-Zahnrad, und das auch nur für Eigentümer und KB-Admins:
    // ein fremder Nutzer ohne KB-Rolle sieht dort nichts.
    expect(screen.queryByRole('button', { name: 'mindMap' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shareKb' })).not.toBeInTheDocument();
    expect(shellProps.headerActions).toBeUndefined();
  });

  it('zeigt dem Eigentümer das System-Prompt-Zahnrad und schaltet damit den Editor', async () => {
    authUser = { id: 'u1', role: 'user' };
    kbExtra = { userId: 'u1' };
    renderLayout();
    render(<div>{shellProps.headerActions}</div>);
    const gear = screen.getByRole('button', { name: 'systemPromptLabel' });
    expect(gear).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(gear);
    expect(setSystemPromptOpen).toHaveBeenCalledWith(true);
  });

  it('zeigt einem KB-Admin ohne Eigentum das Zahnrad ebenfalls', () => {
    authUser = { id: 'u2', role: 'user' };
    kbExtra = { userId: 'u1', myRole: 'admin' };
    renderLayout();
    render(<div>{shellProps.headerActions}</div>);
    expect(screen.getByRole('button', { name: 'systemPromptLabel' })).toBeInTheDocument();
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

  it('löst mit dem Zurück-Knopf handleGoHome aus, nicht handleViewHome', async () => {
    renderLayout();
    render(<div>{shellProps.pageLabel}</div>);
    await userEvent.click(screen.getByRole('button', { name: 'backToOverview' }));
    expect(handleGoHome).toHaveBeenCalledTimes(1);
  });
});
