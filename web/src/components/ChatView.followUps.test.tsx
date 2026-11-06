import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatView } from './ChatView';
import type { Message, KnowledgeBase } from '../types';

// The latest answer's follow-up questions render on the composer, not inside
// the answer. Harness: ChatView.conflicts.test.tsx.
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
  // language toggles, …) that this test has no reason to
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

const currentKb: KnowledgeBase = {
  id: 'kb1', name: 'Handbuch', description: null, userId: 'someone-else',
  createdAt: '2026-01-01', isPro: false, isGlobal: false,
  aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
};

vi.mock('../contexts/KbCoreContext', () => ({
  useKbCore: () => ({
    currentKb,
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

const followUpMessage: Message = {
  id: 'ai1',
  role: 'ai',
  content: 'Die Frist beträgt vier Wochen.',
  followUpQuestions: ['Kann ich die Frist verlängern?', 'Wo stelle ich den Antrag?'],
};
const handleFollowUpClick = vi.fn();

vi.mock('../contexts/KbChatContext', () => ({
  useKbChat: () => ({
    chat: {
      activeChatId: 'c1',
      messageTree: new Map(),
      messages: [followUpMessage],
      activeLeafId: null,
      comparisonMode: false,
      comparisonLeafId: null,
      setComparisonMode: vi.fn(),
      setComparisonLeafId: vi.fn(),
      setActiveLeafId: vi.fn(),
      editingMessageId: null,
      setEditingMessageId: vi.fn(),
      setForkPointId: vi.fn(),
      userMessageInput: '',
      setUserMessageInput: vi.fn(),
      loading: false,
      textareaRef: { current: null },
      handleFollowUpClick,
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
      hasFiles: true, selectedFileCount: 1, fileInputRef: { current: null },
      isDragging: false, handleDragOver: vi.fn(), handleDragEnter: vi.fn(),
      handleDragLeave: vi.fn(), handleDrop: vi.fn(), files: [],
    },
    webTools: {
      handlePreviewSource: vi.fn(), handlePdfSourceOpen: vi.fn(), setToolTab: vi.fn(),
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

describe('ChatView — follow-up questions', () => {
  it('shows the latest answer\'s follow-ups above the composer, outside the answer, and sends one on click', async () => {
    const user = userEvent.setup();
    const { container } = render(<ChatView />);

    const followUps = screen.getByTestId('follow-ups');
    expect(followUps).toHaveTextContent('followUpsLabel');
    expect(followUps.closest('.transcript-row')).toBeNull();
    const composer = container.querySelector('#chat-composer')!;
    expect(followUps.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Wo stelle ich den Antrag?' }));
    expect(handleFollowUpClick).toHaveBeenCalledWith('Wo stelle ich den Antrag?');
  });
});
