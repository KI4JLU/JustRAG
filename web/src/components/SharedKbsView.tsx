import { useMemo } from 'react';
import {
  SectionedGridLayout,
  type SectionedGridSection,
  type SectionedGridSectionBody,
} from '@ki4jlu/design-system';
import { Users } from 'lucide-react';
import type { KnowledgeBase } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useSharingContext } from '../contexts/SharingContext';
import { useSectionOpen } from '../hooks/useSectionOpen';
import { splitKbsByOwnership } from '../utils/kbAccess';
import { AppChrome } from './AppChrome';
import { PrivateKbCard } from './KbCard';

/* ---------------------------------------------------------------------------
 * „Geteilte Knowledge Bases" — a top-level view (card KI-783).
 *
 * WHAT IT IS. The KBs somebody else shared with the signed-in user, on a page
 * of their own instead of behind a collapsed section on the overview. The
 * developer chose this over the cheaper alternative (have the sidebar row
 * expand and scroll the existing section) on 2026-09-15.
 *
 * WHAT IT IS NOT: a second renderer. Three things are reused rather than
 * copied, and that reuse is the whole point of the card:
 *   - the tile is `PrivateKbCard` from `KbCard.tsx`, the identical component
 *     the overview's „Mit mir geteilt" section mounts;
 *   - the arrangement is `SectionedGridLayout`, the identical content template;
 *   - the shell is `AppChrome`, the identical sidebar, user menu and members
 *     dialog.
 * Nothing about a KB card, a grid cell or the chrome is defined twice in this
 * repo. What this file adds is which rows to show and what to call the page.
 *
 * THERE IS NO ROUTER, AND THAT IS NOT A DEFECT HERE. `AuthenticatedApp` holds
 * a `ViewType` in `useState`; this view is one member of that union and one
 * render branch. The URL does not change and there is no history entry — the
 * existing architecture, unchanged by this card.
 *
 * NO REQUEST OF ITS OWN. `GET /api/kb` already returns `myRole` per row and is
 * already fetched by `useKnowledgeBases`; this view receives that same list and
 * filters it with `splitKbsByOwnership`, the predicate the overview uses. No
 * endpoint, no spec change, no migration.
 *
 * KNOWN WRINKLE, documented rather than silently shipped or silently fixed.
 * Three of the actions a card offers navigate AWAY through handlers this view
 * does not own, and all three land on the overview rather than back here:
 * `handleDeleteKB` calls `handleGoHome()` after a successful delete/leave/
 * unsubscribe (useKnowledgeBases.ts:166), and the `kb-settings` and
 * `global-kb-settings` branches' Back buttons call it too. The action itself
 * always succeeds — only the landing place is wrong. Fixing it properly means
 * remembering where the user came from, i.e. a return-view stack or a router,
 * and there is no router here by design; inventing one inside this card would
 * be exactly the kind of scope creep the card warns against.
 * // TODO: "back" from a KB removal or the settings panel lands on the
 * // overview, not on this view — behaviour not yet confirmed with the
 * // developer. Recorded on KI-783.
 *
 * TODO: the single-section shape is not yet confirmed with the developer. The
 * page is one `SectionedGridLayout` section, so it is a page with exactly one
 * collapsible header — mildly odd to look at, and chosen because the template
 * owns four things this file would otherwise hand-write: the `region` landmark
 * the skip link targets, the single `<h1>`, the count badge, and the
 * empty-state line (which is the one that would have needed NEW CSS, and new
 * CSS is what the build's cascade guard exists to police). The alternative is
 * `DashboardLayout` + `Grid` + a hand-written empty state. Recorded on KI-783.
 * ------------------------------------------------------------------------- */

export interface SharedKbsViewProps {
  /**
   * `GET /api/kb` in full — the same array `HomeView` gets. The view does its
   * own owned/shared split so that the two views cannot be handed differently
   * filtered lists by mistake; filtering in the parent would put the predicate
   * back in two places, which is what `splitKbsByOwnership` exists to prevent.
   */
  kbs: KnowledgeBase[];
  onSelectKB: (kb: KnowledgeBase) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  removingKb: boolean;
  /** Opens KbSettingsPanel for a KB the caller administers. */
  onOpenKbSettings: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  /** Rename prompt; the card only offers it when `canRenameKb` allows. */
  onRenameKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
}

/**
 * The id of this page's content landmark — the skip link's target, and the
 * value `AppChrome` hangs the anchor on. Distinct from the overview's
 * `home-main-content`: the two views are never mounted at once, but an id
 * shared between pages is the kind of thing that only looks harmless.
 */
const CONTENT_ID = 'shared-kbs-main-content';

export function SharedKbsView({
  kbs, onSelectKB, onDeleteKB, removingKb, onOpenKbSettings, onRenameKB,
}: SharedKbsViewProps) {
  const { language, t } = useTheme();
  const { user } = useAuth();
  // `handleOpenShare` and its `e.stopPropagation()` — a shared KB whose
  // `myRole` is `admin` still offers the share button, so this view needs the
  // same handler the overview uses, from the same single `useSharing()` call.
  const sharing = useSharingContext();
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(language, { numeric: 'auto' }), [language]);

  const { sharedKbs } = useMemo(() => splitKbsByOwnership(kbs), [kbs]);

  // Persisted like every other section in the app, and open on first visit —
  // a user who navigated here asked for this list.
  const listOpen = useSectionOpen('sharedview', true);

  /* The template refuses to derive „empty" from `items` (its own doc block says
     so), so the branch is here — the same `list.length === 0 ? empty : grid`
     shape `HomeView` writes for each of its sections. */
  const body: SectionedGridSectionBody =
    sharedKbs.length === 0
      ? { emptyState: t('homeSharedWithMeEmpty') }
      : {
          items: sharedKbs.map(kb => (
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
              onOpenKbSettings={onOpenKbSettings}
              onRenameKB={onRenameKB}
              onDeleteKB={onDeleteKB}
            />
          )),
        };

  const sections: SectionedGridSection[] = [
    {
      id: 'sharedview',
      // The SECTION keeps the overview's wording („Mit mir geteilt"), while the
      // page title is the destination's name. Two different strings on purpose:
      // repeating the `<h1>` verbatim one level below it is the ambiguity the
      // `home` nav row was renamed to avoid (translations.ts:51).
      title: t('homeSharedWithMe'),
      count: sharedKbs.length,
      icon: <Users size={20} color="var(--text-secondary)" aria-hidden="true" />,
      isOpen: listOpen.isOpen,
      onOpenChange: listOpen.onOpenChange,
      ...body,
    },
  ];

  return (
    <AppChrome active="shared-kbs" contentId={CONTENT_ID} pageLabel={t('sharedKbs')}>
      <SectionedGridLayout
        id={CONTENT_ID}
        label={t('sharedKbs')}
        title={t('sharedKbs')}
        description={t('sharedKbsDescription')}
        sections={sections}
      />
    </AppChrome>
  );
}
