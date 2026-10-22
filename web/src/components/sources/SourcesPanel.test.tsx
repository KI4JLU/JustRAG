import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { SourcesPanel } from './SourcesPanel';

vi.mock('../sidebar/SourcesGrid', () => ({ SourcesGrid: () => <div data-testid="sources-grid" /> }));
// The stub records its props so the manage gate handed to the list is visible.
let sectionProps: Record<string, unknown> = {};
vi.mock('../sidebar/SourcesSection', () => ({
  SourcesSection: (props: Record<string, unknown>) => { sectionProps = props; return <div data-testid="sources-section" />; },
}));
vi.mock('../sidebar/CrawlModal', () => ({ CrawlModal: () => null }));
vi.mock('../sidebar/RssModal', () => ({ RssModal: () => null }));
vi.mock('../sidebar/ConfluenceModal', () => ({ ConfluenceModal: () => null }));
vi.mock('../sidebar/GitRepoModal', () => ({ GitRepoModal: () => null }));
vi.mock('../sidebar/FileUploadModal', () => ({ FileUploadModal: () => null }));
vi.mock('../sidebar/TextSourceModal', () => ({ TextSourceModal: () => null }));
vi.mock('../../contexts/MobileContext', () => ({ useIsMobileContext: () => false }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
const showConfirm = vi.fn(async () => true);
vi.mock('../../contexts/ModalContext', () => ({ useModalContext: () => ({ showConfirm }) }));
const handleToggleFilesSelection = vi.fn();
const deleteFiles = vi.fn(async () => undefined);
const deleteRssFeeds = vi.fn(async () => undefined);
let rssFeeds: Array<Record<string, unknown>> = [];
// The caller's role on the open KB, and the backend's resolved capabilities
// (undefined = an older backend); the real kbSourceRights decides from them.
let myRole: string | undefined = 'edit';
let capabilities: Record<string, boolean> | undefined;
let isGlobal = false;
let files: Array<Record<string, unknown>> = [{ id: 'f0', name: 'x.pdf', status: 'completed', origin: 'upload' }];
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ siteConfigs: {}, user: { id: 'u1', role: 'user' } }) }));
vi.mock('../../contexts/KbCoreContext', () => ({
  useKbCore: () => ({ currentKb: { id: 'kb1', isGlobal, visibility: isGlobal ? 'public' : 'private', userId: null, myRole, capabilities }, setKbView: vi.fn(), handleGoHome: vi.fn(), handleViewHome: vi.fn() }),
}));
vi.mock('../../contexts/KbDataContext', () => ({
  useKbData: () => ({
    fileMgmt: { files, filesLoaded: true, retryAllFailed: vi.fn(), fileInputRef: { current: null }, showUploadModal: false, setShowUploadModal: vi.fn(), handleToggleFilesSelection, deleteFiles },
    webTools: { setToolTab: vi.fn(), searchResults: [], crawlResults: [], sourcesAddedCount: 0, setShowWebWorkspace: vi.fn() },
    rssFeeds, deleteRssFeeds, confluenceSources: [], gitRepoSources: [],
  }),
}));

