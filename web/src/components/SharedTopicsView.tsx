import { useMemo } from 'react';
import type { KnowledgeBase } from '../types';
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

/* ---------------------------------------------------------------------------
 * „Geteiltes Wissen" — the topics you hold but do not own. One flat grid.
 *
 * WHAT IT IS NOW. Two kinds of topic, one grid:
 *   - private topics somebody shared with you (`splitKbsByOwnership`, the
 *     same predicate `MyTopicsView` applies to the same list — the other half);
 *   - global topics you SUBSCRIBED to in „Entdecken" (developer ruling,
 *     03.11.2026). A global topic is an open group: subscribing is joining,
 *     and the joined topic belongs here, beside the other topics you use but
 *     did not make. Here — not in the catalog — it can be starred, so it pins
 *     to the top like any other favorite.
 * The catalog keeps listing subscribed topics, marked „Abonniert"; it is the
 * directory, this page is what you hold.
 *
 * With one list there is nothing to collapse past, so this page matches
 * `MyTopicsView`: `TopicGridPage`, no disclosure, no count badges. The
 * `sharedview` / `sharedview-global` `useSectionOpen` keys stay unused — see
 * `useSectionOpen.ts`.
 *
 * THE TILE NAVIGATES, IT DOES NOT CREATE. „Thema hinzufügen" goes to
 * „Entdecken". That is deliberate and it is the second tile tried in this slot:
 * the first was „Wissen teilen", which opened a picker and shared one of your
 * own topics — and was removed the same day, because sharing grants somebody
 * ELSE a membership row, so the topic lands in THEIR „Geteiltes Wissen" and
 * stays in YOUR „Mein Wissen". Nothing you could do from that tile ever changed
 * this page, which made it an action with an invisible result.
 *
 * A jump to the catalog has no such problem: it makes no claim about this
 * page's own list, it just answers „where do I get more?" — and the catalog is
 * the one place a user can end up with a topic they did not have. Sharing stays
 * on the card in „Mein Wissen", where the topic is.
 *
 * AND THE TILE IS THE EMPTY STATE (developer ruling, 18.09.2026). A placeholder
 * („Wissen gemeinsam nutzen" plus a line) sat above it for one round and was
 * dropped: on a page whose only control is one tile, a sentence beside it
 * describes what the tile already offers. An empty page is the heading, the
 * subtitle and the tile.
 *
 * Neither tile ever created a global topic. A topic is not created global
 * (developer ruling): it is created private and PROMOTED, by a system admin,
 * through the admin KB overview's publish action (`KBOverviewDashboard`, gated
 * on `role === admin | superadmin`, `POST /api/admin/kb/{id}/publish`).
 *
 * NO REQUEST OF ITS OWN. `GET /api/kb` and `GET /api/kb/global` are already
 * fetched by `useKnowledgeBases`; this view receives both lists and filters them.
 *
 * KNOWN WRINKLE, inherited from KI-783 and still true. Three card actions
 * navigate away through handlers this view does not own and all three land on
 * „Mein Wissen" rather than back here: `handleDeleteKB` calls `handleGoHome()`
 * after a successful delete/leave/unsubscribe (useKnowledgeBases.ts:166), and
 * the `kb-settings` Back button calls it too. The action always succeeds — only
 * the landing place is wrong. The router keeps where the user came from (the
 * browser's Back returns here), but these handlers still navigate to „Mein
 * Wissen" explicitly rather than back.
 * // TODO: "back" from a removal or the settings panel lands on „Mein Wissen",
 * // not on this view — not yet confirmed with the developer. On KI-783.
 * ------------------------------------------------------------------------- */

/** Anchors the skip link; must match the `contentId` handed to `AppChrome`. */
const CONTENT_ID = 'shared-topics-content';

export interface SharedTopicsViewProps {
  /** `GET /api/kb` — split here; only the shared half is shown. */
  kbs: KnowledgeBase[];
  /** `GET /api/kb/global` — the global topics the user subscribed to. */
  globalKbs: KnowledgeBase[];
  onSelectKB: (kb: KnowledgeBase) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  removingKb: boolean;
  onRenameKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onToggleFavorite: (kb: KnowledgeBase, e?: React.MouseEvent) => void;
}

export function SharedTopicsView({
  kbs,
  globalKbs,
  onSelectKB,
  onDeleteKB,
  removingKb,
  onRenameKB,
  onToggleFavorite,
}: SharedTopicsViewProps) {
  const { language, t } = useTheme();
  const { user } = useAuth();
  // The same jump the „Entdecken" nav row uses — one destination, one handler.
  // „Teilen" (a shared topic the caller administers) opens its
  // Thema-Einstellungen on Mitglieder, as on „Mein Wissen".
  const { onViewDiscover, onOpenTopicSettings } = useAppNav();
  const handleShare = (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenTopicSettings(kb, 'members');
  };
  // „Einstellungen" opens it on Startseite.
  const handleSettings = (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenTopicSettings(kb, 'start');
  };

  // Shared with the user, plus the global topics they subscribed to. The two
  // requests are disjoint (GET /api/kb returns private topics only); the id
  // check is a guard, not a known case.
  const sharedKbs = useMemo(() => {
    const shared = splitKbsByOwnership(kbs).sharedKbs;
    const ids = new Set(shared.map(kb => kb.id));
    return [...shared, ...globalKbs.filter(kb => !ids.has(kb.id))];
  }, [kbs, globalKbs]);

  const filters = useTopicFilters();
  // The user's own order (dragged in card view), then the chip filter.
  const order = useKbOrder('shared');
  const ordered = useMemo(() => order.apply(sharedKbs), [order, sharedKbs]);
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
    <AppChrome active="shared-topics" contentId={CONTENT_ID}>
      <TopicGridPage
        id={CONTENT_ID}
        title={t('sharedTopics')}
        description={t('sharedTopicsDescription')}
        filterBar={(
          <TopicFilterBar
            filters={filters}
            label={t('filterTopics')}
            action={(
              <Button className="shrink-0" onClick={onViewDiscover}>
                <Plus className="size-4" aria-hidden="true" /> {t('addTopic')}
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
    </AppChrome>
  );
}
