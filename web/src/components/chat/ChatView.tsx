import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain, ArrowUp, ArrowLeft,
  X, Check, Pencil,
  Globe, WandSparkles, Loader2, FileText, Quote,
} from 'lucide-react';
import type { Message } from '../../types';
import { chatPlaceholderFor } from '../../utils/systemNames';
import { useTheme } from '../../contexts/ThemeContext';
import { IS_APPLE } from '../../utils/searchShortcut';
import { useAuth } from '../../contexts/AuthContext';
import { useKbCore } from '../../contexts/KbCoreContext';
import { useKbChat } from '../../contexts/KbChatContext';
import { useKbData } from '../../contexts/KbDataContext';
import { KbSettingsDialog } from '../topics/KbSettingsDialog';
import { useKbLayout } from '../../contexts/KbLayoutContext';
import { useStarterQuestions } from '../../hooks/useStarterQuestions';
import { useAutoScrollEnabled, useFollowUpsEnabled, usePromptSuggestionsEnabled, useChatWidth } from '../../hooks/useChatSuggestionPrefs';
import { messageSectionKey, useMessageSections } from '../../hooks/useMessageSections';
import { hasAgentSteps } from '../agentSteps/buildSteps';
import { ComposerUploadSync, useComposerUploads } from '../../hooks/useComposerUploads';
import { useUploadStorageNotice } from '../../hooks/useUploadStorageNotice';
import { useKbStartPage } from '../../hooks/useKbStartPage';
import { RoleStartCards, START_SKELETON_DELAY, StartBlockSkeleton, StartGlow, TitleCard, UploadStart } from '../kbSettings/assistant/StartPageParts';
import { activeTaskStart, pageMode, pageQuestions, showsGeneratedQuestions, soleRoleName, startEntries, startOf, suggestionQuestions, taskModeEntry } from '../kbSettings/assistant/startPageModel';
import { toMessageAttachments } from '../../utils/chatAttachments';
import { useComposerNotch } from '../../hooks/useComposerNotch';
import { useToast } from '../../contexts/ToastContext';
import { STORAGE_NAMESPACE } from '../../hooks/useStoredFlag';
import {
  InputGroupAddon,
  ChatStage, ChatStageColumn, Skeleton, SkeletonText, PromptInput, PromptInputAdaptiveTextarea, PromptSuggestions, PromptInputButton, PromptInputSubmit,
  PromptInputActionMenu, PromptInputActionMenuTrigger, PromptInputActionMenuContent, PromptInputActionMenuItem, PromptInputActionAddAttachments,
  PromptInputAttachments, PromptInputAttachment, usePromptInputAttachments, Badge, Notice,
  DropdownMenuLabel, DropdownMenuSeparator, Tooltip, TooltipTrigger, TooltipContent,
  Spinner, Button, AppShellSidePanel, usePersistedWidth,
  MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton,
} from '@ki4jlu/design-system';
import MessageBubble from './MessageBubble';
import { HAPTIC_PATTERNS, triggerHaptic } from '../../utils/haptics';
import { canOpenKbTopicSettings, chatSourceSelection, kbSourceRights } from '../../utils/kbAccess';
import { sourceFlagsOf, sourceFlagsPatch } from '../../utils/kbRoleRights';
import { isChatWebSearchAvailable } from '../../utils/chatWebSearch';
import { API_BASE_URL, authFetch } from '../../api';
import { SourcePanel } from '../sources/SourcePanel';
import { CitationsPanel } from '../sources/CitationsPanel';
import { SourcePanelContext, type SourcePanelApi, type SourcePanelTarget } from '../../contexts/SourcePanelContext';
import { formatDaySeparator, sameLocalDay } from '../../utils/chatDates';
import type { PdfFocus } from '../../utils/passageMarks';


// Attaches a DOM element to a ref owned by useChat (textareaRef). Done in a module-level helper so the `.current` write — and
// the ref-typed property itself — stay opaque to the React Compiler lint:
// a direct `ref={chat.xRef}` makes it treat the whole `chat` hook result as
// ref-carrying and flag every render-time `chat.*` read.
function attachHookRef<T>(target: unknown, el: T | null) {
  if (!target) return;
  (target as React.MutableRefObject<T | null>).current = el;
}

// The chat's side panel. Its tab kinds: the source list and a cited source
// (a browser is to follow). Its width is
// remembered per device, like the navigation's (useSidebarResize).
const CITATION_TAB = 'citation';
const CITATIONS_TAB = 'citations';
const SIDE_PANEL_CHORD = IS_APPLE ? 'Meta+Alt' : 'Control+Alt';
const isSidePanelChord = (e: KeyboardEvent) =>
  e.altKey && !e.shiftKey && (IS_APPLE ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
const SIDE_PANEL_WIDTH_KEY = `${STORAGE_NAMESPACE}kb.sidepanel.width`;
const SIDE_PANEL_BOUNDS = { min: 360, max: 900, default: 480 } as const;


/**
 * Inside the composer: reports how many files are attached and hands out the
 * composer's `add`, so the upload-only start (a dropzone shown instead of
 * the composer) can attach the first file to it. Newly attached files go to
 * `onAdded` with a way to take them out again (the storage notice declined).
 */
function ComposerAttachmentsBridge({ addRef, onCount, onAdded }: {
  addRef: React.MutableRefObject<((files: File[]) => void) | null>;
  onCount: (n: number) => void;
  onAdded: (drop: () => void) => void;
}) {
  const { files, add, remove } = usePromptInputAttachments();
  const seen = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => { addRef.current = (f) => add(f); }, [add, addRef]);
  useEffect(() => { onCount(files.length); }, [files.length, onCount]);
  useEffect(() => {
    const added = files.filter(f => !seen.current.has(f.id)).map(f => f.id);
    seen.current = new Set(files.map(f => f.id));
    if (added.length > 0) onAdded(() => added.forEach(remove));
  }, [files, onAdded, remove]);
  return null;
}

// Stands in for the composer's upload sync while the storage notice is unanswered.
const holdComposerUploads = () => {};

