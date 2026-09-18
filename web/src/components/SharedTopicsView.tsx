import { useMemo } from 'react';
import type { KnowledgeBase } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useSharingContext } from '../contexts/SharingContext';
import { useAppNav } from '../contexts/AppNavContext';
import { splitKbsByOwnership } from '../utils/kbAccess';
import { AppChrome } from './AppChrome';
import { CreateCell, PrivateKbCard } from './KbCard';
import { TopicGridPage } from './TopicGridPage';
import { TopicFilterBar } from './TopicFilterBar';
import { useTopicFilters } from '../hooks/useTopicFilters';

/* ---------------------------------------------------------------------------
 * „Geteiltes Wissen" — the topics somebody else shared with you. One flat grid.
 *
 * WHAT IT IS NOW. Private topics this user holds a membership row on, and
 * nothing else. `splitKbsByOwnership` is the same predicate `MyTopicsView`
 * applies to the same list; only the other half is this page's.
 *
 * THE TWO SECTIONS ARE GONE (developer ruling, 18.09.2026), and with them the
 * global half they existed to separate. Global topics live in „Entdecken" now,
 * which already lists every one the caller may see — `GET /api/kb/catalog` has
 * no subscription filter, so a topic the user holds and one they have not
 * added yet are both there, told apart by the card's own star. Rendering them
 * here as well would have been a second list of the same rows.
 *
 * With one list left there is nothing to collapse past, so this page matches
 * `MyTopicsView`: `TopicGridPage`, no disclosure, no count badges. The
 * `sharedview` / `sharedview-global` `useSectionOpen` keys are unused as of
 * this change — see `useSectionOpen.ts`.
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
 * NO REQUEST OF ITS OWN. `GET /api/kb` is already fetched by
 * `useKnowledgeBases`; this view receives that list and filters it.
 *
 * KNOWN WRINKLE, inherited from KI-783 and still true. Three card actions
 * navigate away through handlers this view does not own and all three land on
 * „Mein Wissen" rather than back here: `handleDeleteKB` calls `handleGoHome()`
 * after a successful delete/leave/unsubscribe (useKnowledgeBases.ts:166), and
 * the `kb-settings` Back button calls it too. The action always succeeds — only
 * the landing place is wrong. Fixing it means remembering where the user came
 * from, i.e. a return-view stack or a router, and there is no router here.
 * // TODO: "back" from a removal or the settings panel lands on „Mein Wissen",
 * // not on this view — not yet confirmed with the developer. On KI-783.
 * ------------------------------------------------------------------------- */

/** Anchors the skip link; must match the `contentId` handed to `AppChrome`. */
const CONTENT_ID = 'shared-topics-content';

export interface SharedTopicsViewProps {
  /** `GET /api/kb` — split here; only the shared half is shown. */
  kbs: KnowledgeBase[];
  onSelectKB: (kb: KnowledgeBase) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  removingKb: boolean;
  onOpenKbSettings: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onRenameKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onToggleFavourite: (kb: KnowledgeBase, e: React.MouseEvent) => void;
}

export function SharedTopicsView({
  kbs,
  onSelectKB,
  onDeleteKB,
  removingKb,
  onOpenKbSettings,
  onRenameKB,
  onToggleFavourite,
}: SharedTopicsViewProps) {
  const { language, t } = useTheme();
  const { user } = useAuth();
  // A shared topic whose `myRole` is `admin` still offers the share button, so
  // this view needs the same handler, from the same single `useSharing()` call.
  const sharing = useSharingContext();
  // The same jump the „Entdecken" nav row uses — one destination, one handler.
  const { onViewDiscover } = useAppNav();
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(language, { numeric: 'auto' }), [language]);

  const { sharedKbs } = useMemo(() => splitKbsByOwnership(kbs), [kbs]);

  const filters = useTopicFilters();

  return (
    <AppChrome active="shared-topics" contentId={CONTENT_ID}>
      <TopicGridPage
        id={CONTENT_ID}
        title={t('sharedTopics')}
        description={t('sharedTopicsDescription')}
        createCell={
          <CreateCell
            onClick={onViewDiscover}
            label={t('addTopic')}
            text={t('addTopic')}
            compact={filters.viewMode === 'list'}
          />
        }
        filterBar={<TopicFilterBar filters={filters} label={t('filterTopics')} />}
        viewMode={filters.viewMode}
        items={filters.apply(sharedKbs).map(kb => (
          <PrivateKbCard
            key={kb.id}
            kb={kb}
            currentUserId={user?.id}
            systemRole={user?.role}
            removingKb={removingKb}
            rtf={rtf}
            t={t}
            onSelectKB={onSelectKB}
            onOpenShare={sharing.handleOpenShare}
            onToggleFavourite={onToggleFavourite}
            compact={filters.viewMode === 'list'}
            onOpenKbSettings={onOpenKbSettings}
            onRenameKB={onRenameKB}
            onDeleteKB={onDeleteKB}
          />
        ))}
      />
    </AppChrome>
  );
}
