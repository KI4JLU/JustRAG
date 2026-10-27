import { useCallback, useMemo } from 'react';
import { AppShellLayout, Button, Logo, type MobilePaneTab } from '@ki4jlu/design-system';
import { SourcesRail } from './sidebar/SourcesRail';
import { ArrowLeft, FolderOpen, History, MessageSquare, Settings } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useKbCore } from '../contexts/KbCoreContext';
import { useKbLayout } from '../contexts/KbLayoutContext';
import { SourcesPanel } from './sources/SourcesPanel';
import { HistoryPanel } from './history/HistoryPanel';
import { ChatView } from './ChatView';
import { type MobileTab } from './MobileTabBar';
import { deriveActiveMobileTab } from '../utils/activeMobileTab';
import { LEFT_SIDEBAR_BOUNDS, RIGHT_SIDEBAR_BOUNDS } from '../hooks/useSidebarResize';
import { canOpenKbTopicSettings } from '../utils/kbAccess';
import { AppUserMenu } from './AppUserMenu';
import { useKbSourceRights } from '../hooks/useKbSourceRights';
import { WorkspaceSearch } from './WorkspaceSearch';

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
  const { user } = useAuth();
  const { currentKb, setKbView, handleGoHome } = useKbCore();
  const { sidebar, systemPromptOpen, setSystemPromptOpen } = useKbLayout();

  // The system-prompt gear: owners and KB admins only (same predicate as the
  // editor it opens, in ChatView). Lives in the chrome bar, not the composer.
  const canEditSystemPrompt = !!currentKb && canOpenKbTopicSettings(currentKb, user?.role, user?.id);
  const headerActions = canEditSystemPrompt ? (
    <Button
      id="kb-header-system-prompt-toggle"
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setSystemPromptOpen(true)}
      title={t('kbSettingsTitle')}
      aria-label={t('kbSettingsTitle')}
      aria-pressed={systemPromptOpen || Boolean(currentKb.systemPrompt)}
    >
      <Settings size={20} aria-hidden="true" />
    </Button>
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

  /* Was vom `chat-header` übrig ist: der Zurück-Knopf. Der KB-Name steht
   * nicht mehr in der Leiste (Redesign, Entwickler 23.10.2026): er steht
   * bereits als Überschrift des leeren Chats, und Umbenennen bleibt über den
   * Stift auf der Karte der Übersicht.
   *
   * `handleGoHome` und nicht `handleViewHome`: Verlassen setzt kbView auf
   * 'chat' zurück (heute der einzige Wert; die Regel bleibt für die
   * spätere Tool-Anbindung).
   *
   * Kein Heading — die Leiste ist Chrome, die Überschrift der Seite gehört dem
   * Inhalt. */
  const pageLabel = (
    <span className="flex min-w-0 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleGoHome}
        title={t('backToOverview')}
        aria-label={t('backToOverview')}
        className="shrink-0"
      >
        <ArrowLeft size={20} aria-hidden="true" />
      </Button>
    </span>
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
          <Logo product="RAG" size="sm" />
        </Button>
      }
      nav={<HistoryPanel />}
      navLabel={t('history')}
      pageLabel={pageLabel}
      /* The topic-scoped search (cards KI-838, KI-844), in the shell's own
         centred `search` slot. Since design-system 0.44.1 that slot gives way
         first (28rem → 8rem, still exactly centred) while both side regions
         keep an 11rem floor, so the back button, the title and the gear keep
         their room — on 0.44.0 the same placement squeezed the title to 0px
         at 1280px with both columns open, which is why KI-838 had parked the
         field in `headerActions`. Not rendered below `lg`: phones have no
         search (out of scope). */
      search={<WorkspaceSearch />}
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
      collapseLabel={t('collapseHistorySidebar')}
      expandLabel={t('expandHistorySidebar')}
      /* The sources column only for a caller who may see the source list
         (capabilities.seeSources). Without it nothing in the column could be
         used — no list, and every other source right (add, download, manage)
         sits on top of seeSources — so there is no column, no rail, no
         toggle and no mobile tab rather than an empty one. */
      rightPanel={seeSources ? {
        content: <SourcesPanel />,
        // The column's title sits in its header row, beside the collapse
        // toggle — one row, not a second heading row above the list.
        header: (
          <h2 className="m-0 truncate text-[15px] font-medium text-on-surface">
            {addSources ? t('addSources') : t('sources')}
          </h2>
        ),
        // Collapsed: one icon per source with the hover preview, like the history rail.
        collapsedPreview: <SourcesRail />,
        label: t('sources'),
        isOpen: sidebar.isRightSidebarOpen,
        onOpenChange: sidebar.setIsRightSidebarOpen,
        // Beide Breiten kommen aus `useSidebarResize`, wo sie pro Gerät
        // gespeichert werden; die Grenzen sind die `aria-valuemin/max` der
        // Griffe. Ziehen und Tasten erledigt die Shell (`ResizeHandle`).
        width: sidebar.rightSidebarWidth,
        resize: {
          minWidth: RIGHT_SIDEBAR_BOUNDS.min,
          maxWidth: RIGHT_SIDEBAR_BOUNDS.max,
          onWidthChange: sidebar.setRightSidebarWidth,
          label: t('resizeRightSidebar'),
        },
        expandLabel: t('expandSourcesSidebar'),
        collapseLabel: t('collapseSourcesSidebar'),
      } : undefined}
      mobileTabs={mobileTabs}
      activeMobileTab={activeMobileTab}
      onMobileTabChange={handleMobileTabChange}
      mobileTabBarLabel={t('switchArea')}
    >
      <ChatView />
    </AppShellLayout>
  );
}
