import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ChatView } from './ChatView';
import type { Message, KnowledgeBase, KbCapabilities } from '../types';

// The real ChatView with the real MessageBubble, mocked to the minimum —
// the same harness as ChatView.sourceRights.test.tsx. What is under test is
// the wiring: which answer ChatView marks as the latest and which one as
// streaming.

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
let loading = false;

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
      loading,
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

beforeEach(() => {
  capabilities = undefined;
  files = [{ id: 'f1', selected: true }];
  hasFiles = true;
  loading = false;
});

/* Oracle: the owner's decisions for the message footer (2026-10-22, revised)
 * — footers show on hover, focus inside or a tap; on desktop the last message
 * keeps its row at rest, on touch (this harness is mobile) nothing does, and
 * the actions open from a long-press menu instead of the footer. */
describe('ChatView — message footer', () => {
  const older: Message = { ...answer, id: 'ai0' };
  const question: Message = { id: 'u1', role: 'user', content: 'Und der Beitrag?' };

  it('touch: hides every answer footer at rest, the last one included', () => {
    messages = [older, question, answer];
    render(<ChatView />);
    const footers = screen.getAllByTestId('answer-footer');
    expect(footers).toHaveLength(2);
    for (const footer of footers) expect(footer).toHaveAttribute('data-revealed', 'false');
  });

  it('while the latest answer streams: its sources pill is in its footer, no menu yet', () => {
    loading = true;
    messages = [older, question, { ...answer, id: 'temp-ai-1' }];
    render(<ChatView />);
    const footers = screen.getAllByTestId('answer-footer');
    expect(within(footers[1]).getByRole('button', { name: /answerSourcesToggle · 1/ })).toBeInTheDocument();
    fireEvent.contextMenu(screen.getAllByText(/Der Beitrag beträgt/).at(-1)!);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('touch: no action rows; a long-press on a question offers copy and edit', () => {
    messages = [question, answer];
    render(<ChatView />);
    expect(screen.queryByTestId('question-actions')).toBeNull();
    expect(screen.queryByTestId('answer-actions')).toBeNull();
    fireEvent.contextMenu(screen.getByText('Und der Beitrag?'));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['copy', 'editMessage']);
  });

  // Oracle: owner feedback (2026-10-22) — before the first token a spinner,
  // not a shimmering „Denke nach …" that reads like the reasoning trigger.
  it('marks the wait for the first token with a spinner, not a thinking label', () => {
    loading = true;
    messages = [question, { id: 'temp-ai-1', role: 'ai', content: '' }];
    render(<ChatView />);
    const line = screen.getByTestId('chat-status-line');
    expect(within(line).getByRole('status')).toHaveTextContent('preparingAnswer');
    expect(line).not.toHaveTextContent('thinking');
  });

  it('keeps the deep-search wait distinguishable', () => {
    loading = true;
    messages = [question, { id: 'temp-ai-1', role: 'ai', content: '', isDeepSearch: true }];
    render(<ChatView />);
    const line = screen.getByTestId('chat-status-line');
    expect(within(line).getByRole('status')).toHaveTextContent('searchingDeeper');
    expect(line).toHaveTextContent('searchingDeeper');
  });
});
