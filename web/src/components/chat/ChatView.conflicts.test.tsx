import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatView } from './ChatView';
import type { Message, KnowledgeBase } from '../../types';

// Renders the real `ChatView` (not a stub) with a message carrying one
// conflict, clicks the real badge, and asserts the details panel opens. This
// covers the wiring of `conflictsOpen` from `ChatView` into `MessageBubble`:
// if a caller forgot to pass it, the badge would render but its click would do
// nothing — which a `MessageBubble`-only unit test cannot catch.
//
// `ChatView` is context-driven (no props) and pulls in four Kb*Context
// hooks. Everything below is mocked to the minimum needed to reach the
// message list without crashing; `useMessageSections` (the real caller-owned
// open-state store) and `MessageBubble` itself are left REAL, since the whole point is to exercise
// the actual wiring between them.
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    t: (key: string) => key,
    language: 'en' as const,
    theme: 'light' as const,
    toggleTheme: vi.fn(),
    setLanguage: vi.fn(),
  }),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user' }, siteConfigs: {} }),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock('../../contexts/MobileContext', () => ({
  // isMobile=true collapses most of ChatView's desktop-only chrome (theme/
  // language toggles, …) that this test has no reason to
  // exercise or mock further.
  useIsMobileContext: () => true,
}));
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
  getMotionProps: () => ({}),
}));
const currentKb: KnowledgeBase = {
  id: 'kb1', name: 'Handbuch', description: null, userId: 'someone-else',
  createdAt: '2026-01-01', isPro: false, isGlobal: false,
  aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
};

vi.mock('../../contexts/KbCoreContext', () => ({
  useKbCore: () => ({
    currentKb,
    availableConfigs: [],
    handleUpdateKBSettings: vi.fn(),
    scopedMindmapMessageId: undefined,
    onViewGraphForMessage: vi.fn(),
    onCloseMindmap: vi.fn(),
    onShowWholeKb: vi.fn(),
    kbMgmt: { handleRenameKB: vi.fn() },
  }),
}));

const conflictMessage: Message = {
  id: 'ai1',
  role: 'ai',
  content: 'Die Quellen widersprechen sich.',
  conflicts: [
    { claim: 'Beitragshöhe', sourceA: 1, sourceB: 2, kind: 'contradiction', newer: 'a', fileA: 'alt.md', fileB: 'neu.md' },
  ],
};

vi.mock('../../contexts/KbChatContext', () => ({
  useKbChat: () => ({
    chat: {
      activeChatId: 'c1',
      messageTree: new Map(),
      messages: [conflictMessage],
      activeLeafId: null,
      setActiveLeafId: vi.fn(),
      editingMessageId: null,
      setEditingMessageId: vi.fn(),
      setForkPointId: vi.fn(),
      userMessageInput: '',
      setUserMessageInput: vi.fn(),
      loading: false,
      textareaRef: { current: null },
      handleFollowUpClick: vi.fn(),
      handleStartEdit: vi.fn(),
      handleEditSubmit: vi.fn(),
      handleForkFromMessage: vi.fn(),
      handleRegenerate: vi.fn(),
      handleFeedback: vi.fn(),
      handleSendMessage: (e: { preventDefault: () => void }) => e.preventDefault(),
      fetchChats: vi.fn(),
      loadedResearchSession: null,
      setLoadedResearchSession: vi.fn(),
      loadedAcademicSession: null,
      setLoadedAcademicSession: vi.fn(),
    },
    enhance: null,
    setEnhance: vi.fn(),
    reasoningEnabled: false,
    setReasoningEnabled: vi.fn(),
  }),
}));

vi.mock('../../contexts/KbDataContext', () => ({
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
    rssLoading: false,
    confluenceLoading: false,
    confluenceSources: [],
  }),
}));

vi.mock('../../contexts/KbLayoutContext', () => ({
  useKbLayout: () => ({
    sidebar: { setIsRightSidebarOpen: vi.fn(), setIsLeftSidebarOpen: vi.fn() },
  }),
}));

describe('ChatView — conflicting-sources badge (main chat surface)', () => {
  it('opens the conflicts details panel from the real ChatView', async () => {
    const user = userEvent.setup();
    render(<ChatView />);

    const badge = screen.getByLabelText('conflictsBadge');
    expect(badge).toHaveAttribute('aria-expanded', 'false');

    await user.click(badge);

    expect(badge).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('alt.md vs. neu.md')).toBeInTheDocument();
  });
});
