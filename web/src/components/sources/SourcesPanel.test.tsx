import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { SourcesPanel } from './SourcesPanel';

vi.mock('../sidebar/SourcesGrid', () => ({ SourcesGrid: () => <div data-testid="sources-grid" /> }));
vi.mock('../sidebar/SourcesSection', () => ({ SourcesSection: () => <div data-testid="sources-section" /> }));
vi.mock('../sidebar/CrawlModal', () => ({ CrawlModal: () => null }));
vi.mock('../sidebar/RssModal', () => ({ RssModal: () => null }));
vi.mock('../sidebar/ConfluenceModal', () => ({ ConfluenceModal: () => null }));
vi.mock('../sidebar/GitRepoModal', () => ({ GitRepoModal: () => null }));
vi.mock('../sidebar/FileUploadModal', () => ({ FileUploadModal: () => null }));
vi.mock('../sidebar/TextSourceModal', () => ({ TextSourceModal: () => null }));
vi.mock('../../contexts/MobileContext', () => ({ useIsMobileContext: () => false }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
// The caller's role on the open KB; the real canEditKbSources decides from it.
let myRole: string | undefined = 'edit';
let files: Array<Record<string, unknown>> = [{ id: 'f0', name: 'x.pdf', status: 'completed', origin: 'upload' }];
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ siteConfigs: {}, user: { id: 'u1', role: 'user' } }) }));
vi.mock('../../contexts/KbCoreContext', () => ({
  useKbCore: () => ({ currentKb: { id: 'kb1', isGlobal: false, visibility: 'private', userId: null, myRole }, setKbView: vi.fn(), handleGoHome: vi.fn(), handleViewHome: vi.fn() }),
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

  // Oracle: RequireKBRole("edit") on the add/upload/retry routes in
  // internal/app/routes.go — a viewer offered these controls only gets a 403.
  describe('edit controls follow the role', () => {
    beforeEach(() => { myRole = 'edit'; files = [{ id: 'f1', name: 'a.pdf', status: 'error', origin: 'upload' }]; });

    it('an editor gets the add-sources grid, the add title and retry-all', () => {
      render(<SourcesPanel />);
      expect(screen.getByTestId('sources-grid')).toBeInTheDocument();
      expect(screen.getByText('addSources')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retryAllFailedShort/ })).toBeInTheDocument();
    });

    it('a viewer gets the list only: no grid, no retry-all, the plain title', () => {
      myRole = 'view';
      render(<SourcesPanel />);
      expect(screen.queryByTestId('sources-grid')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retryAllFailedShort/ })).not.toBeInTheDocument();
      expect(screen.getByText('sources')).toBeInTheDocument();
      expect(screen.getByTestId('sources-section')).toBeInTheDocument();
    });

    it('a viewer of a KB with no sources gets the empty list, not the upload dropzone', () => {
      myRole = 'view'; files = [];
      render(<SourcesPanel />);
      expect(screen.queryByRole('button', { name: 'uploadFile' })).not.toBeInTheDocument();
      expect(screen.getByTestId('sources-section')).toBeInTheDocument();
    });
  });
});