const ChatViewComp = () => {
  const { language, t } = useTheme();
  const { user, siteConfigs } = useAuth();
  const chatPlaceholder = chatPlaceholderFor(t('chatPlaceholder'), siteConfigs);

  const {
    currentKb, availableConfigs, handleUpdateKBSettings,
  } = useKbCore();
  const {
    chat, reasoningEnabled, setReasoningEnabled,
    webSearchEnabled: webSearch, setWebSearchEnabled: setWebSearch,
  } = useKbChat();
  const { fileMgmt, webTools } = useKbData();
  const toast = useToast();
  // Composer files are uploaded as chat attachments as soon as they are attached.
  const composerUploads = useComposerUploads(currentKb?.id, t, language);
  // Per-turn web search is offered only when the admin gate is on; a state
  // left over from when it was on shows nothing (and is not sent, see
  // AuthenticatedApp).
  const webSearchAvailable = isChatWebSearchAvailable(siteConfigs);
  const webSearchOn = webSearchAvailable && webSearch;
  const { systemPromptOpen: showSystemPrompt, setSystemPromptOpen: setShowSystemPrompt, systemPromptSection, setSystemPromptSection } = useKbLayout();

  // Improve the UNSENT draft in place (rewrite / expand / spell) via
  // POST /api/enhance, so the user can revise before sending. The old
  // behaviour — flagging the message and letting the chat stream enhance it
  // after send — is no longer driven from the composer; `enhance` in
  // KbChatContext stays null and the stream sends it as such.
  const [enhancing, setEnhancing] = useState<'rewrite' | 'expand' | 'spell' | null>(null);
  const handleEnhanceDraft = useCallback(async (mode: 'rewrite' | 'expand' | 'spell') => {
    const kbId = currentKb?.id;
    const draft = chat.userMessageInput.trim();
    if (!draft || enhancing) return;
    setEnhancing(mode);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: draft, type: mode, kbId, language }),
      });
      if (!res.ok) throw new Error(`enhance failed: ${res.status}`);
      const data = await res.json() as { enhanced?: string };
      if (data.enhanced?.trim()) chat.setUserMessageInput(data.enhanced.trim());
      chat.textareaRef.current?.focus();
    } catch (err) {
      console.error('Draft enhancement failed:', err);
    } finally {
      setEnhancing(null);
    }
  }, [chat, currentKb, enhancing, language]);

  // The composer's notch around its two control groups (useComposerNotch).
  const { notch, observeNotch } = useComposerNotch();

  // The "Berechtigungen" draft: the KB's source flags, reset whenever the KB
  // (or its stored flags) changes — during render with a prev-comparison
  // instead of an effect, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const savedFlags = sourceFlagsOf(currentKb);
  const flagsResetKey = `${currentKb?.id ?? ''}\0${JSON.stringify(savedFlags)}`;
  const [flagsDraft, setFlagsDraft] = useState(savedFlags);
  /* Fresh drafts on every opening of Thema-Einstellungen. The dialog lives in
     the URL (`?topic=`), so it can also close without its onClose — browser
     back, a navigation — and edits abandoned that way must not reappear as
     unsaved changes next time. Adjusted during render, so the dialog never
     shows them even for one commit. */
  const [promptWasOpen, setPromptWasOpen] = useState(showSystemPrompt);
  if (promptWasOpen !== showSystemPrompt) {
    setPromptWasOpen(showSystemPrompt);
    if (showSystemPrompt) setFlagsDraft(savedFlags);
  }
  const [prevFlagsResetKey, setPrevFlagsResetKey] = useState(flagsResetKey);
  if (prevFlagsResetKey !== flagsResetKey) {
    setPrevFlagsResetKey(flagsResetKey);
    setFlagsDraft(savedFlags);
  }

  // System prompt: owners and KB admins (the gear in the chrome bar,
  // AppFrame, uses the same predicate).
  const canEditSystemPrompt = !!currentKb && canOpenKbTopicSettings(currentKb, user?.role, user?.id);

  const {
    hasFiles, filesLoaded, selectedFileCount,
  } = fileMgmt;
  // What the caller may do with the KB's sources (backend capabilities).
  // Opening a source from an answer is the in-app preview, so the two open
  // handlers go to the answers only with previewSources; the download stays
  // with downloadSources; citations need seeCitations.
  const sourceRights = kbSourceRights(currentKb, user?.role, user?.id);
  const { handlePreviewSource: previewSource, handlePdfSourceOpen: pdfSourceOpen } = webTools;
  const handlePreviewSource = sourceRights.previewSources ? previewSource : undefined;
  // Stable, so the memoised message bubbles do not re-render with every chat render.
  const openPdfWithMarks = useCallback(
    (fileId: string, fileName: string, page: number, focus?: PdfFocus) => pdfSourceOpen(fileId, fileName, page, undefined, focus),
    [pdfSourceOpen],
  );
  const handlePdfSourceOpen = sourceRights.previewSources ? openPdfWithMarks : undefined;

  // No-sources state for a non-global KB: drives the §7 acquisition empty state
  // and dims the composer until the user adds a first source.
  // Only once this KB's file list has arrived: before that it is unknown, and
  // flashing the onboarding for a split second on every KB open was the bug.
  // A caller who may not see the source list (capabilities.seeSources off) gets
  // an empty list from a 403 — that is not "this KB has no sources".
  const noSources = sourceRights.seeSources && filesLoaded && !hasFiles && !currentKb?.isGlobal;
  // What a turn sends about the selection, and whether it can go at all.
  const sourceSelection = chatSourceSelection(currentKb, fileMgmt.files);
  // Starter prompts under the composer of an empty chat: the global KB's own,
  // then the site's, then the built-in pair.
  // Generated from the KB's documents, only while an empty chat can use them.
  // User settings (Einstellungen → Chat): suggestions, follow-ups and autoscroll on/off.
  const [suggestionsEnabled] = usePromptSuggestionsEnabled();
  const [followUpsEnabled] = useFollowUpsEnabled();
  // The latest answer's follow-up questions sit on the composer, not under
  // the answer.
  const lastMessage = chat.messages[chat.messages.length - 1];
  const followUps = followUpsEnabled && !chat.loading && lastMessage?.role === 'ai' ? lastMessage.followUpQuestions ?? [] : [];
  const [autoScrollEnabled] = useAutoScrollEnabled();
  const [chatWidth] = useChatWidth();
  // The line under the title: the topic's own description, else the default line.
  const shownDescription = currentKb?.description?.trim() || t('kbHeaderDefault');
  // The assistant settings' start page; re-read whenever the settings dialog closes.
  const { startPage, loading: startPageLoading, shape: startShape } = useKbStartPage(currentKb?.id, showSystemPrompt);
  const configuredStart = startPage?.configured ? startPage : null;
  // How an empty chat starts — the input field, role cards, an upload area or
  // the first-source prompt — is known only once the start page and the file
  // list are read. Until then the page holds a skeleton instead of showing
  // one start and swapping it for another: the title block as bars of its own
  // text, and below it the shape this topic started with on the last visit
  // (the input field's if never seen).
  // Whether the first-source prompt will show is known with the file list —
  // or without it, where the prompt cannot show (no source list, a global
  // topic) or the topic is listed with finished documents.
  const listedReady = (currentKb?.fileCount ?? 0) - (currentKb?.failedFileCount ?? 0) - (currentKb?.processingFileCount ?? 0);
  const sourcesKnown = filesLoaded || !sourceRights.seeSources || !!currentKb?.isGlobal || listedReady > 0;
  // Not a chat being opened (it has its id before its messages): that is no start page.
  const startPending = !!currentKb && chat.messages.length === 0 && !chat.roleStart && !chat.activeChatId && (startPageLoading || !sourcesKnown);
  // The pending composer takes no input, so the caret an opened chat puts
  // there is set once the start is known and the input field is what it shows.
  const wasPendingRef = useRef(false);
  const { textareaRef: promptRef } = chat;
  useEffect(() => {
    if (startPending) {
      wasPendingRef.current = true;
      return;
    }
    if (!wasPendingRef.current) return;
    wasPendingRef.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: fine)').matches) return;
    promptRef.current?.focus();
  }, [startPending, promptRef]);
  // Without documents (as read, else as listed): the first-source prompt is what will load.
  const pendingEmpty = startPending && sourceRights.seeSources && !currentKb?.isGlobal && (filesLoaded ? !hasFiles : currentKb?.fileCount === 0);
  const pendingBlock = startPending && !pendingEmpty && startShape && startShape.kind !== 'input' ? startShape : null;
  // How the chat starts is the roles' (developer ruling 05.11.2026): with
  // further role cards „Rollenauswahl", else the active role's own start —
  // the input field, its role-prompt card or its upload area.
  const startMode = startPage ? pageMode(startPage.page, startPage.activeRoleId, startPage.roles) : 'input';
  const activeStart = startPage ? startOf(startPage.page, startPage.activeRoleId, startPage.roles) : null;
  const activeRoleName = startPage?.roles.find(r => r.id === startPage.activeRoleId)?.name ?? t('asstAssistant');
  // „Anweisung": the active role's card with its start prompt, alone.
  const taskStart = startPage && !chat.roleStart ? activeTaskStart(startPage.page, startPage.activeRoleId, startPage.roles) : null;
  // Generated questions cost a model call, so they are asked for only once the
  // start page is known and only where they will be shown: a role card's
  // input start, the active role's, or a page never set up — each with
  // dynamic questions on.
  const wantsGenerated = !!startPage && (configuredStart || chat.roleStart ? showsGeneratedQuestions(chat.roleStart, activeStart) : true);
  // For the role the chat starts in: a role card's, else the active role.
  const { questions: generatedPrompts, loading: generatedLoading } = useStarterQuestions(currentKb?.id, language, suggestionsEnabled && wantsGenerated && chat.messages.length === 0 && hasFiles, chat.roleStart?.roleId ?? undefined);
  const [composerFileCount, setComposerFileCount] = useState(0);
  const composerAddRef = useRef<((files: File[]) => void) | null>(null);
  // While the start is pending none of its gates is up: the skeleton stands alone.
  const emptyChat = chat.messages.length === 0 && !noSources && !startPending;
  // „Rollenauswahl": the role cards stand in for the composer until one is picked.
  const rolesGate = startMode === 'roles' && emptyChat && !chat.roleStart;
  // „Anweisung": its card stands in for the composer the same way.
  const taskGate = !!taskStart && emptyChat;
  // The upload area stands in for the composer until the first file is attached:
  // the upload-only start's, or a file card's.
  const fileCard = chat.roleStart?.kind === 'file' ? chat.roleStart : null;
  const uploadStart: { title: string; message: string } | null = !emptyChat || composerFileCount > 0 ? null
    : fileCard ? {
      // The role start's own label, else the default naming the role.
      title: fileCard.text.trim() || t('asstFileDropTitle').replace('{role}', startPage?.roles.find(r => r.id === (fileCard.roleId ?? startPage.activeRoleId))?.name ?? t('asstAssistant')),
      message: fileCard.instruction.trim() || t('asstFileDefaultMessage'),
    }
      // The active role starting with a file: its upload area, as its card's.
      : startMode === 'upload' && activeStart && !chat.roleStart ? {
        title: activeStart.text.trim() || t('asstFileDropTitle').replace('{role}', activeRoleName),
        message: activeStart.instruction.trim() || t('asstFileDefaultMessage'),
      }
        : null;
  const uploadGate = !!uploadStart;
  // A file attached through the upload area goes out at once with the
  // instruction (or the default text) as the first message, once uploaded.
  // `autoSendRef` holds that message until then; the submit handler takes it.
  const autoSendRef = useRef<string | null>(null);
  const autoSendNowRef = useRef<string | null>(null);
  const { uploads: composerUploadStates, readiness: composerReadiness } = composerUploads;
  // Until the user has accepted the notice on how long uploads are kept, a
  // file attached to the composer (picked, dropped, or put in the upload area)
  // waits on it: nothing goes to the server, and closing the notice without
  // accepting takes the file out again.
  const storageNotice = useUploadStorageNotice(user?.id ?? '', 'chat');
  const { confirm: confirmStorageNotice } = storageNotice;
  const onComposerFilesAdded = useCallback((drop: () => void) => {
    void confirmStorageNotice().then((ok) => {
      if (ok) return;
      autoSendRef.current = null;
      drop();
    });
  }, [confirmStorageNotice]);
  const syncComposerUploads = storageNotice.accepted ? composerUploads.sync : holdComposerUploads;
  useEffect(() => {
    if (!autoSendRef.current || composerFileCount === 0) return;
    const ready = composerReadiness();
    // Wait until the file is on the server; a refused upload stays in the
    // composer (it shows why) and nothing is sent.
    if (ready.uploading || (!ready.failed && !ready.uploaded.length)) return;
    const message = autoSendRef.current;
    autoSendRef.current = null;
    if (ready.failed) return;
    autoSendNowRef.current = message;
    (document.getElementById('chat-composer') as HTMLFormElement | null)?.requestSubmit?.();
  }, [composerFileCount, composerUploadStates, composerReadiness]);
  // What answers in the chat, named in its badge: the role it was started in,
  // else the KB's active role.
  const chatRole = chat.chatRoleId ? startPage?.roles.find(r => r.id === chat.chatRoleId) : undefined;
  const chatRoleName = chat.chatRoleId
    ? chatRole?.name
    : startPage?.roles.find(r => r.id === startPage.activeRoleId)?.name;
  const examplePrompts = useMemo(() => {
    // A chat started from a role card that opens the input field: that card's suggestions.
    if (chat.roleStart) return chat.roleStart.kind === 'input' ? suggestionQuestions(chat.roleStart.suggestions, generatedPrompts) : [];
    // While the start page loads, none: the fallback list below would show
    // (hidden while it reveals, but taking its space) and vanish again once a
    // set-up page answers with its own. A failed read falls through to it.
    if (startPending) return [];
    // A start page set up: the active role's questions under its input field, if on.
    if (configuredStart) return pageQuestions(configuredStart.page, configuredStart.activeRoleId, configuredStart.roles, generatedPrompts);
    const raw = currentKb?.isGlobal ? currentKb.examplePrompts : null;
    const prompts = raw
      ? raw.split('\n')
      : ['Fasse die wichtigsten Punkte meiner Dokumente zusammen', 'Was sind die wichtigsten Erkenntnisse in {topic}?'];
    // `{topic}` stands for the open topic's name, in configured prompts too.
    const configured = prompts.map(p => p.replaceAll('{topic}', `„${currentKb?.name ?? ''}“`));
    // Then the questions generated from the KB's documents, without repeats.
    const seen = new Set(configured.map(p => p.trim().toLowerCase()));
    return [...configured, ...generatedPrompts.filter(q => !seen.has(q.trim().toLowerCase()))];
  }, [startPending, chat.roleStart, configuredStart, currentKb?.isGlobal, currentKb?.examplePrompts, currentKb?.name, generatedPrompts]);

  const [initialRender, setInitialRender] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setInitialRender(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  // Expand state for the height-changing answer sections, held above the
  // transcript so it survives the scroller remount on chat switch.
  const messageSections = useMessageSections();

  // „In Quelle öffnen": one cited source beside the answers, closed again
  // whenever another chat's transcript is loaded.
  const [sourcePanelTarget, setSourcePanelTarget] = useState<SourcePanelTarget | null>(null);
  // The chat's side panel (set up below): whether it is shown, its open
  // tabs in strip order, and the shown one.
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelMaximized, setSidePanelMaximized] = useState(false);
  const [sideTabs, setSideTabs] = useState<string[]>([]);
  const [activeSideTab, setActiveSideTab] = useState<string | null>(null);
  const [panelTranscriptKey, setPanelTranscriptKey] = useState(chat.transcriptKey);
  if (panelTranscriptKey !== chat.transcriptKey) {
    setPanelTranscriptKey(chat.transcriptKey);
    // The cited source belongs to that transcript; the citation list
    // follows the chat and stays.
    setSourcePanelTarget(null);
    const rest = sideTabs.filter(tab => tab !== CITATION_TAB);
    if (rest.length !== sideTabs.length) {
      setSideTabs(rest);
      if (activeSideTab === CITATION_TAB) setActiveSideTab(rest[rest.length - 1] ?? null);
      if (rest.length === 0) setSidePanelOpen(false);
    }
  }
  // The side panel beside the chat (the shell's AppShellSidePanel): a cited
  // source is a tab in it. Its toggle hides the panel and keeps the tab;
  // closing the tab hides the panel, as closing the last tab does.
  const [sidePanelWidth, setSidePanelWidth] = usePersistedWidth(SIDE_PANEL_WIDTH_KEY, {
    defaultWidth: SIDE_PANEL_BOUNDS.default, minWidth: SIDE_PANEL_BOUNDS.min, maxWidth: SIDE_PANEL_BOUNDS.max,
  });
  const showSideTab = useCallback((id: string) => {
    setSideTabs(prev => (prev.includes(id) ? prev : [...prev, id]));
    setActiveSideTab(id);
    setSidePanelOpen(true);
  }, [setActiveSideTab, setSidePanelOpen]);
  // The tab that takes a closed one's place becomes active; closing the
  // last one hides the panel.
  const closeSideTab = useCallback((id: string) => {
    const index = sideTabs.indexOf(id);
    if (index < 0) return;
    const rest = sideTabs.filter(tab => tab !== id);
    setSideTabs(rest);
    if (id === CITATION_TAB) setSourcePanelTarget(null);
    if (id === activeSideTab) setActiveSideTab(rest[Math.min(index, rest.length - 1)] ?? null);
    if (rest.length === 0) setSidePanelOpen(false);
  }, [sideTabs, activeSideTab, setSourcePanelTarget, setActiveSideTab, setSidePanelOpen]);
  // ⌥⌘B (Ctrl+Alt+B) shows and hides the side panel, ⌥⌘F maximises it.
  // By `code`: with ⌥ held, macOS reports another character as `key`.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSidePanelChord(e)) return;
      if (e.code === 'KeyB') {
        e.preventDefault();
        setSidePanelOpen(open => !open);
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        setSidePanelOpen(true);
        setSidePanelMaximized(max => !max);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  const sourcePanelApi = useMemo<SourcePanelApi>(() => ({
    target: sourcePanelTarget,
    open: (target) => { setSourcePanelTarget(target); showSideTab(CITATION_TAB); },
    close: () => closeSideTab(CITATION_TAB),
  }), [sourcePanelTarget, showSideTab, closeSideTab, setSourcePanelTarget]);
  const sourcePanelFile = sourcePanelTarget?.source.fileId
    ? fileMgmt.files.find(f => f.id === sourcePanelTarget.source.fileId)
    : undefined;

  const handleEditCancel = useCallback(() => chat.setEditingMessageId(null), [chat]);

  return (
    <SourcePanelContext.Provider value={sourcePanelApi}>
    {/* ChatStage straight in the shell's <main>: the side panel renders into
        the shell's own column (AppShellSidePanel), the settings dialog into a portal. */}
    <>
                {/* DS ChatStage: an empty chat centres the empty state and the composer
                    together; with messages the composer docks and the disclaimer stays
                    pinned to the bottom either way. */}
                <ChatStage
                  // relative isolate: the start page's glow fills the stage, behind the content.
                  className="relative isolate"
                  width={chatWidth}
                  empty={chat.messages.length === 0}
                  footerId="chat-disclaimer"
                  footer={t('chatFooter')}
                  // The chat's role — for the whole chat, also when reopened from the history.
                  // The start page itself names it in its title block (a single role) or on its
                  // cards. The stage's header row: it stays on the column's centre axis when the
                  // sources card opens.
                  header={((startPage && (chat.chatRoleId || (chat.roleStart && chat.messages.length === 0))) || (chat.messages.length > 0 && chatRoleName)) ? (
                    <>
                      {chat.roleStart && chat.messages.length === 0 && (
                        <Button variant="ghost" size="sm" onClick={chat.handleNewChat}>
                          <ArrowLeft className="size-4" aria-hidden="true" /> {t('asstBackToStart')}
                        </Button>
                      )}
                      {chatRoleName ? (
                        <Badge tone="primary">{t('asstRoleBadge').replace('{role}', chatRoleName)}</Badge>
                      ) : chat.chatRoleId ? (
                        <Notice tone="neutral" className="max-w-xl">{t('asstRoleDeleted')}</Notice>
                      ) : null}
                    </>
                  ) : undefined}
                  composer={(
                  // The stage sizes it: on the start page as wide as the title card —
                  // composer, role cards and dropzone alike; with messages the
                  // transcript's column.
                  <div className="input-container" aria-busy={startPending || undefined}>
                    {(rolesGate || taskGate) && startPage && (
                      <div>
                      <RoleStartCards
                        entries={taskStart ? [taskModeEntry(taskStart, startPage.activeRoleId)] : startEntries(startPage.page, startPage.activeRoleId, startPage.roles)}
                        roles={startPage.roles}
                        // The default role's card starts a normal chat (the active role).
                        onStart={(entry) => chat.startRoleChat({ ...entry, roleId: entry.roleId === startPage.activeRoleId ? null : entry.roleId })}
                      />
                      </div>
                    )}
                    {uploadStart && (
                      <div>
                      <UploadStart
                        title={uploadStart.title}
                        // Any file the composer takes; the attachment upload refuses the rest.
                        onFiles={(files) => {
                          autoSendRef.current = uploadStart.message;
                          composerAddRef.current?.(files);
                        }}
                        onBrowse={() => {
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.multiple = true;
                          input.onchange = () => {
                            if (!input.files?.length) return;
                            autoSendRef.current = uploadStart.message;
                            composerAddRef.current?.(Array.from(input.files));
                          };
                          input.click();
                        }}
                      />
                      </div>
                    )}
                    {followUps.length > 0 && (
                      <div data-testid="follow-ups" className="mb-3">
                        <div className="source-label" style={{ marginBottom: '0.5rem' }}>{t('followUpsLabel')}</div>
                        <div className="follow-up-suggestions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
                          {followUps.map((q, idx) => (
                            <button key={idx} type="button" className="follow-up-chip" onClick={() => chat.handleFollowUpClick(q)}>
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* The composer's box: while the start is pending, a skeleton lies over it. */}
                    <div className="relative" inert={startPending}>
                    {pendingBlock && <StartBlockSkeleton kind={pendingBlock.kind as 'cards' | 'prompt' | 'upload'} cards={pendingBlock.cards} />}
                    {startPending && !pendingBlock && <Skeleton shimmer delay={START_SKELETON_DELAY} className="absolute inset-0 rounded-full" />}
                    <PromptInput
                      id="chat-composer"
                      multiple
                      dropLabel={t('chatDropFiles')}
                      // Lights up for a file drag anywhere in the app, like the sources dropzone.
                      dropZoneScope="page"
                      // The composer's files go with the message as chat
                      // attachments, uploaded when they were attached. A send
                      // that does not happen throws, so PromptInput keeps the
                      // files (it clears them only after a submit that
                      // resolved): one still uploading or refused holds it.
                      onSubmit={async (_message, e) => {
                        // How this topic starts is not known yet: nothing is sent past it.
                        if (startPending) throw new Error('start page pending');
                        const ready = composerUploads.readiness();
                        if (ready.uploading || ready.failed) {
                          toast.error(t(ready.uploading ? 'chatAttachmentsStillUploading' : 'chatAttachmentsRemoveFailed'));
                          throw new Error('attachments not ready');
                        }
                        // The upload start's first message, when the file was attached there.
                        const text = autoSendNowRef.current ?? undefined;
                        autoSendNowRef.current = null;
                        if (!(await chat.handleSendMessage(e, undefined, toMessageAttachments(ready.uploaded), text))) {
                          throw new Error('message not sent');
                        }
                      }}
                      // Pending: unseen and out of reach (the wrapper is inert), but in place.
                      className={pendingBlock ? 'hidden' : startPending ? 'opacity-0' : noSources ? 'pointer-events-none opacity-55' : uploadGate || rolesGate || taskGate ? 'hidden' : undefined}
                      aria-disabled={(noSources && !startPending) || undefined}
                    >
                      <ComposerAttachmentsBridge addRef={composerAddRef} onCount={setComposerFileCount} onAdded={onComposerFilesAdded} />
                      {/* Attached files: a header row above the input line, present only while files are attached.
                          Each is uploaded as it is attached; the chip shows the upload and a refusal. */}
                      <ComposerUploadSync onFiles={syncComposerUploads} />
                      <PromptInputAttachments id="chat-composer-attachments" className="order-first basis-full flex-nowrap overflow-x-auto border-b border-outline-variant px-3 pt-3 pb-2">
                        {(file) => {
                          const upload = composerUploads.uploads[file.id];
                          return (
                            <PromptInputAttachment
                              data={file}
                              className="shrink-0"
                              status={upload?.status === 'uploading' || upload?.status === 'error' ? upload.status : undefined}
                              statusMessage={upload?.status === 'error' ? upload.message : upload?.status === 'uploading' ? t('chatAttachmentUploading') : undefined}
                              // A click opens the uploaded file in the preview window, like a sent message's chip.
                              onClick={upload?.status === 'done' ? () => webTools.handlePreviewUserFile({
                                userFileId: upload.uploaded.id,
                                name: upload.uploaded.name,
                                mime: upload.uploaded.mime,
                              }) : undefined}
                            />
                          );
                        }}
                      </PromptInputAttachments>
                      <InputGroupAddon id="chat-composer-actions" align="inline-start" ref={observeNotch('left')} className="absolute bottom-1 left-3 p-0">
                        {/* + — attach photos or files (menu grows with further actions) */}
                        <PromptInputActionMenu>
                          <PromptInputActionMenuTrigger
                            id="chat-composer-attach-trigger"
                            className="size-10"
                            title={t('attachFiles')}
                            aria-label={t('attachFiles')}
                          />
                          <PromptInputActionMenuContent id="chat-composer-attach-menu" align="start">
                            <PromptInputActionAddAttachments id="chat-composer-attach-files" label={t('attachFiles')} />
                            {/* Web search is the only capability so far, so the whole
                                group (separator + label + item) goes when it is off. */}
                            {webSearchAvailable && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>{t('capabilities')}</DropdownMenuLabel>
                                <PromptInputActionMenuItem
                                  id="chat-composer-web-search-toggle"
                                  role="menuitemcheckbox"
                                  aria-checked={webSearchOn}
                                  selected={webSearchOn}
                                  onSelect={() => setWebSearch(!webSearchOn)}
                                >
                                  <Globe className="mr-2 size-4" aria-hidden="true" />
                                  <span className="flex-1">{t('webSearchTool')}</span>
                                  {webSearchOn && <Check size={14} aria-hidden="true" />}
                                </PromptInputActionMenuItem>
                              </>
                            )}
                          </PromptInputActionMenuContent>
                        </PromptInputActionMenu>
                        {webSearchOn && (
                          /* Web search is on: a compact, pressed icon control next to the +.
                             The globe swaps to an X on hover/focus — one click switches it off. */
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <PromptInputButton
                                id="chat-composer-web-search-badge"
                                className="group/ws size-10"
                                aria-pressed="true"
                                aria-label={t('webSearchToolOff')}
                                onClick={() => setWebSearch(false)}
                              >
                                <Globe aria-hidden="true" className="group-hover/ws:hidden group-focus-visible/ws:hidden" />
                                <X aria-hidden="true" className="hidden group-hover/ws:block group-focus-visible/ws:block" />
                              </PromptInputButton>
                            </TooltipTrigger>
                            <TooltipContent>{t('webSearchToolActive')}</TooltipContent>
                          </Tooltip>
                        )}
                      </InputGroupAddon>
                      <PromptInputAdaptiveTextarea
                        id="chat-message-input"
                        ref={(el: HTMLTextAreaElement | null) => { attachHookRef(chat.textareaRef, el); }}
                        aria-label={chatPlaceholder}
                        className="px-4 text-base leading-normal"
                        enterKeyHint="send"
                        placeholder={chatPlaceholder}
                        value={chat.userMessageInput}
                        onChange={(e) => chat.setUserMessageInput(e.target.value)}
                        rows={1}
                        inlineLeft={notch.left}
                        inlineRight={notch.right}
                        laneHeight={48}
                        maxHeight={240}
                      />
                      <InputGroupAddon id="chat-composer-tools" align="inline-end" ref={observeNotch('right')} className="absolute right-3 bottom-1 gap-1 p-0">
                        {(() => {
                          const selectedConfig = availableConfigs.find(c => c.id === currentKb?.aiConfigId) || availableConfigs.find(c => c.is_active);
                          const model = currentKb?.chatModel || (selectedConfig ? selectedConfig.chat_models[0] : null);
                          const isReasoningCapable = selectedConfig?.reasoning_models?.includes(model || '') || false;
                          if (!isReasoningCapable) return null;
                          return (
                            <PromptInputButton
                              id="chat-composer-reasoning-toggle"
                              onClick={() => {
                                triggerHaptic(HAPTIC_PATTERNS.toggle);
                                setReasoningEnabled(!reasoningEnabled);
                              }}
                              title={t('reasoningMode')}
                              aria-label={t('reasoningToggle')}
                              aria-pressed={reasoningEnabled}
                            >
                              <Brain aria-hidden="true" />
                            </PromptInputButton>
                          );
                        })()}
                        {/* ✦ Improve the draft in place — rewrite / expand / spell; needs a draft */}
                        <PromptInputActionMenu>
                          <PromptInputActionMenuTrigger
                            id="chat-composer-enhance-trigger"
                            disabled={!chat.userMessageInput.trim() || enhancing !== null}
                            title={chat.userMessageInput.trim() ? t('enhanceTooltip') : t('enhanceNeedsDraft')}
                            aria-label={t('enhanceTooltip')}
                            aria-busy={enhancing !== null || undefined}
                          >
                            {enhancing
                              ? <Loader2 className="animate-spin" aria-hidden="true" />
                              : <WandSparkles aria-hidden="true" />}
                          </PromptInputActionMenuTrigger>
                          <PromptInputActionMenuContent id="chat-composer-enhance-menu" align="end">
                            {(['rewrite', 'expand', 'spell'] as const).map(m => (
                              <PromptInputActionMenuItem
                                key={m}
                                id={`chat-composer-enhance-${m}`}
                                onSelect={() => { void handleEnhanceDraft(m); }}
                              >
                                {m === 'rewrite' ? t('rewrite') : m === 'expand' ? t('expand') : t('spell')}
                              </PromptInputActionMenuItem>
                            ))}
                          </PromptInputActionMenuContent>
                        </PromptInputActionMenu>
                        {/* N sources active — a label, not a control. Absent when the
                            caller cannot see the source list (seeSources): the
                            answer then uses the whole KB. */}
                        {sourceSelection.selectedFileIds && <span
                          id="chat-composer-sources-count"
                          className="inline-flex items-center gap-1 whitespace-nowrap px-2 text-sm text-on-surface-variant"
                          title={t('activeSources')}
                          aria-label={`${selectedFileCount} ${t('sources')}`}
                        >
                          <FileText size={16} aria-hidden="true" />
                          <span aria-hidden="true">{selectedFileCount}</span>
                        </span>}
                        {noSources ? (
                          // Why sending is off, on the send button. aria-disabled, not
                          // disabled: a disabled button takes no hover or focus, so the
                          // tooltip could never open. type="button" keeps it from submitting;
                          // pointer-events-auto lifts it out of the dimmed composer.
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <PromptInputSubmit
                                id="chat-composer-submit"
                                type="button"
                                className="pointer-events-auto size-10 opacity-60"
                                aria-disabled="true"
                                aria-label={t('sendMessage')}
                              >
                                <ArrowUp aria-hidden="true" />
                              </PromptInputSubmit>
                            </TooltipTrigger>
                            <TooltipContent>{t('chatDisabledNoSources')}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <PromptInputSubmit
                            id="chat-composer-submit"
                            className="size-10"
                            status={chat.loading ? 'submitted' : undefined}
                            disabled={chat.loading || !sourceSelection.canSend || !chat.userMessageInput.trim()}
                            aria-label={t('sendMessage')}
                          >
                            <ArrowUp aria-hidden="true" />
                          </PromptInputSubmit>
                        )}
                      </InputGroupAddon>
                    </PromptInput>
                    </div>
                    {suggestionsEnabled && chat.messages.length === 0 && !noSources && !uploadGate && !rolesGate && !taskGate && !pendingBlock && !pendingEmpty && (
                      <PromptSuggestions
                        // Lines up with the composer's text start on the left (the
                        // measured + group, `notch.left`) and with the send button on
                        // the right: its `size-10` plus the same 12px edge offset and
                        // 8px gap `observeNotch` adds — not the whole tools group.
                        style={{ paddingLeft: notch.left, paddingRight: 'calc(2.5rem + 20px)' }}
                        title={t('promptSuggestions')}
                        // Fades in after a pause, so an empty chat opens on the composer first.
                        revealDelay={2500}
                        previousLabel={t('previousPage')}
                        nextLabel={t('nextPage')}
                        dismissLabel={t('close')}
                        // Closing keeps the component's space: the composer must not move.
                        dismissible
                        suggestions={examplePrompts}
                        // Its space is kept with nothing to suggest too: the start
                        // page and the generated questions arrive later, or bring
                        // none, and the centred page must stand the same either way.
                        reserveSpace
                        // Still loading once the reveal pause is over: placeholder chips.
                        loading={startPending || generatedLoading}
                        loadingLabel={t('promptSuggestionsLoading')}
                        disabled={!hasFiles}
                        onSelect={(prompt) => {
                          chat.setUserMessageInput(prompt);
                          chat.textareaRef.current?.focus();
                        }}
                        className="mt-4"
                      />
                    )}
                  </div>
                  )}
                >
                  {chat.messages.length === 0 && startPage && !chat.roleStart && !(noSources && sourceRights.addSources) && (
                    <StartGlow category={startPage.category} />
                  )}
                  {chat.messages.length === 0 ? (
                    // No entrance animation: the start page stands from the first paint.
                    <ChatStageColumn className="empty-state" aria-busy={startPending || undefined}>
                        {startPending && pendingEmpty && sourceRights.addSources ? (
                          // The first-source prompt that will load, as bars of its text.
                          <SkeletonText shimmer delay={START_SKELETON_DELAY} align="center" className="px-12">
                            <h1>{t('emptyAddFirstSourceTitle')}</h1>
                            <p>{t('emptyAddFirstSourceSubtitle')}</p>
                          </SkeletonText>
                        ) : !startPending && noSources && sourceRights.addSources ? (
                          // Adding sources happens in the sources column, which shows its
                          // dropzone while the KB is empty — the centre only says so. A
                          // caller who cannot add is not asked to.
                          // Who may set up the topic gets a pencil on hover: the
                          // Startseite can be prepared before the first source.
                          <div className="group/empty relative px-12">
                            <h1>{t('emptyAddFirstSourceTitle')}</h1>
                            <p>{t('emptyAddFirstSourceSubtitle')}</p>
                            {canEditSystemPrompt && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t('asstEditStartPage')}
                                    className="absolute right-0 top-0 opacity-0 transition-opacity group-hover/empty:opacity-100 focus-visible:opacity-100"
                                    onClick={() => setShowSystemPrompt(true)}
                                  >
                                    <Pencil className="size-4" aria-hidden="true" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('asstEditStartPage')}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ) : chat.roleStart ? (
                          // A chat started from a role card: what comes next.
                          <p>
                            {chat.roleStart.kind === 'file'
                              ? t('asstFileStartHint')
                              : chat.roleStart.kind === 'task' && chat.roleStart.text.trim()
                                ? t('asstTaskPrefilledHint')
                                : t('asstNewChatInRole').replace('{role}', chatRoleName ?? t('asstAssistant'))}
                          </p>
                        ) : (
                          // The title block of the assistant settings' Startseite (the
                          // glow above is its colour; the default one until set up),
                          // from the first render: the category joins once the start
                          // page is loaded, so no other title block is swapped out.
                          <div className="w-full max-w-2xl px-4 text-left">
                            <TitleCard
                              // While the start is pending: bars of its own text.
                              pending={startPending}
                              title={currentKb?.name ?? ''}
                              category={startPage?.category ?? null}
                              role={chat.chatRoleId ? undefined : startPage ? soleRoleName(startPage.page, startPage.activeRoleId, startPage.roles) : undefined}
                              description={shownDescription}
                              fileCount={currentKb?.fileCount}
                              asOf={currentKb?.lastIngestedAt}
                            />
                          </div>
                        )}
                    </ChatStageColumn>
                  ) : (
                    // Remounts when another chat's messages are loaded (transcriptKey),
                    // so it opens at that chat's last user turn. A new chat getting
                    // its id mid-stream does not change the key.
                    <MessageScrollerProvider key={chat.transcriptKey} autoScroll={autoScrollEnabled} defaultScrollPosition="last-anchor">
                      <MessageScroller>
                        <MessageScrollerViewport>
                          <ChatStageColumn asChild>
                          <MessageScrollerContent className="transcript gap-0" aria-busy={chat.loading}>
                            {chat.messages.map((msg: Message, index: number) => {
                              const questionText = msg.role === 'ai' && msg.parentMessageId
                                ? (chat.messages.find((m: Message) => m.id === msg.parentMessageId)?.content ?? '')
                                : '';
                              // The answer being prepared has no row yet: until its first
                              // token the status line below stands in for it. An empty row
                              // here added a blank gap above the spinner that collapsed
                              // once the text streamed in.
                              const awaitingFirstToken = chat.loading && index === chat.messages.length - 1
                                && msg.role === 'ai' && !msg.content && !hasAgentSteps(msg.trajectory, msg.reasoning);
                              if (awaitingFirstToken) return null;
                              // A day separator above the first message of each day.
                              const prevAt = chat.messages.slice(0, index).reverse().find((m: Message) => m.createdAt)?.createdAt;
                              const daySeparator = msg.createdAt && (!prevAt || !sameLocalDay(prevAt, msg.createdAt))
                                ? formatDaySeparator(msg.createdAt, language)
                                : null;
                              return (
                                <MessageScrollerItem
                                  // renderKey survives the temp→DB id remap mid-stream;
                                  // keying by id alone remounts the row and replays
                                  // the bubble's entrance animation.
                                  key={msg.renderKey ?? msg.id ?? index}
                                  messageId={msg.renderKey ?? msg.id}
                                  scrollAnchor={msg.role === 'user'}
                                  className="transcript-row"
                                >
                                  {daySeparator && (
                                    <div data-testid="day-separator" className="mb-4 text-center text-sm text-on-surface-variant">
                                      {daySeparator}
                                    </div>
                                  )}
                                  <MessageBubble
                                    message={msg}
                                    isStreaming={chat.loading && index === chat.messages.length - 1}
                                    isLatest={index === chat.messages.length - 1}
                                    onPdfOpen={handlePdfSourceOpen}
                                    animationDelay={initialRender ? Math.min(index * 0.05, 0.3) : 0}
                                    onEdit={msg.role === 'user' && !msg.isEnhanced ? (chat.editingMessageId === msg.id ? chat.handleEditSubmit : chat.handleStartEdit) : undefined}
                                    onFork={msg.role === 'ai' ? chat.handleForkFromMessage : undefined}
                                    onRegenerate={msg.role === 'ai' ? chat.handleRegenerate : undefined}
                                    onFeedback={msg.role === 'ai' ? chat.handleFeedback : undefined}
                                    isEditing={chat.editingMessageId === msg.id}
                                    onEditCancel={handleEditCancel}
                                    onPreviewSource={handlePreviewSource}
                                    onPreviewAttachment={webTools.handlePreviewUserFile}
                                    showCitations={sourceRights.seeCitations}
                                    kbId={currentKb?.id}
                                    questionText={questionText}
                                    reasoningOpen={messageSections.isOpen(messageSectionKey(msg), 'reasoning')}
                                    sourcesOpen={messageSections.isOpen(messageSectionKey(msg), 'sources')}
                                    confidenceOpen={messageSections.isOpen(messageSectionKey(msg), 'confidence')}
                                    conflictsOpen={messageSections.isOpen(messageSectionKey(msg), 'conflicts')}
                                    onToggleSection={messageSections.toggle}
                                  />
                                </MessageScrollerItem>
                              );
                            })}
                            {(() => {
                              const lastMsg = chat.messages[chat.messages.length - 1];
                              const isDeepSearching = lastMsg?.isDeepSearch && !lastMsg?.content;
                              // Only until the first token (the "submitted" phase):
                              // once reasoning or answer text streams, that output
                              // is the progress signal. Loading dots (the "typing"
                              // cue), not a shimmering label, so it does not read
                              // as the reasoning trigger.
                              const showLoader = chat.loading && !lastMsg?.content && !lastMsg?.reasoning;
                              return showLoader && (
                                <div className="message-ai chat-status-line flex items-center gap-2" data-testid="chat-status-line">
                                  {isDeepSearching ? (
                                    <>
                                      <Spinner size="sm" variant="dots" label={t('searchingDeeper')} />
                                      <span aria-hidden="true" className="text-sm text-on-surface-variant">{t('searchingDeeper')}</span>
                                    </>
                                  ) : (
                                    <Spinner size="sm" variant="dots" label={t('preparingAnswer')} />
                                  )}
                                </div>
                              );
                            })()}
                          </MessageScrollerContent>
                          </ChatStageColumn>
                        </MessageScrollerViewport>
                        <MessageScrollerButton />
                      </MessageScroller>
                    </MessageScrollerProvider>
                  )}

                </ChatStage>
                {(() => {
                  const sourcePanel = sourcePanelTarget && (
                    <SourcePanel
                      target={sourcePanelTarget}
                      onClose={sourcePanelApi.close}
                      onPassage={(passage) => setSourcePanelTarget(prev => (prev ? { ...prev, passage } : prev))}
                      onNavigate={setSourcePanelTarget}
                      fileOrigin={sourcePanelFile?.origin}
                      fileType={sourcePanelFile?.type}
                      onPdfOpen={handlePdfSourceOpen}
                      onPreviewSource={handlePreviewSource}
                      canPreview={sourceRights.previewSources}
                      canDownload={sourceRights.downloadSources}
                    />
                  );
                  return (
                    <AppShellSidePanel
                      label={t('sidePanelLabel')}
                      isOpen={sidePanelOpen}
                      onOpenChange={setSidePanelOpen}
                      expandLabel={t('sidePanelShow')}
                      collapseLabel={t('sidePanelHide')}
                      tabs={sideTabs.flatMap((id) => (
                        id === CITATIONS_TAB ? [{
                          id,
                          title: t('sidePanelCitations'),
                          icon: <Quote aria-hidden="true" />,
                          closeLabel: t('sidePanelCloseCitations'),
                        }] : sourcePanelTarget ? [{
                          id,
                          title: sourcePanelTarget.source.title,
                          icon: <FileText aria-hidden="true" />,
                          closeLabel: t('sourcePanelClose'),
                        }] : []
                      ))}
                      activeTabId={activeSideTab}
                      onTabChange={setActiveSideTab}
                      onTabClose={closeSideTab}
                      tabListLabel={t('sidePanelTabs')}
                      // What the panel can open: the chat's citations. One cited
                      // source opens from that list or from its chip in an answer.
                      launchers={sourceRights.seeCitations ? [
                        { id: CITATIONS_TAB, label: t('sidePanelCitations'), icon: <Quote aria-hidden="true" />, shortcut: t('sidePanelCitationsKey') },
                      ] : undefined}
                      onLaunch={showSideTab}
                      addLabel={t('sidePanelAdd')}
                      maximizeLabel={t('sidePanelMaximize')}
                      restoreLabel={t('sidePanelRestore')}
                      isMaximized={sidePanelMaximized}
                      onMaximizedChange={setSidePanelMaximized}
                      toggleKeyShortcuts={`${SIDE_PANEL_CHORD}+B`}
                      maximizeKeyShortcuts={`${SIDE_PANEL_CHORD}+F`}
                      width={sidePanelWidth}
                      resize={{
                        minWidth: SIDE_PANEL_BOUNDS.min,
                        maxWidth: SIDE_PANEL_BOUNDS.max,
                        onWidthChange: setSidePanelWidth,
                        label: t('sidePanelResize'),
                      }}
                    >
                      {activeSideTab === CITATIONS_TAB ? (
                        <CitationsPanel
                          messages={chat.messages}
                          target={sourcePanelTarget}
                          onOpen={sourcePanelApi.open}
                        />
                      ) : sourcePanel}
                    </AppShellSidePanel>
                  );
                })()}
      {showSystemPrompt && currentKb && canEditSystemPrompt && (
        // Modal over the chat: the chat stays where it was underneath and the
        // rest of the app is inert until the dialog closes.
        <KbSettingsDialog
          flags={flagsDraft}
          onFlagsChange={setFlagsDraft}
          kb={currentKb}
          section={systemPromptSection}
          onSectionChange={setSystemPromptSection}
          dirty={sourceFlagsPatch(savedFlags, flagsDraft) !== null}
          onSave={async () => {
            // Only the flags that changed. On success the KB row is replaced,
            // which resets the draft to the stored values (the reset key
            // above), so the dialog reads clean. Startseite and Verhalten
            // save themselves (useAssistantSettingsStore).
            const update = sourceFlagsPatch(savedFlags, flagsDraft);
            return update ? handleUpdateKBSettings(update) : true;
          }}
          onUpdateKb={handleUpdateKBSettings}
          onClose={() => {
            setFlagsDraft(savedFlags);
            setShowSystemPrompt(false);
          }}
        />
      )}
    </>
    </SourcePanelContext.Provider>
  );
};

export const ChatView = memo(ChatViewComp);
