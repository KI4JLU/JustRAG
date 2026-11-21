import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stubViewport } from '../test/viewport';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AppShell } from '@ki4jlu/design-system';
import { ChatView } from './ChatView';
import type { Message, KnowledgeBase, KbCapabilities } from '../types';

// The real ChatView with the real MessageBubble, mocked to the minimum —
// the same harness as ChatView.conflicts.test.tsx. What is under test is the
// wiring: which source rights ChatView hands to the answers and the composer,
// and which description the empty start page shows.

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
// The start page as the hook reports it: still loading unless a test says otherwise.
// A small store, so a test can let the answer arrive on a mounted ChatView.
let startPageState: { startPage: unknown; loading: boolean; shape?: unknown } = { startPage: null, loading: true };
const startPageListeners = new Set<() => void>();
const setStartPageState = (next: typeof startPageState) => {
  startPageState = next;
  startPageListeners.forEach(notify => notify());
};
vi.mock('../hooks/useKbStartPage', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useKbStartPage: () => useSyncExternalStore(
      (notify: () => void) => { startPageListeners.add(notify); return () => { startPageListeners.delete(notify); }; },
      () => startPageState,
    ),
  };
});

let capabilities: KbCapabilities | undefined;
let files: Array<{ id: string; selected?: boolean }> = [{ id: 'f1', selected: true }];
let hasFiles = true;
let filesLoaded = true;
// The open chat's id; null = a new chat (the start page).
let activeChatId: string | null = 'c1';
let kbOverrides: Partial<KnowledgeBase> = {};
const currentKb = (): KnowledgeBase => ({
  id: 'kb1', name: 'Handbuch', description: null, userId: 'someone-else',
  createdAt: '2026-01-01', isPro: false, isGlobal: false,
  aiConfigId: null, chatModel: null, embeddingModel: null, rerankModel: null, ttsModel: null,
  capabilities,
  ...kbOverrides,
});
const handlePdfSourceOpen = vi.fn();

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
      activeChatId,
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
      hasFiles, filesLoaded, selectedFileCount: 1, fileInputRef: { current: null },
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
  filesLoaded = true;
  activeChatId = 'c1';
  kbOverrides = {};
  startPageState = { startPage: null, loading: true };
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
  // The cited source is a tab of the shell's side panel, so the chat needs its frame.
  const renderInShell = () => render(
    <AppShell topBar={<span />} mobileTabs={[]} activeMobileTab="" onMobileTabChange={() => {}}>
      <ChatView />
    </AppShell>,
  );

  it('opens the cited source beside the answer, with the full view and download', () => {
    capabilities = caps({ downloadSources: true });
    const { container } = renderInShell();
    fireEvent.click(container.querySelector('button.citation-chip') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'openInSource' }));
    const panel = screen.getByRole('tabpanel', { name: 'satzung' });
    expect(panel).toHaveTextContent('sourcePanelPassagesOne');
    expect(screen.getByRole('button', { name: 'sourcePanelDownload' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sourcePanelFullView' }));
    expect(handlePdfSourceOpen).toHaveBeenCalledWith('f1', 'satzung.pdf', 2);
  });

  it('opens the panel without it, but offers neither the full view nor the download', () => {
    capabilities = caps({ downloadSources: false });
    const { container } = renderInShell();
    fireEvent.click(container.querySelector('button.citation-chip') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'openInSource' }));
    expect(screen.getByRole('tabpanel', { name: 'satzung' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'sourcePanelFullView' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'sourcePanelDownload' })).not.toBeInTheDocument();
  });
});

