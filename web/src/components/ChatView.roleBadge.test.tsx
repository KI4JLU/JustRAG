import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatView } from './ChatView';
import type { Message, KnowledgeBase, KbCapabilities } from '../types';
import type { KbStartPageData } from '../hooks/useKbStartPage';
import type { StartPage } from './kbSettings/assistant/api';
import type { RoleView } from './kbSettings/assistant/roleModel';

// The real ChatView on the harness of ChatView.storageNotice.test.tsx. Under
// test: where the chat names its role — the badge over a chat, and the title
// block of the start page.

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({
    t: (key: string) => ({ asstRoleBadge: 'Rolle: {role}' } as Record<string, string>)[key] ?? key,
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
let startPage: KbStartPageData | null = null;
vi.mock('../hooks/useKbStartPage', () => ({
  useKbStartPage: () => ({ startPage, loading: false }),
}));
vi.mock('../hooks/useStarterQuestions', () => ({
  useStarterQuestions: () => ({ questions: [], loading: false }),
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
let chatRoleId: string | null = null;

vi.mock('../contexts/KbCoreContext', () => ({
  useKbCore: () => ({
    currentKb: currentKb(),
    availableConfigs: [],
    handleUpdateKBSettings: vi.fn(),
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
      chatRoleId,
      roleStart: null,
      startRoleChat: vi.fn(),
      handleNewChat: vi.fn(),
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

const role = (id: string, name: string): RoleView => ({ id, name, description: '', prompt: '' } as RoleView);
const page = (patch: Partial<StartPage> = {}): StartPage => ({
  version: 1, colors: { from: '#0056B3', to: '#3897E8' }, startMode: 'input',
  questionsOn: false, questionMode: 'dynamic', dynamicCount: 4, fixedQuestions: [],
  uploadLabel: '', uploadInstruction: '',
  roleStarts: {},
  roleEntries: [],
  ...patch,
});
const start = (patch: Partial<StartPage> = {}): KbStartPageData => ({
  kbId: 'kb1', page: page(patch), configured: true,
  roles: [role('chat', 'Assistent'), role('tutor', 'Tutor')],
  activeRoleId: 'chat', category: null,
});

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(), configurable: true, writable: true,
  });
  userId = `u${++run}`;
  capabilities = undefined;
  files = [{ id: 'f1', selected: true }];
  hasFiles = true;
  messages = [answer];
  chatRoleId = null;
  startPage = start();
});

// Oracle: developer, 18.11.2026 — every chat names its role, the KB's default
// one included and also when the KB offers only one; a start page with a
// single role names it under its description.
describe('the chat names its role', () => {
  it('shows the active role over a chat started without a role', () => {
    render(<ChatView />);
    expect(screen.getByText('Rolle: Assistent')).toBeTruthy();
  });

  it('shows the role a chat was started in', () => {
    chatRoleId = 'tutor';
    render(<ChatView />);
    expect(screen.getByText('Rolle: Tutor')).toBeTruthy();
    expect(screen.queryByText('Rolle: Assistent')).toBeNull();
  });

  it('says so when the chat\'s role is gone', () => {
    chatRoleId = 'deleted';
    render(<ChatView />);
    expect(screen.getByText('asstRoleDeleted')).toBeTruthy();
    expect(screen.queryByText(/^Rolle: /)).toBeNull();
  });

  it('names a single role in the start page\'s title block', () => {
    messages = [];
    render(<ChatView />);
    expect(screen.getAllByText('Rolle: Assistent')).toHaveLength(1);
  });

  it('leaves the naming to the cards when the start page offers several roles', () => {
    messages = [];
    startPage = start({ roleEntries: [{ id: 're-1', roleId: 'tutor' }] });
    render(<ChatView />);
    expect(screen.queryByText(/^Rolle: /)).toBeNull();
  });

  it('names the role once while a chat started in a role has no messages yet', () => {
    messages = [];
    chatRoleId = 'tutor';
    render(<ChatView />);
    expect(screen.getAllByText(/^Rolle: /)).toHaveLength(1);
    expect(screen.getByText('Rolle: Tutor')).toBeTruthy();
  });

  it('shows no role where the KB has no start page', () => {
    startPage = null;
    render(<ChatView />);
    expect(screen.queryByText(/^Rolle: /)).toBeNull();
  });
});