describe('SourcesPanel', () => {
  it('bringt keinen eigenen Rahmen mehr mit — die rechte Spalte gehört der Shell', () => {
    // Bis zum Umzug auf `AppShellLayout` trug dieses Panel seinen eigenen
    // `SidebarShell`: <aside class="sidebar-shell--right"> mit eigener Breite,
    // eigenem Einklapp-Knopf und eigenem Zustand. Die Shell stellt diesen
    // Rahmen jetzt als `rightPanel` — zwei ineinander steckende Rahmen wären
    // zwei Knöpfe und zwei Breiten für eine Spalte.
    //
    // Der Oracle ist die Zuständigkeit, nicht die Ausgabe dieser Komponente:
    // dass die Spalte rechts hängt und `isRightSidebarOpen` führt, prüft
    // KbWorkspaceLayout.test.tsx am `rightPanel`-Prop. Hier steht die
    // Gegenprobe, dass das Panel selbst nichts davon mitbringt.
    const { container } = render(<SourcesPanel />);
    expect(container.querySelector('aside')).toBeNull();
    expect(screen.getByTestId('sources-section')).toBeInTheDocument();
  });

  // Oracle without capabilities (older backend): RequireKBRole("edit") on the
  // add/upload/retry routes in internal/app/routes.go — a viewer offered these
  // controls only gets a 403.
  describe('edit controls follow the role', () => {
    beforeEach(() => { myRole = 'edit'; capabilities = undefined; isGlobal = false; files = [{ id: 'f1', name: 'a.pdf', status: 'error', origin: 'upload' }]; });

    it('an editor gets the add-sources grid, the add title and retry-all', () => {
      render(<SourcesPanel />);
      expect(screen.getByTestId('sources-grid')).toBeInTheDocument();
      expect(screen.getByText('addSources')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retryAllFailedShort/ })).toBeInTheDocument();
      expect(sectionProps.canManage).toBe(true);
    });

    it('a viewer gets the list only: no grid, no retry-all, the plain title', () => {
      myRole = 'view';
      render(<SourcesPanel />);
      expect(screen.queryByTestId('sources-grid')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retryAllFailedShort/ })).not.toBeInTheDocument();
      expect(screen.getByText('sources')).toBeInTheDocument();
      expect(screen.getByTestId('sources-section')).toBeInTheDocument();
      expect(sectionProps.canManage).toBe(false);
    });

    it('a viewer of a KB with no sources gets the empty list, not the upload dropzone', () => {
      myRole = 'view'; files = [];
      render(<SourcesPanel />);
      expect(screen.queryByRole('button', { name: 'uploadFile' })).not.toBeInTheDocument();
      expect(screen.getByTestId('sources-section')).toBeInTheDocument();
    });
  });

  // Oracle: backend contract 2026-10-16 — capabilities.addSources (switchable
  // for viewers and editors) gates every control that CREATES a source;
  // capabilities.manageSources (fixed: edit and above) gates every control that
  // CHANGES one. The two are independent.
  describe('add and manage follow the two capabilities independently', () => {
    beforeEach(() => { isGlobal = false; files = [{ id: 'f1', name: 'a.pdf', status: 'error', origin: 'upload' }]; });

    it('a viewer with addSources gets the add grid and title, but no delete/retry', () => {
      myRole = 'view';
      capabilities = { seeSources: true, addSources: true, downloadSources: false, seeCitations: false, manageSources: false };
      render(<SourcesPanel />);
      expect(screen.getByTestId('sources-grid')).toBeInTheDocument();
      expect(screen.getByText('addSources')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retryAllFailedShort/ })).not.toBeInTheDocument();
      expect(sectionProps.canManage).toBe(false);
    });

    it('an editor without addSources gets delete/retry, but no add grid and the plain title', () => {
      myRole = 'edit';
      capabilities = { seeSources: true, addSources: false, downloadSources: true, seeCitations: true, manageSources: true };
      render(<SourcesPanel />);
      expect(screen.queryByTestId('sources-grid')).not.toBeInTheDocument();
      expect(screen.getByText('sources')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retryAllFailedShort/ })).toBeInTheDocument();
      expect(sectionProps.canManage).toBe(true);
    });

    it('an editor without addSources and no sources gets the list, not the upload dropzone', () => {
      myRole = 'edit'; files = [];
      capabilities = { seeSources: true, addSources: false, downloadSources: true, seeCitations: true, manageSources: true };
      render(<SourcesPanel />);
      expect(screen.queryByRole('button', { name: 'uploadFile' })).not.toBeInTheDocument();
      expect(screen.getByTestId('sources-section')).toBeInTheDocument();
    });
  });

  // Oracle: go-backend routes.go — the add routes (POST …/files, …/text,
  // …/add-sources, …/rss, …) sit on the add-sources gate alone; nothing
  // refuses a global KB (files.Handler only applies the global file limit).
  // So the add controls follow addSources on a global KB too.
  describe('a global KB', () => {
    beforeEach(() => { isGlobal = true; files = [{ id: 'f1', name: 'a.pdf', status: 'completed', origin: 'upload' }]; });

    it('offers the add grid to a caller with addSources', () => {
      myRole = 'admin';
      capabilities = { seeSources: true, addSources: true, downloadSources: true, seeCitations: true, manageSources: true };
      render(<SourcesPanel />);
      expect(screen.getByTestId('sources-grid')).toBeInTheDocument();
      expect(screen.getByText('addSources')).toBeInTheDocument();
    });

    it('offers no add grid without addSources', () => {
      myRole = 'view';
      capabilities = { seeSources: true, addSources: false, downloadSources: true, seeCitations: true, manageSources: false };
      render(<SourcesPanel />);
      expect(screen.queryByTestId('sources-grid')).not.toBeInTheDocument();
    });
  });

  // Oracle: backend contract 2026-10-16 — downloadSources is handed to the
  // list, which drops Download and the previews without it (SourcesSection.test).
  it.each([true, false])('hands downloadSources=%s to the list', (download) => {
    isGlobal = false;
    capabilities = { seeSources: true, addSources: false, downloadSources: download, seeCitations: true, manageSources: false };
    render(<SourcesPanel />);
    expect(sectionProps.canDownload).toBe(download);
  });
});

