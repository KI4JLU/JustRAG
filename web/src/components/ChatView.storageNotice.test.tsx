import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatView } from './ChatView';
import type { Message, KnowledgeBase, KbCapabilities } from '../types';
import { UploadStorageNoticeDialog } from './UploadStorageNoticeDialog';
import { uploadChatAttachment } from '../utils/chatAttachments';

// The real ChatView with the real composer, mocked to the minimum — the same
// harness as ChatView.sourceRights.test.tsx. What is under test is the wiring:
// which composer uploads raise the storage notice the shell shows.

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
  useAuth: () => ({ user: { id: userId, role: 'user' }, siteConfigs: {} }),
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
// The upload itself is not under test: it resolves at once.
vi.mock('../utils/chatAttachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/chatAttachments')>()),
  uploadChatAttachment: vi.fn(async () => ({ id: 'uf1', name: 'notes.pdf', mime: 'application/pdf', size: 1, tokens: 1 })),
}));
vi.mock('../hooks/useKbAgents', () => ({
  useKbAgents: () => ({ agents: [], teams: [] }),
}));

let userId = 'u1';
let run = 0;
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

// jsdom's localStorage is unreliable on Node 25; the flag lives in this one.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return Array.from(this.data.keys())[i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(), configurable: true, writable: true,
  });
  // The shared flag is cached per key for the module's lifetime: one user per test.
  userId = `u${++run}`;
  capabilities = undefined;
  files = [{ id: 'f1', selected: true }];
  hasFiles = true;
  messages = [answer];
});

// PromptInput's hidden file input (a sibling of the form, named by the DS):
// the composer's + picks through it.
function pick(name = 'notes.pdf') {
  const input = screen.getByLabelText('Upload files') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type: 'application/pdf' })] } });
}

function dropOnComposer(name = 'notes.pdf') {
  const form = document.getElementById('chat-composer') as HTMLFormElement;
  const file = new File(['x'], name, { type: 'application/pdf' });
  fireEvent.drop(form, { dataTransfer: { files: [file], types: ['Files'] } });
}

// The shell's dialog, mounted beside the chat as AuthenticatedApp does.
const Shell = () => <><ChatView /><UploadStorageNoticeDialog /></>;
const raised = () => document.getElementById('upload-storage-notice') !== null;

const chips = () => document.getElementById('chat-composer-attachments');

// Oracle: card F-17 as refined by the developer — a file attached to the
// composer (picked or dropped) waits on the storage notice: nothing is
// uploaded before "Verstanden", and closing the notice takes the file out.
describe('ChatView — the storage notice before a composer upload', () => {
  beforeEach(() => vi.mocked(uploadChatAttachment).mockClear());

  it('asks for a file picked with the composer\'s +, uploading nothing yet', async () => {
    render(<Shell />);
    pick();
    await waitFor(() => expect(raised()).toBe(true));
    expect(chips()).toHaveTextContent('notes');
    expect(uploadChatAttachment).not.toHaveBeenCalled();
  });

  it('asks for a file dropped onto the composer', async () => {
    render(<Shell />);
    dropOnComposer();
    await waitFor(() => expect(raised()).toBe(true));
  });

  it('uploads the file once the notice is accepted', async () => {
    render(<Shell />);
    pick();
    await waitFor(() => expect(raised()).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'uploadStorageNoticeAccept' }));
    await waitFor(() => expect(uploadChatAttachment).toHaveBeenCalledTimes(1));
    expect(chips()).toHaveTextContent('notes');
  });

  it('takes the file out again when the notice is closed', async () => {
    render(<Shell />);
    pick();
    await waitFor(() => expect(raised()).toBe(true));
    fireEvent.keyDown(document.getElementById('upload-storage-notice') as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(raised()).toBe(false));
    await waitFor(() => expect(chips()).not.toBeInTheDocument());
    expect(uploadChatAttachment).not.toHaveBeenCalled();
  });

  it('does not ask before a file is attached', () => {
    render(<Shell />);
    expect(raised()).toBe(false);
  });
});
