import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatView } from './ChatView';
import type { Message, KnowledgeBase, KbCapabilities } from '../types';

// The real ChatView with the real MessageBubble, mocked to the minimum —
// the same harness as ChatView.conflicts.test.tsx. What is under test is the
// wiring: which source rights ChatView hands to the answers and the composer.

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({
    t: (key: string) => key,
    language: 'en' as const,
    theme: 'light' as const,
    toggleTheme: vi.fn(),
    setLanguage: vi.fn(),
  }),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user' }, siteConfigs: {} }),
}));
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('../contexts/MobileContext', () => ({
  // isMobile=true collapses most of ChatView's desktop-only chrome (theme/
  // language toggles, BranchTreeNav, …) that this test has no reason to
  // exercise or mock further.
  useIsMobileContext: () => true,
}));
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
  getMotionProps: () => ({}),
}));
vi.mock('../hooks/useKbAgents', () => ({
  useKbAgents: () => ({ agents: [], teams: [] }),
}));

let capabilities: KbCapabilities | undefined;
let files: Array<{ id: string; selected?: boolean }> = [{ id: 'f1', selected: true }];
let hasFiles = true;
const currentKb = (): KnowledgeBase => ({
  id: 'kb1', name: 'Handbuch', description: null, userId: 'someone-else',
  createdAt: '2026-01-01', isPro: false, isGlobal: false,
  aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
  capabilities,
});
const handlePdfSourceOpen = vi.fn();

vi.mock('../contexts/KbCoreContext', () => ({
  useKbCore: () => ({
    currentKb: currentKb(),
    availableConfigs: [],
    kbView: 'chat' as const,
    setKbView: vi.fn(),
    handleGoHome: vi.fn(),
    handleUpdateKBSettings: vi.fn(),
    onViewAgents: vi.fn(),
    scopedMindmapMessageId: undefined,
    onViewGraphForMessage: vi.fn(),
    onCloseMindmap: vi.fn(),
    onShowWholeKb: vi.fn(),
    kbMgmt: { handleRenameKB: vi.fn() },
  }),
}));

const answer: Message = {
  id: 'ai1',
  role: 'ai',
  content: 'Der Beitrag beträgt 50 EUR [1].',
  sources: [{ index: 1, fileName: 'satzung.pdf', fileId: 'f1', content: 'Beitrag 50 EUR', score: 1, pages: [2] }],
};
let messages: Message[] = [answer];

vi.mock('../contexts/KbChatContext', () => ({
  useKbChat: () => ({
    chat: {
      activeChatId: 'c1',
      messageTree: new Map(),
      messages,
      activeLeafId: null,
      comparisonMode: false,
      comparisonLeafId: null,
      setComparisonMode: vi.fn(),
      setComparisonLeafId: vi.fn(),
      setActiveLeafId: vi.fn(),
      editingMessageId: null,
      setEditingMessageId: vi.fn(),
      forkPointId: null,
      setForkPointId: vi.fn(),
      userMessageInput: '',
      setUserMessageInput: vi.fn(),
      loading: false,
      textareaRef: { current: null },
      handleFollowUpClick: vi.fn(),
      handleSwitchBranch: vi.fn(),
      handleStartEdit: vi.fn(),
      handleEditSubmit: vi.fn(),
      handleForkFromMessage: vi.fn(),
      handleStartComparison: vi.fn(),
      handleRegenerate: vi.fn(),
      handleFeedback: vi.fn(),
      handleSendMessage: (e: { preventDefault: () => void }) => e.preventDefault(),
      fetchChats: vi.fn(),
      loadedResearchSession: null,
      setLoadedResearchSession: vi.fn(),
      loadedAcademicSession: null,
      setLoadedAcademicSession: vi.fn(),
      startComparison: vi.fn(),
    },
    enhance: null,
    setEnhance: vi.fn(),
    reasoningEnabled: false,
    setReasoningEnabled: vi.fn(),
    researchRunning: false,
    academicResearchRunning: false,
    setResearchRunning: vi.fn(),
    setAcademicResearchRunning: vi.fn(),
    agentSelection: {},
    setAgentSelection: vi.fn(),
  }),
}));