// The two modes (sourceSelection.ts). Oracles: the user's decisions —
// "Auswählen" opens with the sources the chat currently uses ticked, Confirm
// makes the ticked set the chat filter, Cancel leaves it as it was; removing is
// a separate mode, started from one row's Remove, ticked rows red, one confirm.
describe('SourcesPanel modes', () => {
  const startFilter = () => act(() => { (sectionProps.onStartSelection as () => void)(); });
  const startRemoval = (key: string) => act(() => { (sectionProps.onStartRemoval as (k: string) => void)(key); });
  const tick = (key: string, on: boolean) => act(() => { (sectionProps.onToggleSelected as (k: string, on: boolean) => void)(key, on); });
  const keys = () => [...(sectionProps.selection as Set<string>)].sort();

  beforeEach(() => {
    myRole = 'edit'; capabilities = undefined; isGlobal = false;
    files = [
      { id: 'f1', name: 'a.pdf', status: 'completed', origin: 'upload', selected: true },
      { id: 'f2', name: 'b.pdf', status: 'completed', origin: 'upload', selected: false },
      { id: 'r1', name: 'item', status: 'completed', origin: 'rss', rssFeedId: 'feed-1', selected: true },
      { id: 'c1', name: 'page', status: 'completed', origin: 'confluence', selected: false },
    ];
    rssFeeds = [{ id: 'feed-1', title: 'Feed', url: 'https://x/feed' }];
    handleToggleFilesSelection.mockClear(); deleteFiles.mockClear(); deleteRssFeeds.mockClear(); showConfirm.mockClear();
  });

  it('both are off by default: no bar, and the list gets no selection', () => {
    render(<SourcesPanel />);
    expect(sectionProps.selection).toBeNull();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  describe('filter mode ("Auswählen")', () => {
    it('opens with the sources the chat currently uses ticked', () => {
      render(<SourcesPanel />);
      startFilter();
      expect(keys()).toEqual(['file:f1', 'rss:feed-1']);
      expect(sectionProps.selectionTone).toBe('default');
      expect(screen.getByRole('toolbar', { name: 'selectSources' })).toBeInTheDocument();
    });

    it('offers no remove action', () => {
      render(<SourcesPanel />);
      startFilter();
      expect(screen.queryByRole('button', { name: 'removeSelected' })).not.toBeInTheDocument();
    });

    it('Cancel leaves the mode without touching the chat filter', async () => {
      render(<SourcesPanel />);
      startFilter();
      tick('file:f2', true);
      await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
      expect(sectionProps.selection).toBeNull();
      expect(handleToggleFilesSelection).not.toHaveBeenCalled();
    });

    it('Confirm makes the ticked rows the chat filter; Confluence/git files stay as they were', async () => {
      render(<SourcesPanel />);
      startFilter();
      tick('file:f2', true);
      tick('rss:feed-1', false);
      await userEvent.click(screen.getByRole('button', { name: 'confirmSourceSelection' }));
      expect(handleToggleFilesSelection).toHaveBeenCalledWith(['f1', 'f2'], true);
      expect(handleToggleFilesSelection).toHaveBeenCalledWith(['r1'], false);
      expect(handleToggleFilesSelection.mock.calls.flatMap(c => c[0])).not.toContain('c1');
      expect(sectionProps.selection).toBeNull();
    });

    it('cannot confirm an empty set — a turn needs a source', () => {
      render(<SourcesPanel />);
      startFilter();
      tick('file:f1', false);
      tick('rss:feed-1', false);
      expect(screen.getByRole('button', { name: 'confirmSourceSelection' })).toBeDisabled();
    });

    it('cannot confirm a set whose rows hold no file — an empty feed alone', () => {
      rssFeeds = [{ id: 'feed-1', title: 'Feed', url: 'https://x/feed' }, { id: 'feed-2', title: 'Leer', url: 'https://x/empty' }];
      files = files.filter(f => f.origin !== 'confluence');
      render(<SourcesPanel />);
      startFilter();
      tick('file:f1', false);
      tick('rss:feed-1', false);
      expect(keys()).toEqual(['rss:feed-2']);
      expect(screen.getByRole('button', { name: 'confirmSourceSelection' })).toBeDisabled();
    });

    it('can confirm while files the mode leaves alone (Confluence) stay selected', () => {
      files = files.map(f => f.id === 'c1' ? { ...f, selected: true } : f);
      render(<SourcesPanel />);
      startFilter();
      tick('file:f1', false);
      tick('rss:feed-1', false);
      expect(screen.getByRole('button', { name: 'confirmSourceSelection' })).toBeEnabled();
    });

    it('Select all ticks every selectable row, then clears them again', async () => {
      render(<SourcesPanel />);
      startFilter();
      await userEvent.click(screen.getByRole('button', { name: 'selectAll' }));
      expect(keys()).toEqual(['file:f1', 'file:f2', 'rss:feed-1']);
      await userEvent.click(screen.getByRole('button', { name: 'deselectAll' }));
      expect(keys()).toEqual([]);
    });

    it('is there for a viewer too', () => {
      myRole = 'view';
      render(<SourcesPanel />);
      startFilter();
      expect(screen.getByRole('button', { name: 'confirmSourceSelection' })).toBeEnabled();
    });
  });

  describe('remove mode (a row\'s "Entfernen")', () => {
    it('opens with only that row ticked, in the destructive tone, and no filter controls', () => {
      render(<SourcesPanel />);
      startRemoval('file:f2');
      expect(keys()).toEqual(['file:f2']);
      expect(sectionProps.selectionTone).toBe('destructive');
      expect(screen.getByRole('toolbar', { name: 'removeSources' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'confirmSourceSelection' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'selectAll' })).not.toBeInTheDocument();
    });

    it('asks once, then removes the ticked files and feeds and leaves the mode', async () => {
      render(<SourcesPanel />);
      startRemoval('file:f2');
      tick('rss:feed-1', true);
      await userEvent.click(screen.getByRole('button', { name: 'removeSelected' }));
      expect(showConfirm).toHaveBeenCalledTimes(1);
      expect(deleteFiles).toHaveBeenCalledWith(['f2']);
      expect(deleteRssFeeds).toHaveBeenCalledWith(['feed-1']);
      // Files first: the feed delete re-reads the file list.
      expect(deleteFiles.mock.invocationCallOrder[0]).toBeLessThan(deleteRssFeeds.mock.invocationCallOrder[0]);
      expect(handleToggleFilesSelection).not.toHaveBeenCalled();
      expect(sectionProps.selection).toBeNull();
    });

    it('a declined confirm removes nothing and stays in the mode', async () => {
      showConfirm.mockResolvedValueOnce(false);
      render(<SourcesPanel />);
      startRemoval('file:f2');
      await userEvent.click(screen.getByRole('button', { name: 'removeSelected' }));
      expect(deleteFiles).not.toHaveBeenCalled();
      expect(sectionProps.selection).not.toBeNull();
    });

    it('cannot remove an empty set', () => {
      render(<SourcesPanel />);
      startRemoval('file:f2');
      tick('file:f2', false);
      expect(screen.getByRole('button', { name: 'removeSelected' })).toBeDisabled();
    });
  });
});
