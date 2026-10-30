import { lazy, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain, ArrowUp, ArrowLeft,
  X, Check, Pencil,
  Globe, WandSparkles, Loader2, FileText, Bot, Users,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { Message } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobileContext } from '../contexts/MobileContext';
import { useKbCore } from '../contexts/KbCoreContext';
import { useKbChat } from '../contexts/KbChatContext';
import { useKbData } from '../contexts/KbDataContext';
import { KbSettingsDialog } from './KbSettingsDialog';
import { useKbLayout } from '../contexts/KbLayoutContext';
import { useStarterQuestions } from '../hooks/useStarterQuestions';
import { useAutoScrollEnabled, useFollowUpsEnabled, usePromptSuggestionsEnabled } from '../hooks/useChatSuggestionPrefs';
import { useReducedMotion, getMotionProps } from '../hooks/useReducedMotion';
import { useKbAgents } from '../hooks/useKbAgents';
import { messageSectionKey, useMessageSections } from '../hooks/useMessageSections';
import { ComposerUploadSync, useComposerUploads } from '../hooks/useComposerUploads';
import { useKbStartPage } from '../hooks/useKbStartPage';
import { RoleStartCards, StartGlow, TitleCard, UploadStart } from './kbSettings/assistant/StartPageParts';
import { showsGeneratedQuestions, startEntries, suggestionQuestions, visibleQuestions } from './kbSettings/assistant/startPageModel';
import { toMessageAttachments } from '../utils/chatAttachments';
import { useComposerNotch } from '../hooks/useComposerNotch';
import { useToast } from '../contexts/ToastContext';
import {
  InputGroupAddon,
  ChatStage, PromptInput, PromptInputAdaptiveTextarea, PromptSuggestions, PromptInputButton, PromptInputSubmit,
  PromptInputActionMenu, PromptInputActionMenuTrigger, PromptInputActionMenuContent, PromptInputActionMenuItem, PromptInputActionAddAttachments,
  PromptInputAttachments, PromptInputAttachment, usePromptInputAttachments, Badge, Notice,
  DropdownMenuLabel, DropdownMenuSeparator, Tooltip, TooltipTrigger, TooltipContent,
  Spinner, Button,
  MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton,
} from '@ki4jlu/design-system';
import MessageBubble from '../MessageBubble';
import { getBranchInfo } from '../utils/messageTree';
import { HAPTIC_PATTERNS, triggerHaptic } from '../utils/haptics';
import { canOpenKbAdvancedSettings, canOpenKbTopicSettings, chatSourceSelection, kbSourceRights } from '../utils/kbAccess';
import { sourceFlagsOf, sourceFlagsPatch } from '../utils/kbRoleRights';
import { isChatWebSearchAvailable } from '../utils/chatWebSearch';
import { API_BASE_URL, authFetch } from '../api';
import { SourcePanel } from './sources/SourcePanel';
import { SourcePanelContext, type SourcePanelApi, type SourcePanelTarget } from '../contexts/SourcePanelContext';
import { MessageSkeleton } from './Skeleton';
import { formatDaySeparator, sameLocalDay } from '../utils/chatDates';

const KbSettingsPanelLazy = lazy(() => import('./kb-settings/KbSettingsPanel').then(m => ({ default: m.KbSettingsPanel })));
const ComparisonView = lazy(() => import('./ComparisonView').then(module => ({ default: module.ComparisonView })));

// Attaches a DOM element to a ref owned by useChat (textareaRef). Done in a module-level helper so the `.current` write — and
// the ref-typed property itself — stay opaque to the React Compiler lint:
// a direct `ref={chat.xRef}` makes it treat the whole `chat` hook result as
// ref-carrying and flag every render-time `chat.*` read.
function attachHookRef<T>(target: unknown, el: T | null) {
  if (!target) return;
  (target as React.MutableRefObject<T | null>).current = el;
}

// Shared Suspense fallback. `role` on MessageSkeleton is a visual variant
// ('user' | 'ai'), not an ARIA role; mapping over the variants keeps
// jsx-a11y from misreading the prop as an (invalid) ARIA role literal.
const SKELETON_VARIANTS: ReadonlyArray<'user' | 'ai'> = ['user', 'ai'];
const chatSuspenseFallback = (
  <div className="messages-container" style={{ justifyContent: 'flex-end' }}>
    {SKELETON_VARIANTS.map(variant => <MessageSkeleton key={variant} role={variant} />)}
  </div>
);

