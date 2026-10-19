import { render, screen } from '@testing-library/react';
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
    fileMgmt: { files, filesLoaded: true, retryAllFailed: vi.fn(), fileInputRef: { current: null }, showUploadModal: false, setShowUploadModal: vi.fn() },
    webTools: { setToolTab: vi.fn(), searchResults: [], crawlResults: [], sourcesAddedCount: 0, setShowWebWorkspace: vi.fn() },
    rssFeeds: [], confluenceSources: [], gitRepoSources: [],
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
