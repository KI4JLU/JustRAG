import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  AppShellLayout,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  NavItem,
  usePersistedWidth,
  useWindowFileDrag,
  type MobilePaneTab,
} from '@ki4jlu/design-system';
import { HistoryControls } from './HistoryControls';
import {
  Home, Users,
  LayoutGrid, Menu, Compass, FolderOpen, History, Lock, MessageSquare,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../contexts/AppNavContext';
import { KbCoreProvider, type KbCoreContextValue } from '../contexts/KbCoreContext';
import { KbChatProvider, type KbChatContextValue } from '../contexts/KbChatContext';
import { KbDataProvider, type KbDataContextValue } from '../contexts/KbDataContext';
import { KbLayoutProvider, type KbLayoutContextValue } from '../contexts/KbLayoutContext';
import { useAccountSearchGroup } from '../hooks/useAccountSearchGroup';
import { AppUserMenu } from './AppUserMenu';
import { AppLogo } from './AppLogo';
import { SearchNavRow, SearchPalette } from './SearchPalette';
import { setSearchPaletteOpen } from '../hooks/useSearchPalette';
import { useKbSearch } from '../contexts/KbSearchContext';
import { useSidebarCollapse } from '../hooks/useSidebarCollapse';
import {
  DEFAULT_LEFT_SIDEBAR_WIDTH, LEFT_SIDEBAR_BOUNDS, LEFT_SIDEBAR_WIDTH_KEY,
} from '../hooks/useSidebarResize';
import { GlobalSearch, type SearchDefaultGroup } from './GlobalSearch';
import { TopicSearch } from './TopicSearch';
import { DesktopMenuCommands } from './DesktopMenuCommands';
import { useSystemNoticeBanner } from '../hooks/useSystemNoticeBanner';
import { useTopicSettingsDiff } from '../hooks/useTopicSettingsDiff';
import { TopicSettingsButton } from './TopicSettingsButton';
import { SourcesPanel } from './sources/SourcesPanel';
import { HistoryPanel, NewChatButton } from './history/HistoryPanel';
import type { MobileTab } from '../utils/activeMobileTab';
import { canOpenKbTopicSettings, kbSourceRights } from '../utils/kbAccess';
import { topicSection } from '../utils/topicSection';
// `home-view__imprint` and `home-view__grid` below. The stylesheet is shared
// with `KbCard.tsx`, `MyTopicsView.tsx` and `LegalPage.tsx` rather than split —
// see KbCard.tsx's header for why the `home-view__` block name outlived the
// component.
import './HomeView.css';


/* ---------------------------------------------------------------------------
 * The signed-in app shell: ONE `AppShellLayout` for the overview pages and
 * the topic view alike.
 *
 * `AuthenticatedApp` mounts `AppFrame` once, at one position in the tree, and
 * swaps what is in its slots. The sidebar (logo, primary navigation, user
 * menu, its width and its collapsed state) therefore stays mounted across
 * every navigation between these views; only the main area changes. Below the
 * primary navigation the sidebar lists the user's chats across all topics
 * (`HistoryPanel`, `ChatHistoryContext`). Inside a topic the shell gains its
 * bar (breadcrumb, topic settings) and the sources card.
 *
 * It must stay at that one position: the same component under a different
 * parent is a different instance to React and remounts.
 *
 * `AppChrome` is what a page wraps its content in. Under `AppFrame` it adds
 * nothing (the frame is already there); rendered on its own — a test, a story
 * — it brings the frame along.
 *
 * `active` names the current overview page; the matching nav row gets
 * `aria-current="page"`. Inside a topic no row is current.
 * ------------------------------------------------------------------------- */

/** Which top-level view is currently on screen. One row, one `aria-current`. */
export type AppChromeView = 'my-topics' | 'shared-topics' | 'discover';

/** The skip link's target per overview page; each page puts the id on its content landmark. */
const CONTENT_IDS: Record<AppChromeView, string> = {
  'my-topics': 'my-topics-content',
  'shared-topics': 'shared-topics-content',
  discover: 'discover-content',
};

/** What the frame needs to show a topic: the four topic contexts and the narrow-screen area. */
export interface TopicFrame {
  core: KbCoreContextValue;
  chat: KbChatContextValue;
  data: KbDataContextValue;
  layout: KbLayoutContextValue;
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  swipeHandlers: { onTouchStart: (e: React.TouchEvent) => void; onTouchEnd: (e: React.TouchEvent) => void };
}

/**
 * The topic view's contexts. The frame sits above them (it also serves
 * pages with no topic), so each slot it fills with topic content gets its
 * own set of providers over the same values.
 */
export function TopicProviders({ value, children }: { value: TopicFrame; children: ReactNode }) {
  return (
    <KbCoreProvider value={value.core}>
      <KbChatProvider value={value.chat}>
        <KbDataProvider value={value.data}>
          <KbLayoutProvider value={value.layout}>
            {children}
          </KbLayoutProvider>
        </KbDataProvider>
      </KbChatProvider>
    </KbCoreProvider>
  );
}

/** True below an `AppFrame`: a page's `AppChrome` then adds no second shell. */
const InsideFrameContext = createContext(false);

export interface AppChromeProps {
  /** The current page; the matching nav row gets `aria-current="page"`. */
  active: AppChromeView;
  /**
   * `id` of the content landmark the skip link jumps to. The page puts it on
   * its own `SectionedGridLayout`, because `AppShell` owns the `<main>` and
   * spreads consumer props onto its root div — so the id cannot live on the
   * landmark itself.
   */
  contentId: string;
  /** Page content — the content template, plus any page-owned modal. */
  children: ReactNode;
}

export function AppChrome({ active, contentId, children }: AppChromeProps) {
  const insideFrame = useContext(InsideFrameContext);
  if (insideFrame) return <>{children}</>;
  return <AppFrame active={active} contentId={contentId}>{children}</AppFrame>;
}

export interface AppFrameProps {
  /** The current overview page, or null inside a topic (and while one loads). */
  active: AppChromeView | null;
  /** The skip link's target on an overview page; defaults to the page's entry in `CONTENT_IDS`. */
  contentId?: string;
  /** The open topic. Null on the overview pages. */
  topic?: TopicFrame | null;
  children: ReactNode;
}

export function AppFrame({ active, contentId, topic = null, children }: AppFrameProps) {
  const { t } = useTheme();
  const { user, siteConfigs } = useAuth();
  const {
    onViewMyTopics, onViewSharedTopics, onViewDiscover,
    onOpenTopic, onOpenSource, onOpenChat,
  } = useAppNav();
  const accountSearchGroup = useAccountSearchGroup();
  const { query, setQuery, applyCatalogQuery, focusPendingFor, requestFocus, consumeFocus } = useKbSearch();
  const searchRef = useRef<HTMLInputElement>(null);

  const inTopic = (node: ReactNode) => (topic ? <TopicProviders value={topic}>{node}</TopicProviders> : node);
  const skipTarget = contentId ?? (active ? CONTENT_IDS[active] : undefined);

  /* The left column's state, one for every view: minimised or not (remembered,
     `useSidebarCollapse`) and its width (remembered per device). Both are read
     here, in the one component that mounts the shell, so the column does not
     change when the main area does. */
  const sidebar = useSidebarCollapse();
  const [leftWidth, setLeftWidth] = usePersistedWidth(LEFT_SIDEBAR_WIDTH_KEY, {
    defaultWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
    minWidth: LEFT_SIDEBAR_BOUNDS.min,
    maxWidth: LEFT_SIDEBAR_BOUNDS.max,
  });

  // The admin's system notice, under the bar on every view. After a dismiss,
  // focus goes to the chat composer in a topic, else to the start of the content.
  const systemNotice = useSystemNoticeBanner(() => (
    topic
      ? document.querySelector<HTMLElement>('main textarea')
      : skipTarget ? document.getElementById(skipTarget) : null
  ));

  /* ---- Overview pages: the narrow-screen area -----------------------------
   * Not persisted: which of two areas you last looked at on a phone is a
   * position in a session. Selecting a nav row switches back to the content,
   * because on a phone the nav column is a menu you leave once you have
   * chosen. */
  const [overviewTab, setOverviewTab] = useState('page');
  const showContent = () => setOverviewTab('page');
  const overviewTabs: MobilePaneTab[] = useMemo(() => [
    { id: 'nav', icon: <Menu aria-hidden="true" />, label: t('navigationTab'), pane: 'left' },
    { id: 'page', icon: <LayoutGrid aria-hidden="true" />, label: t('contentTab'), pane: 'main' },
  ], [t]);

  /* ---- Topic view --------------------------------------------------------- */
  const currentKb = topic?.core.currentKb ?? null;
  const setTopicTab = topic?.setMobileTab;
  const { seeSources, addSources } = kbSourceRights(currentKb, user?.role, user?.id);

  // The topic settings gear: owners and KB admins only (same predicate as the
  // editor it opens). Lives in the bar, not the composer.
  const canEditSystemPrompt = !!currentKb && canOpenKbTopicSettings(currentKb, user?.role, user?.id);
  // Re-read whenever the settings window opens or closes, so a save or a
  // reset there shows on the gear without a reload.
  const settingsDiff = useTopicSettingsDiff(
    canEditSystemPrompt ? currentKb?.id : undefined,
    topic?.layout.systemPromptOpen ?? false,
  );

  const handleTopicTabChange = useCallback((tab: string) => {
    setTopicTab?.(tab as MobileTab);
  }, [setTopicTab]);

  // The active area is derived, not a second state. Without seeSources there
  // is no sources column, so a swipe that lands on 'files' shows the chat.
  const mobileTab: MobileTab = topic?.mobileTab ?? 'chat';
  const topicTab: MobileTab = !seeSources && mobileTab === 'files' ? 'chat' : mobileTab;

  // Files dragged into the window bring the sources card up, so its dropzone
  // is there to drop on — also after the card closed by itself on a narrow
  // frame. In the narrow shell the card is the „files" area.
  const fileDragActive = useWindowFileDrag(topic !== null && addSources);
  const openSources = topic?.layout.sidebar.setIsRightSidebarOpen;
  useEffect(() => {
    if (!fileDragActive || !openSources) return;
    if (window.matchMedia('(min-width: 768px)').matches) openSources(true);
    else handleTopicTabChange('files');
  }, [fileDragActive, openSources, handleTopicTabChange]);

  // History is a drawer, sources a sheet from below; the order is the swipe's.
  const topicTabs: MobilePaneTab[] = useMemo(() => [
    { id: 'history', icon: <History aria-hidden="true" />, label: t('tabHistory'), pane: 'left' },
    { id: 'chat', icon: <MessageSquare aria-hidden="true" />, label: t('tabChat'), pane: 'main' },
    ...(seeSources ? [{ id: 'files', icon: <FolderOpen aria-hidden="true" />, label: t('tabFiles'), pane: 'right' as const }] : []),
  ], [t, seeSources]);

  /* Hand the caret back to the search field after a jump: the palette's „show
     all matching topics in Discover" row navigates to „Entdecken" with the
     query. `setSelectionRange` puts the caret after the typed text. */
  useEffect(() => {
    if (focusPendingFor !== active) return;
    const el = searchRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    consumeFocus();
  }, [focusPendingFor, active, consumeFocus]);

  /* The `logo` slot: the design system's wordmark, built from the configured
     app name. Real text on the brand tokens. Inside a topic it is a button to
     the overview. */
  const logo = topic ? (
    <Button
      type="button"
      variant="ghost"
      // No hover tint on the brand, only the pointer cursor.
      className="h-auto cursor-pointer p-0 hover:bg-transparent active:bg-transparent"
      onClick={onViewMyTopics}
      title={t('goToHome')}
      aria-label={t('goToHome')}
    >
      <AppLogo siteConfigs={siteConfigs} size="sm" />
    </Button>
  ) : <AppLogo siteConfigs={siteConfigs} size="sm" />;

  /* A nav row jumps and, on a phone, switches back to the content. */
  const go = (jump: () => void) => () => {
    jump();
    showContent();
  };

  /* The primary navigation, the same rows on every view.
   *
   * Every row carries `label` AND wraps its text in a `<span>`: `label` is
   * what permits `NavItem` to collapse at all (it keeps full width rather than
   * drop its accessible name), and the `<span>` is what the collapsed variant
   * hides — CSS has no selector for a bare text node. */
  const nav = (
    <>
      <SearchNavRow />
      <NavItem
        type="button"
        label={t('myTopics')}
        active={active === 'my-topics'}
        onClick={go(onViewMyTopics)}
      >
        <Home size={20} aria-hidden="true" />
        <span>{t('myTopics')}</span>
      </NavItem>
      <NavItem
        type="button"
        label={t('sharedTopics')}
        active={active === 'shared-topics'}
        onClick={go(onViewSharedTopics)}
      >
        <Users size={20} aria-hidden="true" />
        <span>{t('sharedTopics')}</span>
      </NavItem>
      <NavItem
        type="button"
        label={t('discoverTopics')}
        active={active === 'discover'}
        onClick={go(onViewDiscover)}
      >
        <Compass size={20} aria-hidden="true" />
        <span>{t('discoverTopics')}</span>
      </NavItem>
    </>
  );

  /* What the empty search field offers (the command-palette pattern): the
     sidebar's destinations and the user menu's entries, so ⌘K alone reaches
     every top-level place. The current view is left out. */
  const searchDefaults: SearchDefaultGroup[] = [
    {
      heading: t('searchDefaultsNavigation'),
      items: [
        { id: 'my-topics', label: t('myTopics'), icon: <Home aria-hidden="true" />, onSelect: onViewMyTopics },
        { id: 'shared-topics', label: t('sharedTopics'), icon: <Users aria-hidden="true" />, onSelect: onViewSharedTopics },
        { id: 'discover', label: t('discoverTopics'), icon: <Compass aria-hidden="true" />, onSelect: onViewDiscover },
      ].filter((item) => item.id !== active),
    },
    accountSearchGroup,
  ];

  /* The global search (topics, sources, chats, chat content), in the palette
     on the overview pages. Choosing a hit navigates through `AppNavContext`. */
  const globalSearch = (
    <div className="w-full" data-testid="app-chrome-search">
      <GlobalSearch
        ref={searchRef}
        defaultGroups={searchDefaults}
        query={query}
        onQueryChange={setQuery}
        onOpenTopic={(hit) => onOpenTopic(hit.id)}
        onOpenSource={(hit) => onOpenSource({ id: hit.id, name: hit.name, kbId: hit.kbId })}
        onOpenChat={(hit) => onOpenChat({
          chatId: hit.id, kbId: hit.kbId, title: hit.title, type: hit.type, timestamp: hit.updatedAt,
        })}
        onOpenMessage={(hit) => onOpenChat({
          chatId: hit.chatId, kbId: hit.kbId, title: hit.chatTitle, type: hit.chatType, timestamp: hit.createdAt,
        })}
        onClose={() => setSearchPaletteOpen(false)}
        onShowAllTopics={(q) => {
          applyCatalogQuery(q);
          if (active !== 'discover') {
            onViewDiscover();
            requestFocus('discover');
          }
        }}
      />
    </div>
  );

  /* The bar's page label inside a topic: a breadcrumb, „section / topic". The
   * section is the overview the topic is listed in — „Mein Wissen" for an
   * owned topic, „Entdecken" for a public one the user has not subscribed to,
   * „Geteiltes Wissen" otherwise — and leads back there. Not a heading: the
   * bar is chrome. */
  const isPublic = currentKb?.visibility === 'public' || currentKb?.isGlobal === true;
  const isSubscribed = isPublic && (topic?.core.kbMgmt.globalKbs.some(kb => kb.id === currentKb?.id) ?? false);
  const section = topicSection({ isPublic, isSubscribed, isOwner: currentKb?.myRole === 'owner' });
  const sectionLabel =
    section === 'discover' ? t('discoverTopics') : section === 'my-topics' ? t('myTopics') : t('sharedTopics');
  const sectionPath = section === 'discover' ? '/discover' : section === 'my-topics' ? '/' : '/shared';
  const leaveToSection = () => {
    if (section === 'my-topics') onViewMyTopics();
    else if (section === 'discover') onViewDiscover();
    else onViewSharedTopics();
  };
  const pageLabel = topic ? (
    <Breadcrumb aria-label={t('breadcrumbNav')} className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem className="shrink-0">
          {/* A real link to the overview's own URL, so it can be opened in a
              new tab; a plain click stays in the app. */}
          <BreadcrumbLink
            href={sectionPath}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              leaveToSection();
            }}
          >
            {sectionLabel}
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>/</BreadcrumbSeparator>
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="truncate">{currentKb?.name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ) : undefined;

  /* The sources card. A caller who may not see the source list keeps the
     toggle in its place, locked, with the reason in its tooltip — but gets no
     card and no mobile area: every other source right sits on top of
     seeSources, so nothing in the card could be used. */
  const rightPanel = !topic ? undefined : seeSources ? {
    content: inTopic(<SourcesPanel />),
    // The column's title sits in its header row, beside the collapse toggle.
    header: (
      <h2 className="m-0 truncate text-[15px] font-medium text-on-surface">
        {addSources ? t('addSources') : t('sources')}
      </h2>
    ),
    label: t('sources'),
    isOpen: topic.layout.sidebar.isRightSidebarOpen,
    onOpenChange: topic.layout.sidebar.setIsRightSidebarOpen,
    // The card's width, stored per device in `useSidebarResize`. The floating
    // card has no rail and no drag handle.
    width: topic.layout.sidebar.rightSidebarWidth,
    expandLabel: t('expandSourcesSidebar'),
    collapseLabel: t('collapseSourcesSidebar'),
    closeLabel: t('closeSourcesCard'),
    toggleTooltip: <span className="block font-semibold">{t('sources')}</span>,
  } : {
    content: null,
    label: t('sources'),
    isOpen: false,
    onOpenChange: () => {},
    expandLabel: `${t('sources')} – ${t('sourcesLocked')}`,
    collapseLabel: `${t('sources')} – ${t('sourcesLocked')}`,
    locked: { description: t('sourcesLockedReason') },
    toggleTooltip: (
      <>
        <span className="block font-semibold">{t('sources')}</span>
        <span className="mt-1 flex items-start gap-1.5 font-normal">
          <Lock size={14} aria-hidden="true" className="mt-[0.2em] shrink-0" />
          {t('sourcesLockedReason')}
        </span>
      </>
    ),
  };

  return (
    <InsideFrameContext.Provider value={true}>
      {/* Outside the shell so it stays the document's first focusable element;
          it is absolutely positioned until focused, so it occupies no space. */}
      {topic
        ? <a href="#chat-message-input" className="skip-link">{t('skipToChat')}</a>
        : skipTarget && <a href={`#${skipTarget}`} className="skip-link">{t('skipToContent')}</a>}

      <AppShellLayout
        {...(topic ? topic.swipeHandlers : {})}
        logo={logo}
        // The chat history sits below the primary navigation, in one column,
        // on every view.
        nav={<HistoryPanel nav={nav} />}
        // The same user menu on every view; it stays reachable in the
        // collapsed rail as the avatar.
        sidebarFooter={<AppUserMenu />}
        // Below lg: the drawer's bottom button (a new chat in a topic, else a
        // new topic); using it closes the drawer.
        sidebarNarrowAction={(
          <NewChatButton onStarted={topic ? () => handleTopicTabChange('chat') : showContent} />
        )}
        navLabel={t('mainNavigation')}
        // `useSidebarCollapse` stores „collapsed"; the shell wants „open". The
        // inversion stays here, so the stored value keeps its meaning.
        leftOpen={!sidebar.collapsed}
        onLeftOpenChange={(isOpen) => sidebar.onCollapsedChange(!isOpen)}
        leftWidth={leftWidth}
        leftResize={{
          minWidth: LEFT_SIDEBAR_BOUNDS.min,
          maxWidth: LEFT_SIDEBAR_BOUNDS.max,
          onWidthChange: setLeftWidth,
          label: t('resizeLeftSidebar'),
        }}
        titlebarControls={<HistoryControls />}
        // The overview pages have no bar: navigation and search are in the
        // sidebar, and the page brings its own heading. A topic has one, for
        // its breadcrumb and settings.
        bar={topic !== null}
        pageLabel={pageLabel}
        headerActions={topic && canEditSystemPrompt
          ? <TopicSettingsButton diff={settingsDiff} onClick={() => topic.layout.setSystemPromptOpen(true)} />
          : undefined}
        collapseLabel={t('collapseNavigation')}
        expandLabel={t('expandNavigation')}
        rightPanel={rightPanel}
        mobileTabs={topic ? topicTabs : overviewTabs}
        activeMobileTab={topic ? topicTab : overviewTab}
        onMobileTabChange={topic ? handleTopicTabChange : setOverviewTab}
        notice={systemNotice.notice}
        status={systemNotice.status}
        statusPosition={systemNotice.statusPosition}
        noticeLabel={t('systemNotice')}
      >
        {inTopic(children)}
        {/* The search is a palette, opened by „Suchen" in the nav or ⌘K: the
            topic's own search inside a topic, the global one elsewhere. */}
        <SearchPalette>{topic ? inTopic(<TopicSearch />) : globalSearch}</SearchPalette>
        {topic && inTopic(<DesktopMenuCommands />)}
      </AppShellLayout>
    </InsideFrameContext.Provider>
  );
}
