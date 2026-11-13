import { HistoryControls } from './HistoryControls';
import { useCallback, useMemo } from 'react';
import {
  AppShellLayout,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  type MobilePaneTab,
} from '@ki4jlu/design-system';
import { useAppNavigate } from '../routing/navigation';
import { FolderOpen, History, Lock, MessageSquare } from 'lucide-react';
import { TopicSettingsButton } from './TopicSettingsButton';
import { useTopicSettingsDiff } from '../hooks/useTopicSettingsDiff';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useKbCore } from '../contexts/KbCoreContext';
import { useKbLayout } from '../contexts/KbLayoutContext';
import { SourcesPanel } from './sources/SourcesPanel';
import { HistoryPanel } from './history/HistoryPanel';
import { ChatView } from './ChatView';
import { type MobileTab } from './MobileTabBar';
import { deriveActiveMobileTab } from '../utils/activeMobileTab';
import { LEFT_SIDEBAR_BOUNDS } from '../hooks/useSidebarResize';
import { canOpenKbTopicSettings } from '../utils/kbAccess';
import { AppUserMenu } from './AppUserMenu';
import { AppLogo } from './AppLogo';
import { useKbSourceRights } from '../hooks/useKbSourceRights';
import { WorkspaceSearch } from './WorkspaceSearch';
import { SearchPalette } from './SearchPalette';
import { DesktopMenuCommands } from './DesktopMenuCommands';
import { useSystemNoticeBanner } from '../hooks/useSystemNoticeBanner';

interface KbWorkspaceLayoutProps {
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  swipeHandlers: { onTouchStart: (e: React.TouchEvent) => void; onTouchEnd: (e: React.TouchEvent) => void };
}

/* ---------------------------------------------------------------------------
 * The KB screen, mounted on the design system's `AppShellLayout`.
 *
 * WHAT CHANGED. Until this card the screen was a hand-built three-column
 * `notebook-container`: two `SidebarShell`s (history left, sources right),
 * two hand-rolled resize handles, and a `MobileTabBar` rendered from a
 * separate mobile branch. `AppShellLayout` is that whole frame — left column,
 * chrome bar, `<main>`, right column, and the narrow-screen tab bar — so the
 * local copies are gone and this file only injects content and the controlled
 * state the shell reads.
 *
 * THE SHELL IS THE SOURCE OF TRUTH, which is why three things simply left:
 *  - The two `SidebarShell` wrappers inside `HistoryPanel` / `SourcesPanel`.
 *    The shell's own `SidePanel` is the frame now, and nesting a second
 *    collapsible frame inside it would mean two toggles and two widths for one
 *    column.
 *  - The two hand-rolled resize handles and the drag loop in
 *    `useSidebarResize`. Since design-system 0.36.0 `AppShell` renders its own
 *    `ResizeHandle` next to an expanded column when a `resize` contract is
 *    passed, and `AppShellLayout` forwards the left column's width
 *    (`leftWidth` / `leftResize`). The app keeps the two numbers — persisted
 *    per device in `useSidebarResize` — and the shell does the dragging.
 *  - The `chat-header` in `ChatView`. Its content is the chrome bar's, and the
 *    shell owns the chrome bar — see `pageLabel` below for what survived.
 *
 * WHAT IS DELIBERATELY UNFINISHED: button and icon placement in the chrome bar
 * is the next card's. The bar carries the back control and the KB name and
 * nothing else; the view switcher (Chat / Bericht / Mindmap / Workspace), the
 * language button, the sharing button and the KB-tuning button were removed
 * with the old header and have no replacement yet.
 * // TODO: those four controls are unreachable until the follow-up card places
 * // them. `kbView` still branches inside `ChatView`, so the views themselves
 * // are intact — only the route into them is gone.
 * ------------------------------------------------------------------------- */
