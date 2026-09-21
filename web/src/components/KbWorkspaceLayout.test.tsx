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
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'user' } }) }));

const handleGoHome = vi.fn();
let kbView = 'chat';
const setKbView = vi.fn();

vi.mock('../contexts/KbCoreContext', () => ({
  useKbCore: () => ({
    currentKb: { id: 'kb1', name: 'TEST' },
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
  }),
}));

const noSwipe = { onTouchStart: vi.fn(), onTouchEnd: vi.fn() };

beforeEach(() => {
  shellProps = {};
  kbView = 'chat';
  vi.clearAllMocks();
});

const renderLayout = (mobileTab: 'history' | 'chat' | 'workspace' | 'files' = 'chat', setMobileTab = vi.fn()) => {
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

  it('gibt der Shell die vier Reiter mit ihrer Bereichszuordnung', () => {
    renderLayout();
    expect(shellProps.mobileTabs?.map(tab => [tab.id, tab.pane])).toEqual([
      ['history', 'left'],
      ['chat', 'main'],
      ['workspace', 'main'],
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
  it('nimmt die Quellenspalte im Workspace per showRight heraus, statt sie zuzuklappen', () => {
    // `showRight={false}` (DS 0.37.0) ist der von der Shell vorgesehene Weg
    // und rührt `isRightSidebarOpen` nicht an. `setIsRightSidebarOpen(false)`
    // (so lief es bis 2026-08) ließ die Leiste nach dem Verlassen des
    // Workspace zugeklappt zurück, weil niemand sie wieder öffnete.
    kbView = 'chat';
    const { rerender } = render(
      <KbWorkspaceLayout mobileTab="chat" setMobileTab={vi.fn()} swipeHandlers={noSwipe} />,
    );
    expect(screen.getByTestId('sources-panel')).toBeInTheDocument();

    kbView = 'workspace';
    rerender(<KbWorkspaceLayout mobileTab="chat" setMobileTab={vi.fn()} swipeHandlers={noSwipe} />);
    expect(screen.queryByTestId('sources-panel')).not.toBeInTheDocument();
    expect(shellProps.showRight).toBe(false);
    // Das Panel selbst bleibt übergeben — nur die Desktop-Anordnung lässt es
    // aus. Das ist es, was den Mobil-Reiter „Quellen" am Leben hält.
    expect(shellProps.rightPanel).toBeDefined();

    kbView = 'chat';
    rerender(<KbWorkspaceLayout mobileTab="chat" setMobileTab={vi.fn()} swipeHandlers={noSwipe} />);
    expect(screen.getByTestId('sources-panel')).toBeInTheDocument();
    expect(setIsRightSidebarOpen).not.toHaveBeenCalled();
  });

  it('überlässt den Mobil-Fall der Shell: rightPanel ist auch im Workspace übergeben', () => {
    // Unterhalb `lg` ignoriert `AppShell` `showRight` (DS 0.37.0), also zeigt
    // der Reiter „Quellen" die Spalte weiterhin — solange die App das Panel
    // übergibt. Bis 0.36.0 fing die App das selbst ab
    // (`activeMobileTab === 'files'`); diese Ableitung ist weg.
    kbView = 'workspace';
    renderLayout('files');
    expect(shellProps.rightPanel).toBeDefined();
    expect(shellProps.showRight).toBe(false);
  });
});

describe('KbWorkspaceLayout Reiter-Ableitung', () => {
  it('zieht kbView beim Reiterwechsel mit', async () => {
    const setMobileTab = vi.fn();
    renderLayout('chat', setMobileTab);
    shellProps.onMobileTabChange?.('workspace');
    expect(setKbView).toHaveBeenCalledWith('workspace');
    expect(setMobileTab).toHaveBeenCalledWith('workspace');
  });

  it('GUARD (#1): bei mobileTab="chat" aber kbView="workspace" meldet die Shell "workspace" als aktiv', () => {
    kbView = 'workspace';
    renderLayout('chat');
    expect(shellProps.activeMobileTab).toBe('workspace');
  });

  it('lässt „history" und „files" unangetastet — die sind nie mehrdeutig', () => {
    kbView = 'workspace';
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
    // und Aufgabe der Folgekarte.
    expect(screen.queryByRole('button', { name: 'mindMap' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shareKb' })).not.toBeInTheDocument();
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
