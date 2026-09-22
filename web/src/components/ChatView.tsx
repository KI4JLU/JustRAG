import { lazy, Suspense, memo, useCallback, useRef, useEffect, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  Brain, ArrowUp,
  X, Search, GitBranch, Check, Trash2,
  UploadCloud, Globe, FlaskConical, WandSparkles, Loader2, FileText, Bot, Users,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { Message } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobileContext } from '../contexts/MobileContext';
import { useKbCore } from '../contexts/KbCoreContext';
import { useKbChat } from '../contexts/KbChatContext';
import { useKbData } from '../contexts/KbDataContext';
import KbAgentsSection from './agents/KbAgentsSection';
import AgentPicker from './agents/AgentPicker';
import { useKbLayout } from '../contexts/KbLayoutContext';
import { useReducedMotion, getMotionProps } from '../hooks/useReducedMotion';
import { useKbAgents } from '../hooks/useKbAgents';
import { useMessageSections } from '../hooks/useMessageSections';
import {
  InputGroupAddon,
  PromptInput, PromptInputAdaptiveTextarea, PromptInputButton, PromptInputSubmit,
  PromptInputActionMenu, PromptInputActionMenuTrigger, PromptInputActionMenuContent, PromptInputActionMenuItem, PromptInputActionAddAttachments,
  PromptInputAttachments, PromptInputAttachment,
  DropdownMenuLabel, DropdownMenuSeparator, Tooltip, TooltipTrigger, TooltipContent,
} from '@ki4jlu/design-system';
import MessageBubble from '../MessageBubble';
import { findDefaultLeaf, getBranchInfo } from '../utils/messageTree';
import { HAPTIC_PATTERNS, triggerHaptic } from '../utils/haptics';
import { canOpenKbAdvancedSettings, hasKbAdminRole } from '../utils/kbAccess';
import { API_BASE_URL, authFetch } from '../api';
import { BranchTreeNav } from './BranchTreeNav';
import { MessageSkeleton } from './Skeleton';

const KbSettingsPanelLazy = lazy(() => import('./kb-settings/KbSettingsPanel').then(m => ({ default: m.KbSettingsPanel })));
const ComparisonView = lazy(() => import('./ComparisonView').then(module => ({ default: module.ComparisonView })));

// Attaches a DOM element to a ref owned by useChat (messagesContainerRef /
// textareaRef). Done in a module-level helper so the `.current` write — and
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