export function KbWorkspaceLayout({ mobileTab, setMobileTab, swipeHandlers }: KbWorkspaceLayoutProps) {
  const { t } = useTheme();
  const { user, siteConfigs } = useAuth();
  const { currentKb, setKbView, handleGoHome } = useKbCore();
  const { sidebar, systemPromptOpen, setSystemPromptOpen } = useKbLayout();
  // The admin's system notice, the same one AppChrome shows. After a dismiss,
  // focus goes to the chat composer.
  const systemNotice = useSystemNoticeBanner(() => document.querySelector<HTMLElement>('main textarea'));

  // The system-prompt gear: owners and KB admins only (same predicate as the
  // editor it opens, in ChatView). Lives in the chrome bar, not the composer.
  const canEditSystemPrompt = !!currentKb && canOpenKbTopicSettings(currentKb, user?.role, user?.id);
  // Re-read whenever the settings window opens or closes, so a save or a
  // reset there shows on the gear without a reload.
  const settingsDiff = useTopicSettingsDiff(canEditSystemPrompt ? currentKb?.id : undefined, systemPromptOpen);
  const headerActions = canEditSystemPrompt ? (
    <TopicSettingsButton diff={settingsDiff} onClick={() => setSystemPromptOpen(true)} />
  ) : undefined;

  // Der Reiter „chat" setzt kbView explizit; andere kbView-Werte gibt es
  // seit dem 22.09.2026 nicht mehr (KbViewType = 'chat').
  const handleMobileTabChange = useCallback((tab: string) => {
    if (tab === 'chat') setKbView('chat');
    setMobileTab(tab as MobileTab);
  }, [setKbView, setMobileTab]);

  // Der aktive Reiter wird ABGELEITET, nicht als zweiter Zustand geführt.
  // 'history' und 'files' zeigen ein eigenes Panel, alles andere ist der
  // Chat — seit dem 22.09.2026 die einzige Ansicht des Hauptbereichs.
  // `useViewState` leitet für den Swipe-Start über denselben Helfer ab.
  //
  // Without seeSources there is no sources column (below), so a swipe that
  // lands on 'files' shows the chat.
  const { seeSources, addSources } = useKbSourceRights();
  const derivedMobileTab: MobileTab = deriveActiveMobileTab(mobileTab);
  const activeMobileTab: MobileTab = !seeSources && derivedMobileTab === 'files' ? 'chat' : derivedMobileTab;


  /* Welcher Reiter welchen Bereich zeigt, ist Daten — die Shell leitet nichts
   * ab. Reihenfolge und Symbole sind die der abgelösten `MobileTabBar`, damit
   * die Swipe-Richtung in `useViewState` weiter zur Anordnung passt. */
  const mobileTabs: MobilePaneTab[] = useMemo(() => [
    { id: 'history', icon: <History aria-hidden="true" />, label: t('tabHistory'), pane: 'left' },
    { id: 'chat', icon: <MessageSquare aria-hidden="true" />, label: t('tabChat'), pane: 'main' },
    ...(seeSources ? [{ id: 'files', icon: <FolderOpen aria-hidden="true" />, label: t('tabFiles'), pane: 'right' as const }] : []),
  ], [t, seeSources]);

  /* The bar's page label: a breadcrumb, „section / topic". The section is
   * the overview the topic is listed in — „Mein Wissen" for an owned topic,
   * „Entdecken" for a public one, „Geteiltes Wissen" otherwise — and leads
   * back there; the topic is the current page. It replaces the back arrow:
   * the trail says where „back" goes, and the desktop app has history
   * buttons in its title bar.
   *
   * Leaving resets kbView to 'chat' (`handleGoHome` does it for the first
   * section), so the topic opens in the chat next time.
   *
   * Not a heading — the bar is chrome, the page's heading belongs to the
   * content. */
  const navigateTo = useAppNavigate();
  const section: 'my-topics' | 'shared-topics' | 'discover' =
    currentKb?.visibility === 'public' || currentKb?.isGlobal
      ? 'discover'
      : currentKb?.myRole === 'owner' ? 'my-topics' : 'shared-topics';
  const sectionLabel =
    section === 'discover' ? t('discoverTopics') : section === 'my-topics' ? t('myTopics') : t('sharedTopics');
  const sectionPath = section === 'discover' ? '/discover' : section === 'my-topics' ? '/' : '/shared';
  const leaveToSection = () => {
    if (section === 'my-topics') {
      handleGoHome();
      return;
    }
    setKbView('chat');
    navigateTo({ view: section });
  };
  const pageLabel = (
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
  );

  return (
    <AppShellLayout
      {...swipeHandlers}
      logo={
        /* Ein echter Knopf um die Marke (Entwickler, 21.09.2026): ein Klick
           auf das Logo führt zur Übersicht. `handleGoHome`, nicht
           `handleViewHome` — dieselbe Wahl wie beim Zurück-Knopf, damit die
           KB beim nächsten Öffnen im Chat startet. `Logo` selbst ist ein
           <span>; ein `asChild` machte daraus einen klickbaren span ohne
           Knopf-Semantik, deshalb der `Button` außen herum, mit `p-0
           h-auto`, damit er nichts an der Marke verschiebt. */
        <Button
          type="button"
          variant="ghost"
          // No hover tint on the brand, only the pointer cursor.
          className="h-auto cursor-pointer p-0 hover:bg-transparent active:bg-transparent"
          onClick={handleGoHome}
          title={t('goToHome')}
          aria-label={t('goToHome')}
        >
          <AppLogo siteConfigs={siteConfigs} size="sm" />
        </Button>
      }
      nav={<HistoryPanel />}
      navLabel={t('history')}
      pageLabel={pageLabel}
      headerActions={headerActions}
      // The same user menu as every other sidebar (account, settings, help);
      // it stays reachable in the collapsed rail as the avatar.
      sidebarFooter={<AppUserMenu />}
      leftOpen={sidebar.isLeftSidebarOpen}
      onLeftOpenChange={sidebar.setIsLeftSidebarOpen}
      leftWidth={sidebar.leftSidebarWidth}
      leftResize={{
        minWidth: LEFT_SIDEBAR_BOUNDS.min,
        maxWidth: LEFT_SIDEBAR_BOUNDS.max,
        onWidthChange: sidebar.setLeftSidebarWidth,
        label: t('resizeLeftSidebar'),
      }}
      titlebarControls={<HistoryControls />}
      collapseLabel={t('collapseHistorySidebar')}
      expandLabel={t('expandHistorySidebar')}
      /* The sources card. A caller who may not see the source list
         (capabilities.seeSources) keeps the toggle in its place, locked, with
         the reason in its tooltip — but gets no card and no mobile tab: every
         other source right (add, download, manage) sits on top of seeSources,
         so nothing in the card could be used. */
      rightPanel={seeSources ? {
        content: <SourcesPanel />,
        // The column's title sits in its header row, beside the collapse
        // toggle — one row, not a second heading row above the list.
        header: (
          <h2 className="m-0 truncate text-[15px] font-medium text-on-surface">
            {addSources ? t('addSources') : t('sources')}
          </h2>
        ),
        label: t('sources'),
        isOpen: sidebar.isRightSidebarOpen,
        onOpenChange: sidebar.setIsRightSidebarOpen,
        // The card's width, stored per device in `useSidebarResize`. The
        // floating card has no rail and no drag handle.
        width: sidebar.rightSidebarWidth,
        expandLabel: t('expandSourcesSidebar'),
        collapseLabel: t('collapseSourcesSidebar'),
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
      }}
      mobileTabs={mobileTabs}
      activeMobileTab={activeMobileTab}
      onMobileTabChange={handleMobileTabChange}
      mobileTabBarLabel={t('switchArea')}
      notice={systemNotice.notice}
      status={systemNotice.status}
      statusPosition={systemNotice.statusPosition}
      noticeLabel={t('systemNotice')}
    >
      <ChatView />
      {/* The topic-scoped search (cards KI-838, KI-844) as a palette: opened
          by „Suchen" in the history column (HistoryPanel) or ⌘K. */}
      <SearchPalette><WorkspaceSearch /></SearchPalette>
      <DesktopMenuCommands />
    </AppShellLayout>
  );
}
