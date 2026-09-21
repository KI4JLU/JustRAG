import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SourcesPanel } from './SourcesPanel';

vi.mock('../sidebar/SourcesGrid', () => ({ SourcesGrid: () => <div data-testid="sources-grid" /> }));
vi.mock('../sidebar/SourcesSection', () => ({ SourcesSection: () => <div data-testid="sources-section" /> }));
vi.mock('../sidebar/CrawlModal', () => ({ CrawlModal: () => null }));
vi.mock('../sidebar/RssModal', () => ({ RssModal: () => null }));
vi.mock('../sidebar/ConfluenceModal', () => ({ ConfluenceModal: () => null }));
vi.mock('../sidebar/GitRepoModal', () => ({ GitRepoModal: () => null }));
vi.mock('../sidebar/FileUploadModal', () => ({ FileUploadModal: () => null }));
vi.mock('../../contexts/MobileContext', () => ({ useIsMobileContext: () => false }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ t: (k: string) => k }) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ siteConfigs: {} }) }));
vi.mock('../../contexts/KbCoreContext', () => ({
  useKbCore: () => ({ currentKb: { id: 'kb1', isGlobal: false }, setKbView: vi.fn(), handleGoHome: vi.fn(), handleViewHome: vi.fn() }),
}));
vi.mock('../../contexts/KbDataContext', () => ({
  useKbData: () => ({
    fileMgmt: { files: [], fileInputRef: { current: null }, showUploadModal: false, setShowUploadModal: vi.fn() },
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
});
