import { lazy, Suspense, useMemo } from 'react';
import type { KnowledgeBase, SafeAIConfig } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../contexts/AppNavContext';
import { splitKbsByOwnership } from '../utils/kbAccess';
import { AppChrome } from './AppChrome';
import { KbListHeader, PrivateKbCard } from './KbCard';
import { Button } from '@ki4jlu/design-system';
import { Plus } from 'lucide-react';
import { TopicGridPage } from './TopicGridPage';
import { TopicFilterBar } from './TopicFilterBar';
import { favoritesFirst, useTopicFilters } from '../hooks/useTopicFilters';
import { useKbOrder } from '../hooks/useKbOrder';
import { useKbSortable } from '../hooks/useKbSortable';
import './HomeView.css';

const SettingsModal = lazy(() => import('./SettingsModal').then(module => ({ default: module.SettingsModal })));

/* ---------------------------------------------------------------------------
 * „Mein Wissen" — the topics you own. Renamed from `HomeView` (developer
 * ruling, 18.09.2026).
 *
 * WHY THE OLD NAME WAS WRONG, since the rename is the point of the card. „Home
 * view" named a SCREEN, but the screen is `AppChrome` — the shell with the nav
 * column, the chrome bar and the user menu, which every one of these views
 * mounts. What this file is is the CONTENT of that shell's main area, one of
 * four such contents. `MyTopicsView` says which content; `HomeView` said only
 * that it was the first one.
 *
 * WHAT IT SHOWS, AND WHAT IT DELIBERATELY NO LONGER SHOWS. One flat grid: the
 * create tile, then the topics this user owns. The four collapsible sections
 * are gone, and with them three lists that were never this page's subject:
 *   - „Favoriten" (global topics you subscribe to) and „KBs entdecken" (the
 *     catalog) — global topics are not yours, so they moved out entirely:
 *     the subscribed ones to `SharedTopicsView`, the catalog to `DiscoverView`;
 *   - „Mit mir geteilt" — a duplicate of `SharedTopicsView` since KI-783,
 *     carried here only because deleting it was not that card's call. It is
 *     this card's call, and the duplicate is gone.
 * The result is a page that answers exactly one question, which is the one its
 * nav row asks.
 *
 * NO DISCLOSURE STATE. `useSectionOpen('favorites'|'shared'|'mine')` is gone
 * with the sections; see `useSectionOpen.ts` for what happens to the values
 * those keys already hold in users' browsers.
 * ------------------------------------------------------------------------- */

export interface MyTopicsViewProps {
  /** `GET /api/kb` — every private topic the caller holds a membership row for. */
  kbs: KnowledgeBase[];
  currentKb: KnowledgeBase | null;
  availableConfigs: SafeAIConfig[];
  onCreateKB: () => void;
  onSelectKB: (kb: KnowledgeBase) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  removingKb: boolean;
  onRenameKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onToggleFavorite: (kb: KnowledgeBase, e?: React.MouseEvent) => void;
  onUpdateKBSettings: (data: Record<string, unknown>) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
}

export function MyTopicsView({
  kbs,
  currentKb,
  availableConfigs,
  onCreateKB,
  onSelectKB,
  onDeleteKB,
  removingKb,
  onRenameKB,
  onToggleFavorite,
  onUpdateKBSettings,
  showSettings,
  setShowSettings,
}: MyTopicsViewProps) {
  const { language, t } = useTheme();
  const { user } = useAuth();
  // „Teilen" opens the topic's Thema-Einstellungen on Mitglieder.
  // stopPropagation keeps the menu click from also opening the card itself.
  const { onOpenTopicSettings } = useAppNav();
  const handleShare = (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenTopicSettings(kb, 'members');
  };
  // „Einstellungen" opens it on Startseite.
  const handleSettings = (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenTopicSettings(kb, 'start');
  };

  /* `splitKbsByOwnership` is the same predicate `SharedTopicsView` applies to
     the same list — one request, split client-side on the `myRole` each row
     already carries. Only the owned half is this page's. */
  const { ownedKbs } = useMemo(() => splitKbsByOwnership(kbs), [kbs]);

  const filters = useTopicFilters();
  // The user's own order (dragged in card or list view), then the chip filter.
  const order = useKbOrder('my');
  const ordered = useMemo(() => order.apply(ownedKbs), [order, ownedKbs]);
  const displayed = useMemo(() => filters.apply(ordered), [filters, ordered]);
  // Favorites on lines of their own above the rest.
  const all = useMemo(() => favoritesFirst(ordered), [ordered]);
  const favorites = useMemo(() => displayed.filter(kb => kb.isFavorite === true), [displayed]);
  const rest = useMemo(() => displayed.filter(kb => kb.isFavorite !== true), [displayed]);
  // Dragged into the other group, a topic is (un)favorited.
  const sortable = useKbSortable({ order, favorites, rest, all, onToggleFavorite });

  const renderCard = (kb: KnowledgeBase) => (
    <PrivateKbCard
      key={kb.id}
      kb={kb}
      currentUserId={user?.id}
      systemRole={user?.role}
      removingKb={removingKb}
      t={t}
      language={language}
      onSelectKB={onSelectKB}
      onOpenShare={handleShare}
      onToggleFavorite={onToggleFavorite}
      compact={filters.viewMode === 'list'}
      onOpenSettings={handleSettings}
      onRenameKB={onRenameKB}
      onDeleteKB={onDeleteKB}
    />
  );

  return (
    <AppChrome active="my-topics" contentId="my-topics-content">
      <TopicGridPage
        id="my-topics-content"
        title={t('myTopics')}
        description={t('myTopicsDescription')}
        filterBar={(
          <TopicFilterBar
            filters={filters}
            label={t('filterTopics')}
            showOwnership
            action={(
              <Button className="shrink-0" onClick={onCreateKB}>
                <Plus className="size-4" aria-hidden="true" /> {t('newTopic')}
              </Button>
            )}
          />
        )}
        listHeader={<KbListHeader t={t} />}
        viewMode={filters.viewMode}
        // One height for every card, across rows (KI-843).
        uniformRows
        sortable={sortable}
        pinned={{
          label: t('kbGroupFavorites'),
          restLabel: t('kbGroupOthers'),
          items: favorites.map(renderCard),
        }}
        items={rest.map(renderCard)}
      />

      {/* Dormant here, exactly as it was on `HomeView`: nothing on this page
          sets `showSettings`, and only `useKbLifecycle` ever clears it. Carried
          over rather than dropped, because removing it is a behaviour change
          and not a rename.
          // TODO: unreachable from this view — confirm with the developer
          // before removing. Recorded on KI-770. */}
      <Suspense fallback={null}>
        {showSettings && <SettingsModal
          show={showSettings}
          onClose={() => setShowSettings(false)}
          currentKb={currentKb}
          availableConfigs={availableConfigs}
          onUpdateSettings={onUpdateKBSettings}
        />}
      </Suspense>
    </AppChrome>
  );
}
