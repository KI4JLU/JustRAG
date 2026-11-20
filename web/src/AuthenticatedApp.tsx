import { useState, lazy, Suspense, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { BreadcrumbBack } from '@ki4jlu/design-system';
import type { KnowledgeBase, GeneratedContent } from './types';
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './contexts/AuthContext';
import { ModalProvider, useModalContext } from './contexts/ModalContext';
import { useToast } from './contexts/ToastContext';
import type { KbCoreContextValue } from './contexts/KbCoreContext';
import type { KbChatContextValue } from './contexts/KbChatContext';
import type { KbDataContextValue } from './contexts/KbDataContext';
import type { KbLayoutContextValue } from './contexts/KbLayoutContext';
import { AppNavProvider, type AppNavContextValue } from './contexts/AppNavContext';
import { KbSearchProvider } from './contexts/KbSearchContext';
import { ChatHistoryStore, type ChatHistoryHost } from './components/history/ChatHistoryStore';
import { topicSection } from './utils/topicSection';

// Hooks
import { useSidebarResize } from './hooks/useSidebarResize';
import { useChat } from './hooks/useChat';
import { useFileManagement } from './hooks/useFileManagement';
import { useUploadStorageNotice } from './hooks/useUploadStorageNotice';
import { UploadStorageNoticeDialog } from './components/UploadStorageNoticeDialog';
import { useWebTools } from './hooks/useWebTools';
import { useGeneratedContent } from './hooks/useGeneratedContent';
import { useKnowledgeBases } from './hooks/useKnowledgeBases';
import { useJoinRedeem } from './hooks/useJoinRedeem';
import { useKbSearchState } from './hooks/useKbSearchState';
import { useSearchNavigation } from './hooks/useSearchNavigation';
import { useRssFeeds } from './hooks/useRssFeeds';
import { useConfluenceSources } from './hooks/useConfluenceSources';
import { useGitRepoSources } from './hooks/useGitRepoSources';
import { useViewState } from './hooks/useViewState';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useAppNavigate, useAppRoute } from './routing/navigation';
import { useKbSettings } from './hooks/useKbSettings';
import { useKbLifecycle } from './hooks/useKbLifecycle';
import { openTopicSettings, useTopicSettings } from './hooks/useTopicSettings';
import { openSettingsDialog } from './hooks/settingsDialog';
import { useChatRoute, useChatTopic } from './hooks/useChatRoute';

// Components
import { MyTopicsView } from './components/MyTopicsView';
import { SharedTopicsView } from './components/SharedTopicsView';
import { DiscoverView } from './components/DiscoverView';
import { AppFrame, WorkspaceProviders, type AppChromeView, type WorkspaceFrame } from './components/AppChrome';
import { ChatView } from './components/ChatView';
import { KbWorkspaceModals } from './components/KbWorkspaceModals';

// Lazy load heavy components
const GlobalKbSettings = lazy(() => import('./components/GlobalKbSettings').then(module => ({ default: module.GlobalKbSettings })));
const KbSettingsPanel = lazy(() => import('./components/kb-settings/KbSettingsPanel').then(module => ({ default: module.KbSettingsPanel })));

import { LegalPage } from './components/LegalPage';
import { PolicyAcceptanceGate } from './components/PolicyAcceptanceDialog';
import { viewportHeight } from './utils/viewport';
import { chatWebSearchRequestField } from './utils/chatWebSearch';
import { kbSourceRights } from './utils/kbAccess';

// Lazy Loaded Components
const AgentsView = lazy(() => import('./components/agents/AgentsView'));

const LoadingFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%' }}>
    <Loader2 className="animate-spin" size={32} color="var(--accent-primary)" />
  </div>
);