vi.mock('../contexts/KbDataContext', () => ({
  useKbData: () => ({
    fileMgmt: {
      hasFiles, filesLoaded: true, selectedFileCount: 1, fileInputRef: { current: null },
      isDragging: false, handleDragOver: vi.fn(), handleDragEnter: vi.fn(),
      handleDragLeave: vi.fn(), handleDrop: vi.fn(), files,
    },
    webTools: {
      handlePreviewSource: vi.fn(), handlePdfSourceOpen, setToolTab: vi.fn(),
      toolLoading: false, webResearchRunning: false,
    },
    content: { handleGenerate: vi.fn(), selectedContent: null, fetchGeneratedContent: vi.fn() },
    handleSelectContent: vi.fn(),
    rssLoading: false,
    confluenceLoading: false,
    confluenceSources: [],
  }),
}));

vi.mock('../contexts/KbLayoutContext', () => ({
  useKbLayout: () => ({
    sidebar: { setIsRightSidebarOpen: vi.fn(), setIsLeftSidebarOpen: vi.fn() },
  }),
}));

const caps = (over: Partial<KbCapabilities>): KbCapabilities => ({
  seeSources: true, addSources: false, downloadSources: true, seeCitations: true, manageSources: false, ...over,
});

beforeEach(() => {
  capabilities = undefined;
  files = [{ id: 'f1', selected: true }];
  hasFiles = true;
  messages = [answer];
  handlePdfSourceOpen.mockClear();
});

// Oracle: the backend contract of 2026-10-16 (capabilities) and the UI rule —
// what the caller cannot use is not rendered at all.
describe('ChatView — citations follow seeCitations', () => {
  it('renders the inline citation with seeCitations', () => {
    capabilities = caps({ seeCitations: true });
    const { container } = render(<ChatView />);
    expect(container.querySelector('button.citation-chip')).not.toBeNull();
    expect(screen.getByRole('button', { name: /answerSourcesToggle/ })).toBeInTheDocument();
  });

  it('renders neither the citation nor the source list without it', () => {
    capabilities = caps({ seeCitations: false });
    const { container } = render(<ChatView />);
    expect(container.querySelector('button.citation-chip')).toBeNull();
    expect(screen.queryByRole('button', { name: /answerSourcesToggle/ })).not.toBeInTheDocument();
  });
});

describe('ChatView — the source panel follows downloadSources', () => {
  it('opens the cited source beside the answer, with the full view and download', () => {
    capabilities = caps({ downloadSources: true });
    const { container } = render(<ChatView />);
    fireEvent.click(container.querySelector('button.citation-chip') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'openInSource' }));
    // The harness is the mobile layout: the panel opens full screen.
    const panel = screen.getByRole('dialog', { name: 'satzung' });
    expect(panel).toHaveTextContent('sourcePanelPassagesOne');
    expect(screen.getByRole('button', { name: 'sourcePanelDownload' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sourcePanelFullView' }));
    expect(handlePdfSourceOpen).toHaveBeenCalledWith('f1', 'satzung.pdf', 2);
  });

  it('opens the panel without it, but offers neither the full view nor the download', () => {
    capabilities = caps({ downloadSources: false });
    const { container } = render(<ChatView />);
    fireEvent.click(container.querySelector('button.citation-chip') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'openInSource' }));
    expect(screen.getByRole('dialog', { name: 'satzung' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'sourcePanelFullView' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'sourcePanelDownload' })).not.toBeInTheDocument();
  });
});

describe('ChatView — the composer source count follows seeSources', () => {
  it('shows the count with seeSources', () => {
    capabilities = caps({ seeSources: true });
    render(<ChatView />);
    expect(document.getElementById('chat-composer-sources-count')).not.toBeNull();
  });

  it('shows no count without it', () => {
    capabilities = caps({ seeSources: false, downloadSources: false });
    render(<ChatView />);
    expect(document.getElementById('chat-composer-sources-count')).toBeNull();
  });
});

// An empty KB asks the caller to add a first source — only a caller who can.
describe('ChatView — the empty-KB prompt follows addSources', () => {
  beforeEach(() => { messages = []; files = []; hasFiles = false; });

  it('asks a caller with addSources to add a first source', () => {
    capabilities = caps({ addSources: true });
    render(<ChatView />);
    expect(screen.getByText('emptyAddFirstSourceTitle')).toBeInTheDocument();
  });

  it('does not ask a caller without addSources', () => {
    capabilities = caps({ addSources: false });
    render(<ChatView />);
    expect(screen.queryByText('emptyAddFirstSourceTitle')).not.toBeInTheDocument();
    expect(screen.getByText('Handbuch')).toBeInTheDocument();
  });
});