describe('ChatView — the side panel', () => {
  const renderInShell = () => render(
    <AppShell topBar={<span />} mobileTabs={[]} activeMobileTab="" onMobileTabChange={() => {}}>
      <ChatView />
    </AppShell>,
  );
  // The wide shell: the panel is a column there and can be maximised.
  beforeEach(() => { stubViewport(true); });
  afterEach(() => { vi.unstubAllGlobals(); });
  // jsdom is no Apple platform: the chord is Ctrl+Alt.
  const chord = (code: string) => fireEvent.keyDown(document, { code, ctrlKey: true, altKey: true });

  it('is hidden at rest, with its toggle in the bar', () => {
    renderInShell();
    expect(screen.queryByRole('complementary', { name: 'sidePanelLabel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sidePanelShow' })).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+B');
  });

  it('shows and hides on Ctrl+Alt+B', () => {
    renderInShell();
    chord('KeyB');
    expect(screen.getByRole('complementary', { name: 'sidePanelLabel' })).toBeInTheDocument();
    chord('KeyB');
    expect(screen.queryByRole('complementary', { name: 'sidePanelLabel' })).not.toBeInTheDocument();
  });

  it('opens maximised on Ctrl+Alt+F and restores on the next', () => {
    renderInShell();
    chord('KeyF');
    const panel = screen.getByRole('complementary', { name: 'sidePanelLabel' });
    expect(panel).toHaveAttribute('data-maximized');
    chord('KeyF');
    expect(screen.getByRole('complementary', { name: 'sidePanelLabel' })).not.toHaveAttribute('data-maximized');
  });

  it('ignores the letters without the chord', () => {
    renderInShell();
    fireEvent.keyDown(document, { code: 'KeyB' });
    fireEvent.keyDown(document, { code: 'KeyB', ctrlKey: true });
    expect(screen.queryByRole('complementary', { name: 'sidePanelLabel' })).not.toBeInTheDocument();
  });

  it('offers the citations from the empty panel and lists the answer\'s sources there', () => {
    capabilities = caps({ seeCitations: true });
    renderInShell();
    chord('KeyB');
    fireEvent.click(screen.getByRole('button', { name: /sidePanelCitations/ }));
    expect(screen.getByRole('tab', { name: 'sidePanelCitations' })).toHaveAttribute('aria-selected', 'true');
    const list = screen.getByRole('tabpanel', { name: 'sidePanelCitations' });
    expect(list).toHaveTextContent('satzung');
  });

  it('offers nothing to open without seeCitations', () => {
    capabilities = caps({ seeCitations: false });
    renderInShell();
    chord('KeyB');
    expect(screen.queryByRole('button', { name: /sidePanelCitations/ })).not.toBeInTheDocument();
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
  beforeEach(() => {
    messages = []; files = []; hasFiles = false; activeChatId = null;
    startPageState = { startPage: null, loading: false };
  });

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

  // Oracle: whether the topic is empty is known only with its file list;
  // before that neither the prompt nor the title block is shown, so neither
  // is swapped for the other.
  it('shows neither the prompt nor the title block before the file list is read', () => {
    capabilities = caps({ addSources: true });
    filesLoaded = false;
    const { container } = render(<ChatView />);
    expect(screen.queryByRole('heading', { name: /emptyAddFirstSourceTitle|Handbuch/ })).not.toBeInTheDocument();
    expect(container.querySelector('.empty-state')).toHaveAttribute('aria-busy', 'true');
  });
});

// Oracle: the start page has one title block, the Startseite's, with one
// description, the topic's own (else the default line). The legacy header text
// of a public topic is not shown there. How the page starts (input field, role
// cards, upload area) is known only with the start page: until it is read the
// page shows a skeleton and nothing the loaded page would take away again.
describe('ChatView — the start page shows one title block', () => {
  beforeEach(() => { messages = []; activeChatId = null; });

  // Oracle: a chat being opened has its id before its messages; that is not
  // a start page, so nothing is held back and the composer is in reach.
  it('does not hold a chat that is being opened', () => {
    activeChatId = 'c1';
    const { container } = render(<ChatView />);
    expect(container.querySelector('[data-slot="skeleton"], [data-slot="skeleton-text"]')).toBeNull();
    expect(document.getElementById('chat-composer')?.closest('[inert]')).toBeNull();
  });

  // A start page never set up, as GET /api/kb/{id}/start-page answers for it.
  const page = {
    version: 2, colors: null, startMode: 'input', uploadLabel: '', uploadInstruction: '', roleStarts: {}, roleEntries: [],
    questionsOn: false, questionMode: 'dynamic', dynamicCount: 4, fixedQuestions: [],
  };
  const loaded = (over: Record<string, unknown> = {}) => ({
    startPage: { kbId: 'kb1', configured: false, roles: [], activeRoleId: 'chat', category: null, page, ...over },
    loading: false,
  });

  it('shows no title block while the start page loads, only the skeleton', () => {
    const { container } = render(<ChatView />);
    // The title block is there as bars of its own text, hidden from readers.
    expect(screen.queryByRole('heading', { name: 'Handbuch' })).not.toBeInTheDocument();
    expect(screen.getByText('Handbuch').closest('[data-slot="skeleton-text"]')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.empty-state')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('shows the one title block once the start page is read', () => {
    const { container } = render(<ChatView />);
    act(() => setStartPageState(loaded()));
    expect(screen.getByRole('heading', { level: 2, name: 'Handbuch' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText('kbHeaderDefault')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"], [data-slot="skeleton-text"]')).toBeNull();
    expect(container.querySelector('.empty-state')).not.toHaveAttribute('aria-busy');
    // The answer did reach the view: its suggestions are there now.
    expect(screen.getAllByRole('button', { name: /Fasse die wichtigsten Punkte/, hidden: true })).toHaveLength(1);
  });

  // Oracle: while the page loads the composer is in place but unseen and out
  // of reach (inert), so nothing is typed or sent past a start that is not
  // known yet; a start with an upload area then takes it away without the
  // input start having been shown.
  it('keeps the composer unseen and inert while loading and hides it for an upload start', () => {
    render(<ChatView />);
    const composer = document.getElementById('chat-composer') as HTMLElement;
    expect(composer).toHaveClass('opacity-0');
    expect(composer.closest('[inert]')).not.toBeNull();
    act(() => setStartPageState(loaded({ configured: true, page: { ...page, roleStarts: { chat: { kind: 'file', text: 'Datei hochladen', send: false, instruction: '', suggestions: null } } } })));
    expect(composer).toHaveClass('hidden');
    expect(composer.closest('[inert]')).toBeNull();
    expect(screen.getByText('Datei hochladen')).toBeInTheDocument();
  });

  // Oracle: a start page already known (kept from the last visit) does not
  // put its upload area up while the file list is still unread — the skeleton
  // stands alone until both are known.
  it('holds a known upload start back until the file list is read', () => {
    filesLoaded = false;
    startPageState = {
      ...loaded({ configured: true, page: { ...page, roleStarts: { chat: { kind: 'file', text: 'Datei hochladen', send: false, instruction: '', suggestions: null } } } }),
      shape: { kind: 'upload', cards: 0 },
    };
    const { container } = render(<ChatView />);
    expect(screen.queryByText('Datei hochladen')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.input-container [data-slot="skeleton"]')).toHaveLength(1);
    expect(container.querySelector('.input-container')).toHaveAttribute('aria-busy', 'true');
  });

  // Oracle: listed documents that are not finished do not count as sources:
  // the file list decides, so the page waits for it.
  it('waits for the file list of a topic listed only with unfinished documents', () => {
    filesLoaded = false;
    kbOverrides = { fileCount: 2, processingFileCount: 1, failedFileCount: 1 };
    startPageState = loaded();
    const { container } = render(<ChatView />);
    expect(container.querySelector('.empty-state')).toHaveAttribute('aria-busy', 'true');
  });

  // Oracle: the skeleton has the shape the topic started with last time.
  it('holds role-card skeletons, not the composer, for a topic last seen with role cards', () => {
    startPageState = { startPage: null, loading: true, shape: { kind: 'cards', cards: 3 } };
    const { container } = render(<ChatView />);
    expect(document.getElementById('chat-composer')).toHaveClass('hidden');
    expect(container.querySelector('[data-slot="prompt-suggestions"]')).toBeNull();
    expect(container.querySelectorAll('.input-container [data-slot="skeleton"][class*="aspect-"]')).toHaveLength(3);
  });

  it('shows a topic listed with documents before its file list is read', () => {
    filesLoaded = false;
    kbOverrides = { fileCount: 3 };
    startPageState = loaded();
    render(<ChatView />);
    expect(screen.getByRole('heading', { level: 2, name: 'Handbuch' })).toBeInTheDocument();
  });

  // Oracle: the suggestions' place under the composer is taken from the first
  // render, so the centred page stands still: placeholders (a busy list with
  // nothing to pick) while the start page loads, the suggestions in that same
  // element once it is known.
  it('holds the suggestions\' place while the start page loads and fills it in place', () => {
    const { container } = render(<ChatView />);
    const slot = container.querySelector('[data-slot="prompt-suggestions"]');
    expect(slot).not.toBeNull();
    const list = within(slot as HTMLElement).getByRole('list', { hidden: true });
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(within(list).queryAllByRole('button', { hidden: true })).toHaveLength(0);
    act(() => setStartPageState(loaded()));
    expect(container.querySelector('[data-slot="prompt-suggestions"]')).toBe(slot);
    expect(list).not.toHaveAttribute('aria-busy');
    expect(within(list).queryAllByRole('button', { hidden: true }).length).toBeGreaterThan(0);
  });

  it('shows the default suggestions when the start page could not be read', () => {
    startPageState = { startPage: null, loading: false };
    render(<ChatView />);
    expect(screen.getAllByRole('button', { name: /Fasse die wichtigsten Punkte/, hidden: true })).toHaveLength(1);
  });

  it('shows the description and not the legacy header text of a public topic', () => {
    kbOverrides = { isGlobal: true, description: 'Angebote der Personalentwicklung', headerText: 'Alter Hinweistext' };
    startPageState = loaded();
    render(<ChatView />);
    expect(screen.getByText('Angebote der Personalentwicklung')).toBeInTheDocument();
    expect(screen.queryByText('Alter Hinweistext')).not.toBeInTheDocument();
  });
});