export default function AuthenticatedApp() {
  /* `ToastProvider` and `ToastContainer` used to be here, inside
   * `ModalProvider`. They moved up to App.tsx's root (card KI-740) because
   * this component is only the AUTHENTICATED half of the tree, and
   * `LegalPage` — rendered by `Login` on the unauthenticated route — calls
   * `useToast()`, so the legal pages threw before login. They are NOT
   * duplicated here: exactly one provider and one container exist in the
   * tree, and a nested second provider would split the toast store in two.
   *
   * `ModalProvider` stays. It has the identical shape — mounted on the
   * authenticated half only — but no current trigger: the app components
   * `Login` renders are `Footer`, `FieldRow` and `LegalPage` (everything
   * else in it comes from @ki4jlu/design-system), and none of those three,
   * nor `AppUpdateProvider`, imports `contexts/ModalContext` at all. Every
   * `useModalContext()` call site sits inside this authenticated tree —
   * `grep -rn "useModalContext()" src` is the check, and it is a grep and
   * not a number here on purpose, so it cannot go stale. Moving the
   * provider anyway would have been a second, unmotivated change in the
   * KI-740 diff. If an unauthenticated surface ever does need a confirm
   * dialog, it has the same latent bug and the same fix applies.
   */
  return (
    <ModalProvider>
      {/* Over every view: the AI-use notice until the user accepted it. */}
      <PolicyAcceptanceGate>
        <AuthenticatedAppInner />
      </PolicyAcceptanceGate>
      <UploadStorageNoticeDialog />
    </ModalProvider>
  );
}

