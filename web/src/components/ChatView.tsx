import { lazy, Suspense, memo, useCallback, useRef, useEffect, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  ArrowLeft, BookOpen, Brain, Send,
  BarChart2, MessageSquare, UserPlus, X, Search, GitBranch, Settings, Check, Trash2, SlidersHorizontal, Network,
  UploadCloud, Globe, FlaskConical, Sparkles, ChevronDown, FileText, Bot, Users,
} from 'lucide-react';
import { AnchoredPopover } from './AnchoredPopover';
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
import MessageBubble from '../MessageBubble';
import { findDefaultLeaf, getBranchInfo } from '../utils/messageTree';
import { HAPTIC_PATTERNS, triggerHaptic } from '../utils/haptics';
import { viewportHeight } from '../utils/viewport';
import { canOpenKbAdvancedSettings } from '../utils/kbAccess';
import { BranchTreeNav } from './BranchTreeNav';
import { KbHeaderTitle } from './KbHeaderTitle';
import { MessageSkeleton } from './Skeleton';
import { BackgroundJobsIndicator } from './BackgroundJobsIndicator';
import { registerJob, unregisterJob } from '../utils/jobRegistry';

const Dashboard = lazy(() => import('../Dashboard'));
const ResearchMode = lazy(() => import('./ResearchMode'));
const AcademicMode = lazy(() => import('./AcademicMode'));
const KbSettingsPanelLazy = lazy(() => import('./kb-settings/KbSettingsPanel').then(m => ({ default: m.KbSettingsPanel })));
const StudioWorkspace = lazy(() => import('./Studio/StudioWorkspace').then(module => ({ default: module.StudioWorkspace })));
const MindMapView = lazy(() => import('./MindMap/MindMapView').then(module => ({ default: module.MindMapView })));
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
  const { language, setLanguage, t } = useTheme();
  const { user, siteConfigs } = useAuth();
  const isMobile = useIsMobileContext();
  const reducedMotion = useReducedMotion();

  const {
    currentKb, availableConfigs, kbView, setKbView, handleGoHome, handleUpdateKBSettings, onViewAgents,
    scopedMindmapMessageId, onViewGraphForMessage, onCloseMindmap, onShowWholeKb, kbMgmt,
  } = useKbCore();
  const {
    chat, enhance, setEnhance, reasoningEnabled, setReasoningEnabled,
    setResearchRunning, setAcademicResearchRunning,
    agentSelection, setAgentSelection,
  } = useKbChat();
  const { fileMgmt, webTools, content, sharing, handleSelectContent } = useKbData();
  const { sidebar } = useKbLayout();

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

  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [systemPromptDraft, setSystemPromptDraft] = useState(currentKb?.systemPrompt || '');
  const [showKbSettings, setShowKbSettings] = useState(false);
  // §8 composer: "✦ Verbessern ▾" dropdown holding rewrite/expand/spell.
  const [showEnhanceMenu, setShowEnhanceMenu] = useState(false);
  const enhanceBtnRef = useRef<HTMLButtonElement>(null);

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

  const handleResearchRunningChange = useCallback((running: boolean) => {
    setResearchRunning(running);
    if (running) registerJob(currentKb?.id || '', currentKb?.name || '', 'research');
    else unregisterJob(currentKb?.id || '', 'research');
  }, [currentKb?.id, currentKb?.name, setResearchRunning]);

  const handleAcademicResearchRunningChange = useCallback((running: boolean) => {
    setAcademicResearchRunning(running);
    if (running) registerJob(currentKb?.id || '', currentKb?.name || '', 'academicResearch');
    else unregisterJob(currentKb?.id || '', 'academicResearch');
  }, [currentKb?.id, currentKb?.name, setAcademicResearchRunning]);

  const {
    hasFiles, selectedFileCount, fileInputRef,
    isDragging, handleDragOver, handleDragEnter, handleDragLeave, handleDrop,
  } = fileMgmt;
  const { handlePreviewSource, handlePdfSourceOpen, setToolTab } = webTools;
  const { handleGenerate, selectedContent } = content;
  const { handleOpenShare } = sharing;

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

  const viewTabStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: isMobile ? '0' : '6px',
    padding: isMobile ? '6px 8px' : '6px 12px',
    minHeight: isMobile ? '44px' : undefined,
    borderRadius: '6px',
    border: 'none',
    background: active ? 'var(--bg-primary)' : 'transparent',
    color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
    transition: 'all 0.2s',
  });

  return (
    <div className="chat-area" style={isMobile ? { height: viewportHeight('calc(100dvh - 60px)', 'calc(100vh - 60px)') } : undefined}>
      <header className="chat-header" style={isMobile ? { padding: '0.75rem' } : undefined}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '12px', minWidth: 0 }}>
          {/* Zurück steht links von Symbol und Titel — also ganz am Anfang der
              Kopfleiste. Bis 2026-08 saß der Desktop-Knopf in der Quellenleiste;
              seit die nach rechts gewandert ist, lag er auf der falschen Seite
              des Bildschirms und weit weg vom Titel, zu dem er gehört.
              `handleGoHome` und nicht `handleViewHome`: Verlassen setzt kbView
              auf 'chat' zurück, sonst landet man beim nächsten Öffnen der KB
              wieder im zuletzt gewählten Reiter (z.B. 'workspace'). */}
          <button
            onClick={handleGoHome}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px', color: 'var(--text-secondary)' }}
            title={t('backToOverview')}
            aria-label={t('backToOverview')}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          {!isMobile && (
            <div style={{ padding: '8px', background: 'var(--tag-bg)', borderRadius: '8px', color: 'var(--accent-primary)' }}>
              <BookOpen size={20} aria-hidden="true" />
            </div>
          )}
          <KbHeaderTitle kb={currentKb} systemRole={user?.role} onRename={kbMgmt.handleRenameKB} compact={isMobile} />
          <div style={{ display: 'flex', marginLeft: isMobile ? '4px' : '24px', gap: '4px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '8px' }}>
            <button onClick={() => setKbView('chat')} style={viewTabStyle(kbView === 'chat')} aria-current={kbView === 'chat' ? 'page' : undefined} aria-label="Chat">
              <MessageSquare size={16} aria-hidden="true" />
              {!isMobile && 'Chat'}
            </button>
            {currentKb?.isGlobal && (user?.role === 'admin' || user?.role === 'superadmin') && (
              <button onClick={() => setKbView('dashboard')} style={viewTabStyle(kbView === 'dashboard')} aria-current={kbView === 'dashboard' ? 'page' : undefined} aria-label={t('analytics')}>
                <BarChart2 size={16} aria-hidden="true" />
                {!isMobile && t('analytics')}
              </button>
            )}
            <button
              onClick={() => setKbView('research')}
              style={viewTabStyle(kbView === 'research')}
              title={t('research')}
              aria-current={kbView === 'research' ? 'page' : undefined}
              aria-label={t('research')}
            >
              <Search size={16} aria-hidden="true" />
              {!isMobile && t('research')}
            </button>
            <button
              onClick={() => setKbView('mindmap')}
              style={viewTabStyle(kbView === 'mindmap')}
              title={t('mindMap')}
              aria-current={kbView === 'mindmap' ? 'page' : undefined}
              aria-label={t('mindMap')}
            >
              <Network size={16} aria-hidden="true" />
              {!isMobile && t('mindMap')}
            </button>
            <button
              onClick={() => setKbView('workspace')}
              style={viewTabStyle(kbView === 'workspace')}
              title={t('workspace')}
              aria-current={kbView === 'workspace' ? 'page' : undefined}
              aria-label={t('workspace')}
            >
              <Sparkles size={16} aria-hidden="true" />
              {!isMobile && t('workspace')}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px' }}>
          <BackgroundJobsIndicator />
          {!isMobile && (
            <>
              <button
                onClick={() => setLanguage(language === 'de' ? 'en' : 'de')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-secondary)',
                  padding: '4px',
                  fontWeight: 600,
                  fontSize: '0.85rem'
                }}
                title={t('switchLanguage')}
                aria-label={t('switchLanguage')}
              >
                {language.toUpperCase()}
              </button>
              {canTuneKB && (
                <button
                  type="button"
                  onClick={() => setShowKbSettings(true)}
                  style={{
                    background: showKbSettings ? 'var(--tag-bg)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    color: showKbSettings ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    padding: '4px',
                    borderRadius: '6px',
                  }}
                  title={t('kbTuning')}
                  aria-label={t('kbTuning')}
                  aria-pressed={showKbSettings}
                >
                  <SlidersHorizontal size={20} aria-hidden="true" />
                </button>
              )}
              {/* Deliberately NO KB-settings trigger here (2026-08-12): users
                  are not meant to control their KB's AI provider or models.
                  Consequence: SettingsModal is unreachable again. It is kept
                  because it holds the ONLY UI for provider + chat/embedding/
                  rerank/tts model selection, which an operator surface will
                  need. To revive: render a button calling setShowSettings(true).
                  Agent controls are NOT here — they live in the composer's
                  system-prompt panel. */}
            </>
          )}
          {currentKb?.userId === user?.id && (
            <button
              type="button"
              onClick={(e) => handleOpenShare(currentKb, e)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: 'var(--text-secondary)',
                padding: '4px',
              }}
              title={t('shareKb')}
              aria-label={t('shareKb')}
            >
              <UserPlus size={20} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>


      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {
          kbView === 'chat' ? (
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
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, maxWidth: '100%' }}>
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
                            onViewGraph={msg.role === 'ai' ? onViewGraphForMessage : undefined}
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
                    {showSystemPrompt && currentKb && currentKb.userId === user?.id && (
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
                    <form className="input-wrapper" onSubmit={chat.handleSendMessage} style={noSources ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {currentKb && currentKb.userId === user?.id && (
                          <button
                            type="button"
                            onClick={() => setShowSystemPrompt(!showSystemPrompt)}
                            className="settings-toggle"
                            style={{
                              position: 'static',
                              color: showSystemPrompt || currentKb.systemPrompt ? 'var(--accent-primary)' : 'var(--text-secondary)',
                              background: showSystemPrompt || currentKb.systemPrompt ? 'var(--tag-bg)' : 'transparent',
                              padding: '4px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s',
                              border: showSystemPrompt || currentKb.systemPrompt ? '1px solid var(--accent-primary)' : '1px solid transparent',
                            }}
                            title={t('systemPromptLabel')}
                            aria-label={t('systemPromptLabel')}
                            aria-pressed={showSystemPrompt}
                          >
                            <Settings size={20} aria-hidden="true" />
                          </button>
                        )}
                        {(() => {
                          const selectedConfig = availableConfigs.find(c => c.id === currentKb?.aiConfigId) || availableConfigs.find(c => c.is_active);
                          const model = currentKb?.chatModel || (selectedConfig ? selectedConfig.chat_models[0] : null);
                          const isReasoningCapable = selectedConfig?.reasoning_models?.includes(model || '') || false;

                          if (!isReasoningCapable) return null;

                          return (
                            <button
                              type="button"
                              onClick={() => {
                                triggerHaptic(HAPTIC_PATTERNS.toggle);
                                setReasoningEnabled(!reasoningEnabled);
                              }}
                              className="settings-toggle"
                              style={{
                                position: 'static',
                                color: reasoningEnabled ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                background: reasoningEnabled ? 'var(--tag-bg)' : 'transparent',
                                padding: '4px',
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s',
                                border: reasoningEnabled ? '1px solid var(--accent-primary)' : '1px solid transparent'
                              }}
                              title={t('reasoningMode')}
                              aria-label={t('reasoningToggle')}
                              aria-pressed={reasoningEnabled}
                            >
                              <Brain size={20} aria-hidden="true" />
                            </button>
                          );
                        })()}
                        {(agentSelection.teamId || agentSelection.agentId) && (
                          <span className="agent-active-chip">
                            {agentSelection.teamId ? <Users size={13} aria-hidden="true" /> : <Bot size={13} aria-hidden="true" />}
                            {t('agentActiveChip')}{' '}
                            {agentSelection.teamId
                              ? kbAgentOptions.teams.find(x => x.id === agentSelection.teamId)?.name
                              : kbAgentOptions.agents.find(x => x.id === agentSelection.agentId)?.name}
                          </span>
                        )}
                        {/* N Quellen ▾ — which sources are active; opens the sources sidebar */}
                        <button
                          type="button"
                          onClick={() => sidebar.setIsRightSidebarOpen(true)}
                          className="settings-toggle"
                          style={{
                            position: 'static',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            color: 'var(--text-secondary)',
                            background: 'transparent',
                            border: '1px solid transparent',
                            fontSize: '0.78rem',
                            whiteSpace: 'nowrap',
                          }}
                          title={t('activeSources')}
                          aria-label={t('activeSources')}
                        >
                          <FileText size={16} aria-hidden="true" />
                          <span>{selectedFileCount}</span>
                          <ChevronDown size={12} aria-hidden="true" />
                        </button>
                      </div>
                      <label htmlFor="chat-message-input" className="sr-only">{t('chatPlaceholder')}</label>
                      <textarea
                        id="chat-message-input"
                        ref={(el) => { attachHookRef(chat.textareaRef, el); }}
                        className="chat-input"
                        enterKeyHint="send"
                        placeholder={currentKb?.name ? t('chatPlaceholderContextual').replace('{{name}}', currentKb.name) : t('chatPlaceholder')}
                        value={chat.userMessageInput}
                        onChange={(e) => chat.setUserMessageInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            chat.handleSendMessage(e);
                          }
                        }}
                        rows={1}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {/* ✦ Verbessern ▾ — rewrite / expand / spell; enabled only once a draft is typed */}
                        <button
                          ref={enhanceBtnRef}
                          type="button"
                          onClick={() => setShowEnhanceMenu(o => !o)}
                          disabled={!chat.userMessageInput.trim()}
                          className="settings-toggle"
                          style={{
                            position: 'static',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            color: enhance ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            background: enhance ? 'var(--tag-bg)' : 'transparent',
                            border: enhance ? '1px solid var(--accent-primary)' : '1px solid transparent',
                            cursor: chat.userMessageInput.trim() ? 'pointer' : 'not-allowed',
                            opacity: chat.userMessageInput.trim() ? 1 : 0.5,
                            fontSize: '0.8rem',
                            whiteSpace: 'nowrap',
                          }}
                          title={chat.userMessageInput.trim() ? t('enhanceLabel') : t('enhanceNeedsDraft')}
                          aria-label={t('enhanceLabel')}
                          aria-haspopup="menu"
                          aria-expanded={showEnhanceMenu}
                        >
                          <Sparkles size={16} aria-hidden="true" />
                          {!isMobile && <span>{t('enhanceLabel')}</span>}
                          <ChevronDown size={12} aria-hidden="true" />
                        </button>
                        <AnchoredPopover
                          open={showEnhanceMenu}
                          triggerRef={enhanceBtnRef}
                          onClose={() => setShowEnhanceMenu(false)}
                          placement="top"
                          align="end"
                          width={190}
                          role="menu"
                          ariaLabel={t('enhanceLabel')}
                        >
                          <div style={{ padding: '4px' }}>
                            {(['rewrite', 'expand', 'spell'] as const).map(m => (
                              <button
                                key={m}
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={enhance === m}
                                onClick={() => { setEnhance(enhance === m ? null : m); setShowEnhanceMenu(false); }}
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  width: '100%', textAlign: 'left', background: 'none', border: 'none',
                                  padding: '6px 10px', cursor: 'pointer', borderRadius: '4px',
                                  color: enhance === m ? 'var(--accent-primary)' : 'var(--text-primary)',
                                  fontSize: '0.85rem', fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--tag-bg)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                              >
                                {m === 'rewrite' ? t('rewrite') : m === 'expand' ? t('expand') : t('spell')}
                                {enhance === m && <Check size={14} aria-hidden="true" />}
                              </button>
                            ))}
                          </div>
                        </AnchoredPopover>
                        <button type="submit" className="send-button" disabled={chat.loading || selectedFileCount === 0 || !chat.userMessageInput.trim()} aria-label={t('sendMessage')}>
                          <Send size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </form>
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
          ) : kbView === 'research' ? (
            <Suspense fallback={chatSuspenseFallback}>
              <div className="content-fade-in" style={{ flex: 1, overflow: 'hidden', padding: '1rem' }}>
                <ResearchMode
                  key={chat.loadedResearchSession?.id || 'new'}
                  kbId={currentKb?.id || ''}
                  onClose={() => setKbView('chat')}
                  loadedSession={chat.loadedResearchSession}
                  onSessionSaved={() => {
                    if (currentKb) chat.fetchChats(currentKb.id);
                  }}
                  onClearSession={() => chat.setLoadedResearchSession(null)}
                  onRunningChange={handleResearchRunningChange}
                />
              </div>
            </Suspense>
          ) : kbView === 'academic_research' ? (
            <Suspense fallback={chatSuspenseFallback}>
              <div className="content-fade-in" style={{ flex: 1, overflow: 'hidden', padding: '1rem' }}>
                <AcademicMode
                  key={chat.loadedAcademicSession?.id || 'new'}
                  kbId={currentKb?.id || ''}
                  onClose={() => setKbView('chat')}
                  loadedSession={chat.loadedAcademicSession}
                  onSessionSaved={() => {
                    if (currentKb) chat.fetchChats(currentKb.id);
                  }}
                  onClearSession={() => chat.setLoadedAcademicSession(null)}
                  onRunningChange={handleAcademicResearchRunningChange}
                />
              </div>
            </Suspense>
          ) : kbView === 'workspace' ? (
            <Suspense fallback={chatSuspenseFallback}>
              <div className="content-fade-in" style={{ flex: 1, overflow: 'hidden' }}>
                <StudioWorkspace
                  kbId={currentKb?.id || ''}
                  onGenerate={handleGenerate}
                  onClose={() => setKbView('chat')}
                  selectedItem={selectedContent ?? null}
                  hasFiles={hasFiles}
                  onAnalysisCreated={(item) => {
                    if (currentKb) content.fetchGeneratedContent(currentKb.id);
                    handleSelectContent(item);
                  }}
                  onStartComparison={async (v) => {
                    // Switch to Chat only on success: on a failed upload the
                    // user stays in the Workspace with the dialog open (see
                    // StudioWorkspace's `started !== false` check) and the
                    // toast explaining why, instead of being yanked to an
                    // empty chat. The returned boolean also has to travel
                    // back up (not just void the promise) — StudioWorkspace
                    // awaits it to decide whether to close the dialog.
                    const started = await chat.startComparison(v);
                    if (started) setKbView('chat');
                    return started;
                  }}
                />
              </div>
            </Suspense>
          ) : kbView === 'mindmap' ? (
            <Suspense fallback={chatSuspenseFallback}>
              <div className="content-fade-in" style={{ flex: 1, overflow: 'hidden' }}>
                <MindMapView
                  key={currentKb?.id || 'mindmap'}
                  kbId={currentKb?.id || ''}
                  messageId={scopedMindmapMessageId}
                  onAskAbout={(name) => {
                    setKbView('chat');
                    // Restore the history sidebar (left), not Sources: this
                    // mirrors the pre-rework intent of bringing back
                    // whichever sidebar the mindmap had displaced, and
                    // history is the closer analog now that Sources lives on
                    // the right permanently.
                    sidebar.setIsLeftSidebarOpen(true);
                    chat.handleFollowUpClick(`${t('mindMapAskPrompt')} ${name}`);
                  }}
                  onOpenSource={(fileId, fileName) => handlePreviewSource(fileId, fileName)}
                  onClose={() => {
                    onCloseMindmap();
                    // See onAskAbout above: restore history (left), not Sources.
                    sidebar.setIsLeftSidebarOpen(true);
                  }}
                  onShowWholeKb={onShowWholeKb}
                />
              </div>
            </Suspense>
          ) : (
            <Suspense fallback={chatSuspenseFallback}>
              <div className="content-fade-in" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <Dashboard kbId={currentKb?.id || ''} kbName={currentKb?.name || ''} />
              </div>
            </Suspense>
          )
        }
      </main>
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