/**
 * Inside the composer: reports how many files are attached and hands out the
 * composer's `add`, so the upload-only start (a dropzone shown instead of
 * the composer) can attach the first file to it.
 */
function ComposerAttachmentsBridge({ addRef, onCount }: { addRef: React.MutableRefObject<((files: File[]) => void) | null>; onCount: (n: number) => void }) {
  const { files, add } = usePromptInputAttachments();
  useEffect(() => { addRef.current = (f) => add(f); }, [add, addRef]);
  useEffect(() => { onCount(files.length); }, [files.length, onCount]);
  return null;
}


const ChatViewComp = () => {
  const { language, t } = useTheme();
  const { user, siteConfigs } = useAuth();
  const isMobile = useIsMobileContext();
  const reducedMotion = useReducedMotion();

  const {
    currentKb, availableConfigs, handleUpdateKBSettings, onOpenRagSettings,
  } = useKbCore();
  const {
    chat, reasoningEnabled, setReasoningEnabled,
    webSearchEnabled: webSearch, setWebSearchEnabled: setWebSearch,
    agentSelection, setAgentSelection,
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

  // Agent/team picker options for this KB; refreshes on KB switch.
  const kbAgentOptions = useKbAgents(currentKb?.id);

  // New chats default to the KB's isDefault team (priority) or agent.
  // Existing chats have their selection restored from the chat row
  // (useChat.handleSelectChat), so this is a no-op once activeChatId is set.
  useEffect(() => {
    if (chat.activeChatId) return;
    const defTeam = kbAgentOptions.teams.find(x => x.isDefault);
    const defAgent = kbAgentOptions.agents.find(x => x.isDefault);
    if (defTeam) setAgentSelection({ teamId: defTeam.id });
    else if (defAgent) setAgentSelection({ agentId: defAgent.id });
  }, [kbAgentOptions, chat.activeChatId, setAgentSelection]);

  const [showKbSettings, setShowKbSettings] = useState(false);
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

  // The "Rollen & Rechte" draft: the KB's source flags, reset whenever the KB
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

  // The advanced settings (KbSettingsPanel) trigger. Shares its predicate with
  // HomeView's sliders icon so the two entry points cannot drift: system role
  // in {api-user, admin, superadmin} AND effective KB role admin or better.
  //
  // The KB half used to be `currentKb.userId === user?.id || admin ||
  // superadmin` — the legacy owner-mirror column, which is NULL on every
  // public KB (publishing NULLs knowledge_bases.user_id) and says nothing about
  // a KB admin who is not the owner. canOpenKbAdvancedSettings reads myRole
  // through the same ladder kbaccess.EffectiveRole applies server-side, so the
  // button now appears exactly where kbAdvancedChain would let the request
  // through.
  // System prompt: owners and KB admins (the gear in the chrome bar,
  // KbWorkspaceLayout, uses the same predicate).
  const canEditSystemPrompt = !!currentKb && canOpenKbTopicSettings(currentKb, user?.role, user?.id);
  // The RAG configuration page, entered from Verhalten: system admins only,
  // as the topic card's menu used to offer it.
  const canOpenRagSettings = !!currentKb && (user?.role === 'admin' || user?.role === 'superadmin')
    && canOpenKbAdvancedSettings(currentKb, user?.role);

  const {
    hasFiles, filesLoaded, selectedFileCount,
  } = fileMgmt;
  // What the caller may do with the KB's sources (backend capabilities).
  // Opening a source from an answer loads the file, so the two open handlers
  // go to the answers only with downloadSources; citations need seeCitations.
  const sourceRights = kbSourceRights(currentKb, user?.role, user?.id);
  const { handlePreviewSource: previewSource, handlePdfSourceOpen: pdfSourceOpen } = webTools;
  const handlePreviewSource = sourceRights.downloadSources ? previewSource : undefined;
  const handlePdfSourceOpen = sourceRights.downloadSources ? pdfSourceOpen : undefined;

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
  const [autoScrollEnabled] = useAutoScrollEnabled();
  // The line under the title: the topic's own description, else the default line.
  const shownDescription = currentKb?.description?.trim() || t('kbHeaderDefault');
  // The assistant settings' start page; re-read whenever the settings dialog closes.
  const startPage = useKbStartPage(currentKb?.id, showSystemPrompt);
  const configuredStart = startPage?.configured ? startPage : null;
  // Generated questions cost a model call, so they are asked for only once the
  // start page is known and only where they will be shown: a role card's
  // input start, a configured input start, or the default start page — each
  // with dynamic questions on.
  const wantsGenerated = !!startPage && showsGeneratedQuestions(chat.roleStart, configuredStart?.page ?? null);
  // For the role the chat starts in: a role card's, else the active role.
  const generatedPrompts = useStarterQuestions(currentKb?.id, language, suggestionsEnabled && wantsGenerated && chat.messages.length === 0 && hasFiles, chat.roleStart?.roleId ?? undefined);
  const startMode = configuredStart?.page.startMode ?? 'input';
  const [composerFileCount, setComposerFileCount] = useState(0);
  const composerAddRef = useRef<((files: File[]) => void) | null>(null);
  const emptyChat = chat.messages.length === 0 && !noSources;
  // „Rollenauswahl": the role cards stand in for the composer until one is picked.
  const rolesGate = !!configuredStart && startMode === 'roles' && emptyChat && !chat.roleStart;
  // The upload area stands in for the composer until the first file is attached:
  // the upload-only start's, or a file card's.
  const fileCard = chat.roleStart?.kind === 'file' ? chat.roleStart : null;
  const uploadStart: { title: string; message: string } | null = !emptyChat || composerFileCount > 0 ? null
    : fileCard ? {
      // The role start's own label, else the default naming the role.
      title: fileCard.text.trim() || t('asstFileDropTitle').replace('{role}', startPage?.roles.find(r => r.id === (fileCard.roleId ?? startPage.activeRoleId))?.name ?? t('asstAssistant')),
      message: fileCard.instruction.trim() || t('asstFileDefaultMessage'),
    }
      : configuredStart && startMode === 'upload' && !chat.roleStart ? {
        title: configuredStart.page.uploadLabel.trim() || t('asstUploadLabelDefault'),
        message: configuredStart.page.uploadInstruction.trim() || t('asstFileDefaultMessage'),
      }
        : null;
  const uploadGate = !!uploadStart;
  // A file attached through the upload area goes out at once with the
  // instruction (or the default text) as the first message, once uploaded.
  // `autoSendRef` holds that message until then; the submit handler takes it.
  const autoSendRef = useRef<string | null>(null);
  const autoSendNowRef = useRef<string | null>(null);
  const { uploads: composerUploadStates, readiness: composerReadiness } = composerUploads;
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
  const chatRole = chat.chatRoleId ? startPage?.roles.find(r => r.id === chat.chatRoleId) : undefined;
  const examplePrompts = useMemo(() => {
    // A chat started from a role card that opens the input field: that card's suggestions.
    if (chat.roleStart) return chat.roleStart.kind === 'input' ? suggestionQuestions(chat.roleStart.suggestions, generatedPrompts) : [];
    // Configured start page: its own suggestions (fixed, or the generated ones cut to its count), if on.
    if (configuredStart) return visibleQuestions(configuredStart.page, generatedPrompts);
    const raw = currentKb?.isGlobal && currentKb?.examplePrompts
      ? currentKb.examplePrompts
      : siteConfigs.example_prompts;
    const prompts = raw
      ? raw.split('\n')
      : ['Fasse die wichtigsten Punkte meiner Dokumente zusammen', 'Was sind die wichtigsten Erkenntnisse in {topic}?'];
    // `{topic}` stands for the open topic's name, in configured prompts too.
    const configured = prompts.map(p => p.replaceAll('{topic}', `„${currentKb?.name ?? ''}“`));
    // Then the questions generated from the KB's documents, without repeats.
    const seen = new Set(configured.map(p => p.trim().toLowerCase()));
    return [...configured, ...generatedPrompts.filter(q => !seen.has(q.trim().toLowerCase()))];
  }, [chat.roleStart, configuredStart, currentKb?.isGlobal, currentKb?.examplePrompts, currentKb?.name, siteConfigs.example_prompts, generatedPrompts]);

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
  const [panelTranscriptKey, setPanelTranscriptKey] = useState(chat.transcriptKey);
  if (panelTranscriptKey !== chat.transcriptKey) {
    setPanelTranscriptKey(chat.transcriptKey);
    setSourcePanelTarget(null);
  }
  const sourcePanelApi = useMemo<SourcePanelApi>(() => ({
    target: sourcePanelTarget,
    open: setSourcePanelTarget,
    close: () => setSourcePanelTarget(null),
  }), [sourcePanelTarget]);
  const sourcePanelFile = sourcePanelTarget?.source.fileId
    ? fileMgmt.files.find(f => f.id === sourcePanelTarget.source.fileId)
    : undefined;

  const handleEditCancel = useCallback(() => chat.setEditingMessageId(null), [chat]);

  // Resolves a message's teamId/agentId (Task 5 backend fields, stamped by
  // useChatStream while streaming) to a display name for the attribution
  // chip. A lookup miss — the team/agent was deleted or detached since the
  // message was answered — returns undefined, so MessageBubble renders no
  // chip rather than an empty label.
  const resolveAttribution = useCallback((m: Message) => {
    if (m.teamId) return kbAgentOptions.teams.find(x => x.id === m.teamId)?.name;
    if (m.agentId) return kbAgentOptions.agents.find(x => x.id === m.agentId)?.name;
    return undefined;
  }, [kbAgentOptions]);

  return (
    <SourcePanelContext.Provider value={sourcePanelApi}>
    <div className="chat-area">
      {/* Ein <div>, kein <main>: `AppShell` rendert das `main`-Landmark der
          Seite selbst, und zwei davon wären kein Detail, sondern ein zweites
          „Hauptinhalt"-Sprungziel für Screenreader. Die eigene Höhenrechnung
          (`calc(100dvh - 60px)` auf Mobil) ist mit der `MobileTabBar` gegangen,
          die sie freihielt — die Shell reserviert die Höhe ihrer Leiste jetzt
          selbst, ein zweiter Abzug hier ließe unten 60px leer. */}
      {/* Kein Zwischen-<div> mehr: `.chat-area` ist selbst die Flex-Spalte mit
          `min-height: 0; overflow: hidden`, die den Scroller unten einsperrt. */}
      {/* Nur der Chat (22.09.2026). Die Zweige für 'research',
          'academic_research', 'workspace', 'mindmap' und das Dashboard sind
          hier gestrichen; die Komponenten bleiben im Repo für die spätere
          Anbindung als Tools. `KbViewType` ist auf 'chat' verengt, also gibt
          es nichts mehr zu verzweigen. */}
      {
            chat.comparisonMode && chat.comparisonLeafId && chat.activeLeafId ? (
              <Suspense fallback={chatSuspenseFallback}>
                <div className="content-fade-in" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {/* No source panel here: sources open the document, as without the chat view. */}
                  <SourcePanelContext.Provider value={null}>
                  <ComparisonView
                    messageTree={chat.messageTree}
                    leafIdA={chat.activeLeafId}
                    leafIdB={chat.comparisonLeafId}
                    onUseBranch={(leafId) => {
                      chat.setActiveLeafId(leafId);
                      chat.setComparisonMode(false);
                      chat.setComparisonLeafId(null);
                    }}
                    onClose={() => {
                      chat.setComparisonMode(false);
                      chat.setComparisonLeafId(null);
                    }}
                    onPdfOpen={handlePdfSourceOpen}
                    onPreviewSource={handlePreviewSource}
                    showCitations={sourceRights.seeCitations}
                  />
                  </SourcePanelContext.Provider>
                </div>
              </Suspense>
            ) : (
              <div className="chat-row">
                {/* DS ChatStage: an empty chat centres the empty state and the composer
                    together; with messages the composer docks and the disclaimer stays
                    pinned to the bottom either way. */}
                <ChatStage
                  // relative isolate: the start page's glow fills the stage, behind the content.
                  className="chat-column relative isolate"
                  empty={chat.messages.length === 0}
                  footerId="chat-disclaimer"
                  footer={siteConfigs.chat_footer || t('chatFooter')}
                  composer={(
                  // An empty chat (the start page) is as wide as the title card —
                  // composer, role cards and dropzone alike; with messages the
                  // composer takes the transcript's column.
                  <div className={chat.messages.length === 0 ? 'input-container input-container--start' : 'input-container'}>
                    {rolesGate && configuredStart && (
                      <div>
                      <RoleStartCards
                        entries={startEntries(configuredStart.page, configuredStart.activeRoleId)}
                        roles={configuredStart.roles}
                        // The default role's card starts a normal chat (the active role).
                        onStart={(entry) => chat.startRoleChat({ ...entry, roleId: entry.roleId === configuredStart.activeRoleId ? null : entry.roleId })}
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
                      className={noSources ? 'pointer-events-none opacity-55' : uploadGate || rolesGate ? 'hidden' : undefined}
                      aria-disabled={noSources || undefined}
                    >
                      <ComposerAttachmentsBridge addRef={composerAddRef} onCount={setComposerFileCount} />
                      {/* Attached files: a header row above the input line, present only while files are attached.
                          Each is uploaded as it is attached; the chip shows the upload and a refusal. */}
                      <ComposerUploadSync onFiles={composerUploads.sync} />
                      <PromptInputAttachments id="chat-composer-attachments" className="order-first basis-full flex-nowrap overflow-x-auto border-b border-outline-variant px-3 pt-3 pb-2">
                        {(file) => {
                          const upload = composerUploads.uploads[file.id];
                          return (
                            <PromptInputAttachment
                              data={file}
                              className="shrink-0"
                              status={upload?.status === 'uploading' || upload?.status === 'error' ? upload.status : undefined}
                              statusMessage={upload?.status === 'error' ? upload.message : upload?.status === 'uploading' ? t('chatAttachmentUploading') : undefined}
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
                        aria-label={t('chatPlaceholder')}
                        className="px-4 text-base leading-normal"
                        enterKeyHint="send"
                        placeholder={currentKb?.name ? t('chatPlaceholderContextual').replace('{{name}}', currentKb.name) : t('chatPlaceholder')}
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
                        {(agentSelection.teamId || agentSelection.agentId) && (
                          <span id="chat-composer-agent-chip" className="agent-active-chip">
                            {agentSelection.teamId ? <Users size={13} aria-hidden="true" /> : <Bot size={13} aria-hidden="true" />}
                            {t('agentActiveChip')}{' '}
                            {agentSelection.teamId
                              ? kbAgentOptions.teams.find(x => x.id === agentSelection.teamId)?.name
                              : kbAgentOptions.agents.find(x => x.id === agentSelection.agentId)?.name}
                          </span>
                        )}
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
                    {suggestionsEnabled && chat.messages.length === 0 && !noSources && !uploadGate && !rolesGate && examplePrompts.length > 0 && (
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
                    <StartGlow colors={startPage.page.colors} />
                  )}
                  {(chat.chatRoleId || (chat.roleStart && chat.messages.length === 0)) && (
                    // The role this chat was started in — for the whole chat, also when reopened from the history.
                    <div className="flex flex-wrap items-center justify-center gap-2 px-4 pt-3">
                      {chat.roleStart && chat.messages.length === 0 && (
                        <Button variant="ghost" size="sm" onClick={chat.handleNewChat}>
                          <ArrowLeft className="size-4" aria-hidden="true" /> {t('asstBackToStart')}
                        </Button>
                      )}
                      {chatRole ? (
                        <Badge tone="primary">{t('asstRoleBadge').replace('{role}', chatRole.name)}</Badge>
                      ) : chat.chatRoleId && startPage ? (
                        <Notice tone="neutral" className="max-w-xl">{t('asstRoleDeleted')}</Notice>
                      ) : null}
                    </div>
                  )}
                  {chat.messages.length === 0 ? (
                    <div
                      className="messages-container"
                      style={{ position: 'relative' }}
                    >
                      <motion.div
                        className="empty-state"
                        {...getMotionProps(reducedMotion)}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                      >
                        {currentKb?.isGlobal && currentKb?.headerText ? (
                          <div style={{ marginBottom: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '1.1rem', whiteSpace: 'pre-wrap', maxWidth: '600px', margin: '0 auto 2rem' }}>
                            {currentKb.headerText}
                          </div>
                        ) : siteConfigs.kb_header ? (
                          <div style={{ marginBottom: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '1.1rem', whiteSpace: 'pre-wrap', maxWidth: '600px', margin: '0 auto 2rem' }}>
                            {siteConfigs.kb_header}
                          </div>
                        ) : null}
                        {noSources && sourceRights.addSources ? (
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
                        ) : startPage && !chat.roleStart ? (
                          // The title block of the assistant settings' Startseite (the
                          // glow above is its colour; the default one until set up).
                          <div className="w-full max-w-2xl px-4 text-left">
                            <TitleCard
                              title={currentKb?.name ?? ''}
                              category={startPage.category}
                              description={shownDescription}
                              fileCount={currentKb?.fileCount}
                              asOf={currentKb?.lastIngestedAt}
                            />
                          </div>
                        ) : chat.roleStart ? (
                          // A chat started from a role card: what comes next.
                          <p>
                            {chat.roleStart.kind === 'file'
                              ? t('asstFileStartHint')
                              : chat.roleStart.kind === 'task' && chat.roleStart.text.trim()
                                ? t('asstTaskPrefilledHint')
                                : t('asstNewChatInRole').replace('{role}', (chatRole ?? startPage?.roles.find(r => r.id === startPage.activeRoleId))?.name ?? t('asstAssistant'))}
                          </p>
                        ) : (
                          <>
                            <h1>{currentKb?.name}</h1>
                            {/* The KB's own description (Startseite), else the default line. */}
                            <p>{shownDescription}</p>
                          </>
                        )}
                      </motion.div>
                    </div>
                  ) : (
                    // Remounts when another chat's messages are loaded (transcriptKey),
                    // so it opens at that chat's last user turn. A new chat getting
                    // its id mid-stream does not change the key.
                    <MessageScrollerProvider key={chat.transcriptKey} autoScroll={autoScrollEnabled} defaultScrollPosition="last-anchor">
                      <MessageScroller>
                        <MessageScrollerViewport
                          className="messages-container"
                        >
                          <MessageScrollerContent className="transcript" aria-busy={chat.loading}>
                            {chat.messages.map((msg: Message, index: number) => {
                              const bi = msg.id ? getBranchInfo(chat.messageTree, msg.id) : null;
                              const questionText = msg.role === 'ai' && msg.parentMessageId
                                ? (chat.messages.find((m: Message) => m.id === msg.parentMessageId)?.content ?? '')
                                : '';
                              // The answer being prepared has no row yet: until its first
                              // token the status line below stands in for it. An empty row
                              // here added a blank gap above the spinner that collapsed
                              // once the text streamed in.
                              const awaitingFirstToken = chat.loading && index === chat.messages.length - 1
                                && msg.role === 'ai' && !msg.content && !msg.reasoning && !msg.trajectory?.length;
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
                                    onFollowUpClick={chat.handleFollowUpClick}
                                    showFollowUps={followUpsEnabled && !chat.loading && msg.role === 'ai' && index === chat.messages.length - 1}
                                    branchInfo={bi}
                                    onSwitchBranch={chat.handleSwitchBranch}
                                    animationDelay={initialRender ? Math.min(index * 0.05, 0.3) : 0}
                                    onEdit={msg.role === 'user' && !msg.isEnhanced ? (chat.editingMessageId === msg.id ? chat.handleEditSubmit : chat.handleStartEdit) : undefined}
                                    onFork={msg.role === 'ai' ? chat.handleForkFromMessage : undefined}
                                    onCompare={bi ? chat.handleStartComparison : undefined}
                                    onRegenerate={msg.role === 'ai' ? chat.handleRegenerate : undefined}
                                    onFeedback={msg.role === 'ai' ? chat.handleFeedback : undefined}
                                    isEditing={chat.editingMessageId === msg.id}
                                    onEditCancel={handleEditCancel}
                                    onPreviewSource={handlePreviewSource}
                                    onPreviewAttachment={webTools.handlePreviewUserFile}
                                    showCitations={sourceRights.seeCitations}
                                    kbId={currentKb?.id}
                                    questionText={questionText}
                                    resolveAttribution={resolveAttribution}
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
                        </MessageScrollerViewport>
                        <MessageScrollerButton />
                      </MessageScroller>
                    </MessageScrollerProvider>
                  )}

                </ChatStage>
                {sourcePanelTarget && (
                  <SourcePanel
                    target={sourcePanelTarget}
                    onClose={sourcePanelApi.close}
                    onPassage={(passage) => setSourcePanelTarget(prev => (prev ? { ...prev, passage } : prev))}
                    onNavigate={setSourcePanelTarget}
                    fileOrigin={sourcePanelFile?.origin}
                    fileType={sourcePanelFile?.type}
                    onPdfOpen={handlePdfSourceOpen}
                    onPreviewSource={handlePreviewSource}
                    canDownload={sourceRights.downloadSources}
                    fullScreen={isMobile}
                  />
                )}
              </div>
            )
      }
      {showKbSettings && currentKb && (
        <div
          className="modal-overlay"
          style={{ zIndex: 3000 }}
          onClick={() => setShowKbSettings(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowKbSettings(false); }}
          role="presentation"
        >
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="KB settings"
            className="modal-content"
            style={{ maxWidth: '640px', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>KB Settings (RAG Tuning)</h3>
              <button
                type="button"
                onClick={() => setShowKbSettings(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <Suspense fallback={<div>Loading…</div>}>
              <KbSettingsPanelLazy kbId={currentKb.id} />
            </Suspense>
          </div>
        </div>
      )}
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
          onOpenRagSettings={canOpenRagSettings ? onOpenRagSettings : undefined}
        />
      )}
    </div>
    </SourcePanelContext.Provider>
  );
};

export const ChatView = memo(ChatViewComp);