const ChatViewComp = () => {
  const { language, t } = useTheme();
  const { user, siteConfigs } = useAuth();
  const isMobile = useIsMobileContext();
  const reducedMotion = useReducedMotion();

  const {
    currentKb, availableConfigs, handleUpdateKBSettings, onViewAgents,
  } = useKbCore();
  const {
    chat, reasoningEnabled, setReasoningEnabled,
    webSearchEnabled: webSearch, setWebSearchEnabled: setWebSearch,
    agentSelection, setAgentSelection,
  } = useKbChat();
  const { fileMgmt, webTools } = useKbData();
  const { sidebar, systemPromptOpen: showSystemPrompt, setSystemPromptOpen: setShowSystemPrompt } = useKbLayout();

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

  const [systemPromptDraft, setSystemPromptDraft] = useState(currentKb?.systemPrompt || '');
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

  // One-line mode keeps the text between the two control groups, which float
  // over the bottom corners of the frame; the textarea reserves their measured
  // width (+ edge offset and a gap). Measured, not hard-coded — the right
  // group changes with the agent chip, the reasoning toggle and the source
  // count. Once the text wraps, the textarea moves above the controls instead.
  const [notch, setNotch] = useState({ left: 0, right: 0 });
  const observeNotch = useCallback((side: 'left' | 'right') => (el: HTMLDivElement | null) => {
    if (!el) return;
    const apply = () => setNotch(n => {
      const w = Math.ceil(el.getBoundingClientRect().width) + 12 + 8;
      return n[side] === w ? n : { ...n, [side]: w };
    });
    apply();
    // Deferred to the next frame: reacting synchronously inside the observer
    // callback re-lays out the frame in the same tick and trips
    // "ResizeObserver loop completed with undelivered notifications".
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, []);

  // Reset the draft whenever the KB (or its stored prompt) changes — done
  // during render with a prev-comparison instead of an effect, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const promptResetKey = `${currentKb?.id ?? ''}\0${currentKb?.systemPrompt ?? ''}`;
  const [prevPromptResetKey, setPrevPromptResetKey] = useState(promptResetKey);
  if (prevPromptResetKey !== promptResetKey) {
    setPrevPromptResetKey(promptResetKey);
    setSystemPromptDraft(currentKb?.systemPrompt || '');
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
  const canTuneKB = canOpenKbAdvancedSettings(currentKb, user?.role);
  // System prompt: owners and KB admins (the gear in the chrome bar,
  // KbWorkspaceLayout, uses the same predicate).
  const canEditSystemPrompt = !!currentKb && ((!!user?.id && currentKb.userId === user.id) || hasKbAdminRole(currentKb, user?.role));

  const {
    hasFiles, selectedFileCount, fileInputRef,
    isDragging, handleDragOver, handleDragEnter, handleDragLeave, handleDrop,
  } = fileMgmt;
  const { handlePreviewSource, handlePdfSourceOpen, setToolTab } = webTools;

  // No-sources state for a non-global KB: drives the §7 acquisition empty state
  // and dims the composer until the user adds a first source.
  const noSources = !hasFiles && !currentKb?.isGlobal;
  const openWebTool = useCallback((tab: 'websearch' | 'crawl' | 'research') => {
    setToolTab(tab);
    sidebar.setIsRightSidebarOpen(true);
  }, [setToolTab, sidebar]);

  const webToolBtnStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
    padding: '0.55rem 0.9rem', borderRadius: '8px',
    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem',
    fontFamily: 'inherit', transition: 'border-color 0.15s, background 0.15s, transform 0.15s',
  };
  const webToolHoverIn = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = 'var(--accent-primary)';
    e.currentTarget.style.background = 'var(--tag-bg)';
    e.currentTarget.style.transform = 'translateY(-2px)';
  };
  const webToolHoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = 'var(--border-color)';
    e.currentTarget.style.background = 'var(--bg-primary)';
    e.currentTarget.style.transform = 'translateY(0)';
  };

  const initialRenderRef = useRef(true);
  useEffect(() => {
    const timer = setTimeout(() => { initialRenderRef.current = false; }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Expand state for the height-changing answer sections, held above the
  // virtualized list so a message keeps its height across remount.
  const messageSections = useMessageSections();
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
                  />
                </div>
              </Suspense>
            ) : (
              <div className="chat-row">
                <div className="chat-column">
                  {chat.messages.length === 0 ? (
                    <div
                      className="messages-container"
                      style={{ position: 'relative' }}
                      ref={(el) => { attachHookRef(chat.messagesContainerRef, el); }}
                      onScroll={chat.handleScroll}
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
                        {noSources ? (
                          <div style={{ width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: isMobile ? '0 0.5rem' : undefined }}>
                            <div>
                              <h1 style={{ fontSize: isMobile ? '1.4rem' : '1.75rem', marginBottom: '0.5rem' }}>{t('emptyAddFirstSourceTitle')}</h1>
                              <p style={{ margin: 0 }}>{t('emptyAddFirstSourceSubtitle')}</p>
                            </div>

                            {/* Drag-and-drop drop zone — wired to the existing file-upload handlers */}
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => fileInputRef.current?.click()}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                              onDragOver={handleDragOver}
                              onDragEnter={handleDragEnter}
                              onDragLeave={handleDragLeave}
                              onDrop={handleDrop}
                              aria-label={t('uploadFile')}
                              style={{
                                border: `2px dashed ${isDragging ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                                borderRadius: '12px',
                                padding: '2rem 1.5rem',
                                background: isDragging ? 'var(--tag-bg)' : 'var(--bg-primary)',
                                cursor: 'pointer',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
                                transition: 'border-color 0.2s, background 0.2s',
                              }}
                            >
                              <UploadCloud size={32} aria-hidden="true" style={{ color: 'var(--accent-primary)' }} />
                              <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                {t('dropzoneTitle')} <span style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}>{t('dropzoneBrowse')}</span>
                              </div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('dropzoneTypes')}</div>
                            </div>

                            {/* "ODER AUS DEM WEB" divider */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-secondary)' }}>
                              <span style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
                              <span style={{ fontSize: '0.7rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{t('orFromWeb')}</span>
                              <span style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                              <button type="button" onClick={() => openWebTool('websearch')} style={webToolBtnStyle} onMouseEnter={webToolHoverIn} onMouseLeave={webToolHoverOut}>
                                <Search size={16} aria-hidden="true" /> {t('websearch')}
                              </button>
                              <button type="button" onClick={() => openWebTool('crawl')} style={webToolBtnStyle} onMouseEnter={webToolHoverIn} onMouseLeave={webToolHoverOut}>
                                <Globe size={16} aria-hidden="true" /> {t('emptyWebCrawl')}
                              </button>
                              <button type="button" onClick={() => openWebTool('research')} style={webToolBtnStyle} onMouseEnter={webToolHoverIn} onMouseLeave={webToolHoverOut}>
                                <FlaskConical size={16} aria-hidden="true" /> {t('research')}
                              </button>
                            </div>

                            {/* Studio value-framing chips */}
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{t('studioAfterwards')}</div>
                              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'center', opacity: 0.65 }}>
                                {[t('flashcards'), t('slides'), t('podcast'), t('chart')].map(label => (
                                  <span key={label} className="source-tag" style={{ marginTop: 0 }}>{label}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <h1>{currentKb?.name}</h1>
                            <p>{t('kbHeaderDefault')}</p>
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', flexWrap: 'wrap', justifyContent: 'center', opacity: hasFiles ? 1 : 0.4, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : undefined, padding: isMobile ? '0 1rem' : undefined }}>
                              {(currentKb?.isGlobal && currentKb?.examplePrompts
                                ? currentKb.examplePrompts.split('\n').filter(p => p.trim())
                                : siteConfigs.example_prompts
                                  ? siteConfigs.example_prompts.split('\n').filter(p => p.trim())
                                  : [
                                    "Fasse die wichtigsten Punkte meiner Dokumente zusammen",
                                    "Was sind die wichtigsten Erkenntnisse in [Name des Dokuments]?"
                                  ]
                              ).map((prompt, idx) => (
                                <button
                                  type="button"
                                  key={idx}
                                  className="source-card"
                                  disabled={!hasFiles}
                                  style={{ width: isMobile ? '100%' : '220px', cursor: !hasFiles ? 'not-allowed' : 'pointer', textAlign: 'left', minHeight: isMobile ? '48px' : '80px', display: 'flex', alignItems: 'center' }}
                                  onClick={() => {
                                    if (!hasFiles) return;
                                    chat.setUserMessageInput(prompt.trim());
                                    chat.textareaRef.current?.focus();
                                  }}
                                >
                                  &quot;{prompt.trim()}&quot;
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </motion.div>
                    </div>
                  ) : (
                    <Virtuoso
                      className="messages-container"
                      style={{ height: '100%' }}
                      data={chat.messages}
                      initialTopMostItemIndex={Math.max(0, chat.messages.length - 1)}
                      // "auto", not "smooth". A streaming answer resizes the last
                      // item every token, and each resize restarts the smooth
                      // scroll animation; virtuoso also suppresses its size-change
                      // compensation for as long as a scroll is in progress and
                      // then applies the accumulated delta in one step, so the
                      // answer visibly lurches while it is being written.
                      followOutput="auto"
                      // Key by message id, not list position. Ids are remapped
                      // temp→real mid-stream and branch switches rebuild the
                      // array, so index keys let virtuoso's cached item sizes
                      // attach to the wrong message.
                      computeItemKey={(index: number, msg: Message) => msg?.id ?? index}
                      // Keep a screen of messages mounted and measured on either
                      // side. Halves the mid-scroll height revisions that jerk
                      // the scroll position (measured 13 jumps → 6).
                      increaseViewportBy={{ top: 2000, bottom: 2000 }}
                      // Report size changes synchronously instead of a frame
                      // late, so measurements don't lag the DOM while answers
                      // stream and resize.
                      skipAnimationFrameInResizeObserver
                      scrollerRef={(ref: HTMLElement | Window | null) => {
                        if (ref instanceof HTMLElement) {
                          attachHookRef(chat.messagesContainerRef, ref as HTMLDivElement);
                        } else if (ref === null) {
                          attachHookRef(chat.messagesContainerRef, null);
                        }
                      }}
                      onScroll={chat.handleScroll}
                      components={{
                        Footer: () => {
                          const lastMsg = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
                          const isDeepSearching = lastMsg?.isDeepSearch && !lastMsg?.content;
                          const showLoader = chat.loading && !(lastMsg?.reasoning && !lastMsg?.content);
                          return (
                            <>
                              {showLoader && (
                                <div className="message-bubble message-ai message-ai--streaming" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span className="loading-dots" aria-label={isDeepSearching ? t('searchingDeeper') : t('thinking')}>
                                    <span className="loading-dots__dot" />
                                    <span className="loading-dots__dot" />
                                    <span className="loading-dots__dot" />
                                  </span>
                                  {isDeepSearching ? t('searchingDeeper') : t('thinking')}
                                </div>
                              )}
                            </>
                          );
                        }
                      }}
                      itemContent={(index: number, msg: Message) => {
                        const bi = msg.id ? getBranchInfo(chat.messageTree, msg.id) : null;
                        const questionText = msg.role === 'ai' && msg.parentMessageId
                          ? (chat.messages.find((m: Message) => m.id === msg.parentMessageId)?.content ?? '')
                          : '';
                        return (
                          <MessageBubble
                            key={msg.id}
                            message={msg}
                            isStreaming={chat.loading && index === chat.messages.length - 1}
                            onPdfOpen={handlePdfSourceOpen}
                            onFollowUpClick={chat.handleFollowUpClick}
                            showFollowUps={!chat.loading && msg.role === 'ai' && index === chat.messages.length - 1}
                            branchInfo={bi}
                            onSwitchBranch={chat.handleSwitchBranch}
                            animationDelay={initialRenderRef.current ? Math.min(index * 0.05, 0.3) : 0}
                            onEdit={msg.role === 'user' && !msg.isEnhanced ? (chat.editingMessageId === msg.id ? chat.handleEditSubmit : chat.handleStartEdit) : undefined}
                            onFork={msg.role === 'ai' ? chat.handleForkFromMessage : undefined}
                            onCompare={bi ? chat.handleStartComparison : undefined}
                            onRegenerate={msg.role === 'ai' ? chat.handleRegenerate : undefined}
                            onFeedback={msg.role === 'ai' ? chat.handleFeedback : undefined}
                            isEditing={chat.editingMessageId === msg.id}
                            onEditCancel={handleEditCancel}
                            onPreviewSource={handlePreviewSource}
                            kbId={currentKb?.id}
                            questionText={questionText}
                            resolveAttribution={resolveAttribution}
                            reasoningOpen={messageSections.isOpen(msg.id, 'reasoning')}
                            sourcesOpen={messageSections.isOpen(msg.id, 'sources')}
                            confidenceOpen={messageSections.isOpen(msg.id, 'confidence')}
                            onToggleSection={messageSections.toggle}
                          />
                        );
                      }}
                    />
                  )}

                  <div className="input-container">
                    {chat.forkPointId && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '6px 12px',
                        marginBottom: '0.5rem',
                        background: 'var(--tag-bg)',
                        border: '1px solid var(--accent-primary)',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        color: 'var(--accent-primary)',
                      }}>
                        <GitBranch size={14} />
                        <span>{language === 'en' ? 'Branching — type a different follow-up' : 'Abzweigung — gib eine andere Frage ein'}</span>
                        <button
                          onClick={() => {
                            chat.setForkPointId(null);
                            const leaf = findDefaultLeaf(chat.messageTree);
                            if (leaf) chat.setActiveLeafId(leaf);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-secondary)',
                            padding: '2px',
                            minWidth: '44px',
                            minHeight: '44px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginLeft: '4px',
                          }}
                          title={language === 'en' ? 'Cancel fork' : 'Abzweigung abbrechen'}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    {showSystemPrompt && currentKb && canEditSystemPrompt && (
                      <div style={{ marginBottom: '0.75rem', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <label htmlFor="chat-system-prompt" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            {t('systemPromptLabel')}
                          </label>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                            {systemPromptDraft.length} / 8000
                          </span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 6px' }}>{t('systemPromptDescription')}</p>
                        <textarea
                          id="chat-system-prompt"
                          value={systemPromptDraft}
                          onChange={(e) => setSystemPromptDraft(e.target.value)}
                          placeholder={t('systemPromptPlaceholder')}
                          maxLength={8000}
                          rows={3}
                          style={{
                            width: '100%',
                            padding: '0.6rem',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            resize: 'vertical',
                            fontFamily: 'inherit',
                            fontSize: '0.85rem',
                          }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '6px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSystemPromptDraft('');
                              handleUpdateKBSettings({ systemPrompt: null });
                              setShowSystemPrompt(false);
                            }}
                            className="icon-button"
                            style={{ color: 'var(--error-color, #e53e3e)', padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                            title={language === 'en' ? 'Delete system prompt' : 'System-Prompt löschen'}
                          >
                            <Trash2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const newValue = systemPromptDraft || null;
                              if (newValue !== (currentKb.systemPrompt || null)) {
                                handleUpdateKBSettings({ systemPrompt: newValue });
                              }
                              setShowSystemPrompt(false);
                            }}
                            className="icon-button"
                            style={{ color: 'var(--accent-primary)', padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                            title={language === 'en' ? 'Save system prompt' : 'System-Prompt speichern'}
                          >
                            <Check size={14} />
                          </button>
                        </div>
                        {/* All agent controls live here with the system prompt,
                            because they answer the same question: how should
                            this KB behave? Two jobs, deliberately adjacent —
                            KbAgentsSection sets which agents are AVAILABLE on
                            the KB, AgentPicker sets which one answers THIS
                            chat (sticky on chats.agent_id). */}
                        <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                          {/* Only the AVAILABILITY half is gated. KbAgentsSection
                              writes through PUT/DELETE /api/kb/{id}/agents|teams,
                              which are on kbAdvancedChain, so an owner without one
                              of {api-user, admin, superadmin} would get a 403 out
                              of every toggle in it. AgentPicker below reads the
                              view-gated list and writes only to this chat, so it
                              stays offered to everyone — as does the system-prompt
                              editor above, which is plain kbAdminChain. */}
                          {canTuneKB && <KbAgentsSection kbId={currentKb.id} onCreateAgent={onViewAgents} />}
                          <AgentPicker
                            kbId={currentKb.id}
                            selection={agentSelection}
                            onSelect={setAgentSelection}
                          />
                        </div>
                      </div>
                    )}
                    {noSources && (
                      <div style={{ textAlign: 'center', marginBottom: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {t('chatDisabledNoSources')}
                      </div>
                    )}
                    <PromptInput
                      id="chat-composer"
                      shape="pill"
                      multiple
                      onSubmit={(_message, e) => chat.handleSendMessage(e)}
                      className={noSources ? 'pointer-events-none opacity-55' : undefined}
                      aria-disabled={noSources || undefined}
                    >
                      {/* Attached files: a header row above the input line, present only while files are attached */}
                      <PromptInputAttachments id="chat-composer-attachments" className="order-first basis-full flex-nowrap overflow-x-auto border-b border-outline-variant px-3 pt-3 pb-2">
                        {(file) => <PromptInputAttachment data={file} className="shrink-0" />}
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
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>{t('capabilities')}</DropdownMenuLabel>
                            <PromptInputActionMenuItem
                              id="chat-composer-web-search-toggle"
                              role="menuitemcheckbox"
                              aria-checked={webSearch}
                              selected={webSearch}
                              onSelect={() => setWebSearch(!webSearch)}
                            >
                              <Globe className="mr-2 size-4" aria-hidden="true" />
                              <span className="flex-1">{t('webSearchTool')}</span>
                              {webSearch && <Check size={14} aria-hidden="true" />}
                            </PromptInputActionMenuItem>
                          </PromptInputActionMenuContent>
                        </PromptInputActionMenu>
                        {webSearch && (
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
                        {/* N sources active — a label, not a control */}
                        <span
                          id="chat-composer-sources-count"
                          className="inline-flex items-center gap-1 whitespace-nowrap px-2 text-sm text-on-surface-variant"
                          title={t('activeSources')}
                          aria-label={`${selectedFileCount} ${t('sources')}`}
                        >
                          <FileText size={16} aria-hidden="true" />
                          <span aria-hidden="true">{selectedFileCount}</span>
                        </span>
                        <PromptInputSubmit
                          id="chat-composer-submit"
                          className="size-10"
                          status={chat.loading ? 'submitted' : undefined}
                          disabled={chat.loading || selectedFileCount === 0 || !chat.userMessageInput.trim()}
                          aria-label={t('sendMessage')}
                        >
                          <ArrowUp aria-hidden="true" />
                        </PromptInputSubmit>
                      </InputGroupAddon>
                    </PromptInput>
                    <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {siteConfigs.chat_footer || t('chatFooter')}
                    </div>
                  </div>
                </div>
                {!isMobile && (
                  <BranchTreeNav
                    messageTree={chat.messageTree}
                    activeLeafId={chat.activeLeafId}
                    onSelectBranch={(leafId) => {
                      chat.setActiveLeafId(leafId);
                      chat.setForkPointId(null);
                    }}
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
    </div>
  );
};

export const ChatView = memo(ChatViewComp);