function AuthenticatedAppInner() {
  // `resolvedTheme`, not `theme`: since KI-779 `theme` can be `'system'`, and
  // `data-theme="system"` matches no design-system rule. This attribute is a
  // NESTED mirror of the one the DS ThemeProvider writes on <html>, so it has
  // to carry the resolved value or the container would silently stop matching
  // `[data-theme="dark"]` for every OS-following user.
  const { resolvedTheme, t } = useTheme();
  const { user, token, siteConfigs } = useAuth();
  const { showConfirm } = useModalContext();
  const toast = useToast();

  // The URL names the view (routing/routes.ts); `navigateTo` changes it.
  const route = useAppRoute();
  const { view } = route;
  const navigateTo = useAppNavigate();

  // Local state kept here to avoid circular deps with useKnowledgeBases
  const [currentKb, setCurrentKb] = useState<KnowledgeBase | null>(null);
  // A chat URL (`/c/<id>`) names the chat alone; its topic is the chat's own.
  const routeChatId = route.view === 'chat' ? route.chatId : null;
  const chatTopic = useChatTopic(routeChatId);
  /** A topic's workspace: its new chat (`/kb/<id>`) or one of its chats (`/c/<id>`). */
  const onWorkspace = view === 'kb' || view === 'chat';

  /* The advanced settings page (RAG settings, evals, workflow; KbSettingsPanel)
   * deliberately has NO URL: it is experimental and partly deprecated, so it
   * is reachable from „RAG-Settings" in the admin console's KB-Übersicht
   * (system admins) but is not part of the URL schema. Opening it pushes a
   * history entry with the same URL — the console's `?admin=kb-overview` —
   * that names the topic in its state, and the page is that state. So leaving
   * it, by its breadcrumb or the browser's back, returns to the KB-Übersicht,
   * and any other navigation closes it. */
  const router = useRouter();
  const advanced = (useLocation().state as { ragSettingsKb?: { id: string; name: string } } | undefined)?.ragSettingsKb ?? null;
  const openAdvancedSettings = useCallback((kb: { id: string; name: string }) => {
    router.history.push(router.history.location.href, { ragSettingsKb: { id: kb.id, name: kb.name } });
  }, [router]);

  // New extracted hooks
  const kbSettings = useKbSettings();
  const goHome = useCallback(() => navigateTo({ view: 'my-topics' }), [navigateTo]);
  const viewState = useViewState({
    // The swipe follows the tabs AppFrame renders (no 'files'
    // without seeSources).
    showFilesTab: kbSourceRights(currentKb, user?.role, user?.id).seeSources,
  });



  // Sidebar resize
  const sidebar = useSidebarResize();
  // Existing hooks
  // A user's first source upload raises the notice on how long uploads are kept.
  const { confirm: confirmStorageNotice } = useUploadStorageNotice(user.id, 'source');
  const fileMgmt = useFileManagement({ currentKb, confirmUpload: confirmStorageNotice });

  const chat = useChat({
    currentKb, files: fileMgmt.files, enhance: kbSettings.enhance,
    reasoningEnabled: kbSettings.reasoningEnabled,
    // Gate open: the toggle's value. Gate closed: undefined, so `webSearch` is
    // left out of the request — never `true` (a 422) and never `false` (which
    // would override chat_answer_tools_enabled). Same predicate the composer
    // hides the toggle by.
    webSearchEnabled: chatWebSearchRequestField(siteConfigs, kbSettings.webSearchEnabled),
    reasoningLevel: kbSettings.reasoningLevel,
    agentSelection: kbSettings.agentSelection, setAgentSelection: kbSettings.setAgentSelection,
  });

  /* The topic the URL names, once it is the open one. A topic view renders
   * from this, never from `currentKb` directly: after back/forward the URL
   * already names the next topic while `currentKb` is still the previous one
   * until the route sync below has loaded it.
   *
   * A chat URL whose chat is the one on screen belongs to the open topic, with
   * no lookup: a new chat's first answer switches `/kb/<id>` to `/c/<chat>`,
   * and waiting even one render for the chat's topic would drop the workspace
   * for a spinner and mount it again — a visible flicker mid-answer. */
  const routeKbId = 'kbId' in route ? route.kbId
    : routeChatId && routeChatId === chat.activeChatId && currentKb ? currentKb.id
    : chatTopic.topic?.status === 'found' ? chatTopic.topic.kbId
    : null;
  const routeKb = currentKb && currentKb.id === routeKbId ? currentKb : null;
  // Thema-Einstellungen: open for one topic at a time (see useTopicSettings).
  const topicSettings = useTopicSettings(onWorkspace && routeKb !== null);

  const webTools = useWebTools({
    currentKb,
    fetchFiles: fileMgmt.fetchFiles,
    files: fileMgmt.files,
  });

  const { rssFeeds, rssLoading, fetchRssFeeds, addRssFeed, updateRssFeed, deleteRssFeeds, pollFeedNow, pollingFeedIds } = useRssFeeds({
    currentKb,
    fetchFiles: fileMgmt.fetchFiles,
  });

  const confluenceHook = useConfluenceSources({
    currentKb,
    fetchFiles: fileMgmt.fetchFiles,
  });

  const gitRepoHook = useGitRepoSources({
    currentKb,
    fetchFiles: fileMgmt.fetchFiles,
  });

  const content = useGeneratedContent({ currentKb });

  const kbMgmt = useKnowledgeBases({
    onKBSelected: chat.handleNewChat,
    handleGoHome: goHome,
    setCurrentKb, setIsPro: kbSettings.setIsPro, navigateTo,
    setSelectedContent: content.setSelectedContent,
    setGeneratedContent: content.setGeneratedContent,
  });

  /* URL -> open topic. When the URL names a topic that is not the open one —
   * a deep link, a reload, back/forward between topics — load it and open it
   * without navigating (the URL is already right). A topic opened by a click
   * sets `currentKb` before it navigates, so this finds nothing to do.
   *
   * Keyed on the two ids alone; the callbacks are read from a ref so a list
   * refresh or a new callback identity mid-request does not cancel and
   * repeat the request. */
  const routeSync = useRef({ route, resolveKbForRoute: kbMgmt.resolveKbForRoute, applyKbSelection: kbMgmt.applyKbSelection, navigateTo });
  useEffect(() => {
    routeSync.current = { route, resolveKbForRoute: kbMgmt.resolveKbForRoute, applyKbSelection: kbMgmt.applyKbSelection, navigateTo };
  });
  const currentKbId = currentKb?.id ?? null;
  useEffect(() => {
    if (!routeKbId || routeKbId === currentKbId) return;
    let cancelled = false;
    const sync = routeSync.current;
    void sync.resolveKbForRoute(routeKbId).then((kb) => {
      if (cancelled) return;
      if (!kb) {
        // Gone, hidden or malformed — already toasted. Replace, so back does
        // not return to the same dead URL.
        sync.navigateTo({ view: 'my-topics' }, { replace: true });
        return;
      }
      sync.applyKbSelection(kb);
      // The server's spelling of the id (e.g. an upper-case UUID typed into
      // the URL) — otherwise the two ids never agree and this runs forever.
      const r = sync.route;
      if (kb.id !== routeKbId && (r.view === 'kb' || r.view === 'global-kb-settings')) {
        sync.navigateTo({ view: r.view, kbId: kb.id }, { replace: true });
      }
    });
    return () => { cancelled = true; };
  }, [routeKbId, currentKbId]);

  /* URLs the signed-in user may not open land somewhere they may, by
   * replacing the URL: an unknown path, and the public-topic editor for anyone
   * outside the admin console's audience or for a topic that is not public.
   * The server refuses these anyway; this keeps the UI from rendering a page
   * whose every request fails. (The admin console itself is a dialog with its
   * own parameter, `?admin=`, guarded in AppUserMenu.) */
  const isSystemAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const redirect: Parameters<typeof navigateTo>[0] | null =
    view === 'not-found' ? { view: 'my-topics' }
    // A chat that is not the caller's, gone, a library chat, or whose lookup failed (already toasted).
    : view === 'chat' && (chatTopic.topic?.status === 'missing' || chatTopic.topic?.status === 'failed') ? { view: 'my-topics' }
    : view === 'global-kb-settings' && !isSystemAdmin ? { view: 'my-topics' }
    : view === 'global-kb-settings' && routeKb && !routeKb.isGlobal ? { view: 'kb', kbId: routeKb.id }
    : null;
  // A dead URL is replaced, so back does not return to it. That holds for a
  // chat lookup that merely FAILED (network, 5xx) too: pushed, back would land
  // on the link again, fail again and push again, and the user could not go
  // back past it while the server is down.
  // Keyed on the serialised target so the effect fires once per target, not
  // per render; the target itself is read from a ref, typed.
  const redirectRef = useRef(redirect);
  useEffect(() => { redirectRef.current = redirect; });
  const redirectKey = redirect ? JSON.stringify(redirect) : null;
  useEffect(() => {
    const target = redirectRef.current;
    if (redirectKey && target) navigateTo(target, { replace: true });
  }, [redirectKey, navigateTo]);

  // The chat on screen and the chat in the URL (/c/<id>, or /kb/<id> for a new chat).
  useChatRoute({
    kbId: onWorkspace && routeKb ? routeKb.id : null,
    routeChatId,
    routeChatEntry: chatTopic.topic?.status === 'found' ? chatTopic.topic.entry : null,
    rememberTopic: chatTopic.remember,
    activeChatId: chat.activeChatId,
    chats: chat.chats,
    sending: chat.loading,
    selectChat: chat.handleSelectChat,
    newChat: chat.handleNewChat,
    navigateTo,
  });

  // Redeem an invite link the user arrived with, now that they are signed in.
  useJoinRedeem({ openKbById: kbMgmt.handleOpenKbById });

  /* The header search's state (cards KI-787, KI-837). Held HERE rather than
     inside a provider component, exactly like `appNav` below:
     every top-level view is a separate `return` from this component, and the
     dropdown's „show all in Discover" row lands on „Entdecken" WITH the query
     and the caret — behaviour that must not depend on how React reconciles
     sibling branches. See `useKbSearchState`. */
  const kbSearch = useKbSearchState();

  /* Where a search hit takes you (card KI-837): the topic first, then the
     source or chat inside it — `useSearchNavigation` says why that order is
     the only one that works. Published through `appNav` below, because the
     field is chrome and the chrome takes no props from the page. */
  const searchNav = useSearchNavigation({
    openKbById: kbMgmt.handleOpenKbById,
    previewSource: webTools.handlePreviewSource,
    selectChat: chat.handleSelectChat,
  });

  // Lifecycle effects
  useKbLifecycle({
    token, currentKb,
    fetchKBs: kbMgmt.fetchKBs,
    fetchAvailableConfigs: kbSettings.fetchAvailableConfigs,
    fetchFiles: fileMgmt.fetchFiles,
    fetchChats: chat.fetchChats,
    fetchGeneratedContent: content.fetchGeneratedContent,
    fetchRssFeeds,
    fetchConfluenceSources: confluenceHook.fetchSources,
    fetchConfluenceConnectionInfo: confluenceHook.fetchConnectionInfo,
  });

  const { fetchGitRepoSources } = gitRepoHook;
  useEffect(() => {
    if (currentKb) {
      fetchGitRepoSources(currentKb.id);
    }
  }, [currentKb, fetchGitRepoSources]);

  // Refetch the overview whenever the user lands back on it. useKbLifecycle
  // fetches once per token, so anything that changed a KB's visibility
  // elsewhere in the session — publishing one from the admin UI is the case
  // this exists for — only reached the overview after a full page reload.
  const { fetchKBs } = kbMgmt;
  useEffect(() => {
    // Every view that renders `kbs`/`globalKbs`: a topic shared or published
    // while the user was elsewhere in the session would otherwise be missing
    // from the very view that exists to show it, until a full page reload.
    if (view === 'my-topics' || view === 'shared-topics' || view === 'discover') {
      void fetchKBs({ silent: true });
    }
  }, [view, fetchKBs]);

  // Cross-hook handlers. The setters are destructured into stable locals so
  // the useCallback dep arrays don't have to depend on the whole hook objects
  // (which are recreated each render and would defeat the memoization).
  const { setSelectedContent } = content;

  const handleSelectContent = useCallback((item: GeneratedContent) => {
    setSelectedContent(item);
  }, [setSelectedContent]);

  // Resolves true once the PATCH succeeded, false when it was declined or
  // failed (already toasted), so a caller can keep its drafts on screen.
  const handleUpdateKBSettings = async (data: Record<string, unknown>): Promise<boolean> => {
    if (!currentKb) return false;

    if (data.embeddingModel && data.embeddingModel !== currentKb.embeddingModel && currentKb.embeddingModel !== null) {
      if (!await showConfirm(t('embeddingModelChangeConfirm'))) {
        return false;
      }
    }

    try {
      await kbMgmt.saveKbSettings(currentKb.id, data);
      if (typeof data.isPro === 'boolean') kbSettings.setIsPro(data.isPro);
      return true;
    } catch (err: unknown) {
      console.error('Failed to update KB settings:', err);
      toast.error(t('settingsUpdateError'));
      return false;
    }
  };

  /* The app-level navigation jumps, published to whatever chrome renders the
   * sidebar. Defined HERE, above the early returns, rather than inside the
   * 'my-topics' branch where KI-770 put it: there are now FOUR views that
   * mount `AppChrome`, and a second inline copy of this object would be two
   * places for one set of destinations to go stale. `logout` is absent on
   * purpose — `AuthContext` already publishes it.
   *
   * A plain object, not `useMemo`: it was recreated on every render of the
   * home branch before too, so nothing about re-render behaviour changes, and
   * a memo here would have to sit above every early return for no gain. */
  const appNav: AppNavContextValue = {
    onViewMyTopics: goHome,
    onViewSharedTopics: () => navigateTo({ view: 'shared-topics' }),
    onViewDiscover: () => navigateTo({ view: 'discover' }),
    onViewProfile: () => openSettingsDialog('profile'),
    onEditGlobalKb: (kb) => kbMgmt.handleOpenGlobalKbSettings(kb.id),
    onViewLegal: (page) => navigateTo({ view: page }),
    onOpenTopic: searchNav.openTopic,
    onOpenSource: (source) => { void searchNav.openSource(source); },
    onOpenChat: (target) => { void searchNav.openChat(target); },
    // The topic first, then its settings: `?topic=` sits on the topic's URL,
    // and a navigation to another topic drops it (see useTopicSettings).
    onOpenTopicSettings: (kb, section) => {
      kbMgmt.handleSelectKB(kb);
      openTopicSettings(section);
    },
    onOpenRagSettings: openAdvancedSettings,
  };

  // Until the redirect effect has replaced the URL.
  if (redirect) return <LoadingFallback />;

  // Early returns for non-KB views
  if (view === 'global-kb-settings' && routeKb) {
    return (
      <Suspense fallback={<div className="loading-spinner"><Loader2 className="animate-spin" /></div>}>
        <GlobalKbSettings
          kb={routeKb}
          onBack={() => { kbMgmt.fetchKBs(); goHome(); }}
          onOpenKb={() => { kbMgmt.handleSelectKB(routeKb); }}
          onUpdate={(updated) => {
            setCurrentKb(updated);
            kbMgmt.setGlobalKbs(prev => prev.map(k => k.id === updated.id ? updated : k));
          }}
        />
      </Suspense>
    );
  }

  // Per-KB RAG settings / evals / workflow — the URL-less page above
  // (`advanced`). The operator tuning surface; every endpoint it calls is
  // kbAdvancedChain. Entry point: „RAG-Settings" in the row menu of the admin
  // console's KB-Übersicht (KBOverviewDashboard) — system admins, shared and
  // public topics. Its breadcrumb goes back to that list.
  if (advanced) {
    return (
      <div className="app-container" data-theme={resolvedTheme}>
        <div style={{ display: 'flex', flexDirection: 'column', height: viewportHeight('100dvh', '100vh'), width: '100%', overflow: 'auto' }}>
          <div className="flex flex-col gap-1" style={{ padding: '1rem 1.5rem 0' }}>
            <BreadcrumbBack
              trail={[t('adminSettings'), t('adminTabKbOverview')]}
              onClick={() => { kbMgmt.fetchKBs(); router.history.back(); }}
            />
            <h1 className="m-0 text-2xl font-semibold text-on-surface">{advanced.name}</h1>
          </div>
          <div style={{ padding: '1.25rem 1.5rem 2rem' }}>
            <Suspense fallback={<LoadingFallback />}>
              <KbSettingsPanel kbId={advanced.id} onCreateAgent={() => navigateTo({ view: 'agents' })} />
            </Suspense>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'terms' || view === 'privacy' || view === 'accessibility') {
    return <LegalPage page={view} onBack={goHome} siteConfigs={siteConfigs} />;
  }

  if (route.view === 'agents') {
    return (
      <div className="app-container" data-theme={resolvedTheme}>
        <div style={{ display: 'flex', height: viewportHeight('100dvh', '100vh'), width: '100%', overflow: 'auto' }}>
          <Suspense fallback={<LoadingFallback />}>
            <AgentsView
              onBack={goHome}
              tab={route.tab}
              // A tab is not a step of its own: back leaves the page.
              onTabChange={(tab) => navigateTo({ view: 'agents', tab }, { replace: true })}
              availableModels={[...new Set(kbSettings.availableConfigs.flatMap(c => c.chat_models))]}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  /* The overview pages and the topic workspace share ONE shell (`AppFrame`),
   * returned from this one place, so the sidebar stays mounted when the main
   * area changes. Everything below builds what goes into it. */
  const workspaceKb = onWorkspace ? routeKb : null;
  let workspace: WorkspaceFrame | null = null;
  if (workspaceKb) {
  const coreValue: KbCoreContextValue = {
      currentKb: workspaceKb,
      isPro: kbSettings.isPro,
      availableConfigs: kbSettings.availableConfigs,
      kbMgmt,
      onViewAgents: () => navigateTo({ view: 'agents' }),
      handleUpdateKBSettings,
    };

    const chatValue: KbChatContextValue = {
      chat,
      enhance: kbSettings.enhance,
      setEnhance: kbSettings.setEnhance,
      reasoningEnabled: kbSettings.reasoningEnabled,
      setReasoningEnabled: kbSettings.setReasoningEnabled,
      webSearchEnabled: kbSettings.webSearchEnabled,
      setWebSearchEnabled: kbSettings.setWebSearchEnabled,
      reasoningLevel: kbSettings.reasoningLevel,
      setReasoningLevel: kbSettings.setReasoningLevel,
      agentSelection: kbSettings.agentSelection,
      setAgentSelection: kbSettings.setAgentSelection,
    };

    const dataValue: KbDataContextValue = {
      fileMgmt,
      webTools,
      content,
      rssFeeds,
      rssLoading,
      fetchRssFeeds,
      addRssFeed,
      updateRssFeed,
      deleteRssFeeds,
      pollFeedNow,
      pollingFeedIds,
      confluenceSources: confluenceHook.confluenceSources,
      confluenceConnection: confluenceHook.confluenceConnection,
      confluenceLoading: confluenceHook.confluenceLoading,
      fetchConfluenceSources: confluenceHook.fetchSources,
      fetchConfluenceConnectionInfo: confluenceHook.fetchConnectionInfo,
      saveConfluenceConnection: confluenceHook.saveConnection,
      addConfluenceSource: confluenceHook.addSource,
      updateConfluenceSource: confluenceHook.updateSource,
      deleteConfluenceSources: confluenceHook.deleteSources,
      syncConfluenceNow: confluenceHook.syncNow,
      fetchConfluenceSpaces: confluenceHook.fetchSpaces,
      fetchConfluenceSpacePages: confluenceHook.fetchSpacePages,
      fetchConfluencePageChildren: confluenceHook.fetchPageChildren,
      fetchConfluenceAllSpacePages: confluenceHook.fetchAllSpacePages,
      gitRepoSources: gitRepoHook.gitRepoSources,
      gitRepoLoading: gitRepoHook.gitRepoLoading,
      fetchGitRepoSources: gitRepoHook.fetchGitRepoSources,
      addGitRepoSource: gitRepoHook.addGitRepoSource,
      updateGitRepoSource: gitRepoHook.updateGitRepoSource,
      deleteGitRepoSources: gitRepoHook.deleteGitRepoSources,
      syncGitRepoNow: gitRepoHook.syncGitRepoNow,
      handleSelectContent,
    };

    const layoutValue: KbLayoutContextValue = {
      sidebar,
      systemPromptOpen: topicSettings.open,
      setSystemPromptOpen: topicSettings.setOpen,
      systemPromptSection: topicSettings.section,
      setSystemPromptSection: topicSettings.setSection,
    };

    workspace = {
      core: coreValue, chat: chatValue, data: dataValue, layout: layoutValue,
      mobileTab: viewState.mobileTab,
      setMobileTab: viewState.setMobileTab,
      swipeHandlers: viewState.swipeHandlers,
    };
  }

  /* The sidebar's chat history: every topic's chats in one list, on every
   * view. A chat of the open topic is selected in place; any other is opened
   * by its URL, which brings its topic along (useChatRoute). */
  const { handleSelectChat, handleDeleteChats, handleRenameChat, handleNewChat } = chat;
  const subscribedIds = new Set(kbMgmt.globalKbs.map(kb => kb.id));
  const chatHistory: ChatHistoryHost = {
    activeChatId: workspace ? chat.activeChatId : null,
    openTopicId: workspace ? workspace.core.currentKb.id : null,
    sectionOf: (c) => topicSection({
      isPublic: c.kbVisibility === 'public',
      isOwner: c.kbRole === 'owner',
      isSubscribed: subscribedIds.has(c.kbId),
    }),
    openChat: (c) => {
      if (workspace && c.kbId === workspace.core.currentKb.id) {
        // The chat already on screen is not loaded again: that would replace
        // the local state of a running answer.
        if (c.id !== chat.activeChatId) void handleSelectChat(c);
        return;
      }
      navigateTo({ view: 'chat', chatId: c.id });
    },
    deleteChats: handleDeleteChats,
    renameChat: handleRenameChat,
    newChat: workspace ? handleNewChat : null,
    newTopic: () => { void kbMgmt.handleCreateKB(); },
    generating: workspace ? content.generating : false,
    generatingMessage: workspace ? content.podcastProgress?.message : undefined,
  };

  let active: AppChromeView | null = null;
  let main: ReactNode;
  if (view === 'discover') {
    active = 'discover';
    main = (
      <DiscoverView
        onSubscriptionChange={() => { kbMgmt.fetchKBs(); }}
        onOpenKbById={kbMgmt.handleOpenKbById}
      />
    );
  } else if (view === 'shared-topics') {
    active = 'shared-topics';
    main = (
      <SharedTopicsView
        kbs={kbMgmt.kbs}
        globalKbs={kbMgmt.globalKbs}
        loading={kbMgmt.kbsStatus === 'loading'}
        loadFailed={kbMgmt.kbsStatus === 'failed'}
        onRetryLoad={() => { void kbMgmt.fetchKBs(); }}
        onSelectKB={kbMgmt.handleSelectKB}
        onDeleteKB={kbMgmt.handleDeleteKB}
        removingKb={kbMgmt.removingKb}
        onRenameKB={kbMgmt.handleRenameKB}
        onToggleFavorite={kbMgmt.handleToggleFavorite}
      />
    );
  } else if (view === 'my-topics') {
    active = 'my-topics';
    main = (
      <MyTopicsView
        kbs={kbMgmt.kbs}
        loading={kbMgmt.kbsStatus === 'loading'}
        loadFailed={kbMgmt.kbsStatus === 'failed'}
        onRetryLoad={() => { void kbMgmt.fetchKBs(); }}
        onCreateKB={kbMgmt.handleCreateKB}
        onSelectKB={kbMgmt.handleSelectKB}
        onDeleteKB={kbMgmt.handleDeleteKB}
        removingKb={kbMgmt.removingKb}
        onRenameKB={kbMgmt.handleRenameKB}
        onToggleFavorite={kbMgmt.handleToggleFavorite}
      />
    );
  } else if (workspace) {
    main = <ChatView />;
  } else {
    // A topic URL whose topic is still loading: the spinner, in the main area.
    main = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%' }}>
        <Loader2 className="animate-spin" size={32} color="var(--accent-primary)" />
      </div>
    );
  }

  return (
    /* `AppFrame` reads both contexts on every view: `useAppNav` for its nav
       rows and user menu, `useKbSearch` for the search palette. */
    <AppNavProvider value={appNav}>
      <KbSearchProvider value={kbSearch}>
        {/* Every topic's chats, for the sidebar history; read again when the
            view or the open topic changes, and when the open topic's own list does. */}
        <ChatHistoryStore
          host={chatHistory}
          liveChats={chat.chats}
          currentKb={currentKb}
          refreshKey={`${view}:${currentKb?.id ?? ''}:${chat.chats.length}`}
        >
          <AppFrame active={active} workspace={workspace}>
            {main}
          </AppFrame>
        </ChatHistoryStore>
        {workspace && (
          <WorkspaceProviders value={workspace}>
            <KbWorkspaceModals />
          </WorkspaceProviders>
        )}
      </KbSearchProvider>
    </AppNavProvider>
  );
}
