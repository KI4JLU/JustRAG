import { lazy, Suspense, useMemo } from 'react';
import {
  SectionedGridLayout,
  type SectionedGridSection,
  type SectionedGridSectionBody,
} from '@ki4jlu/design-system';
import { BookOpen, Search, Star, Users } from 'lucide-react';
import type { KnowledgeBase, SafeAIConfig } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useSharingContext } from '../contexts/SharingContext';
import { useSectionOpen } from '../hooks/useSectionOpen';
import { splitKbsByOwnership } from '../utils/kbAccess';
import { AppChrome } from './AppChrome';
import { CreateCell, PrivateKbCard, PublicKbCard } from './KbCard';
import KbCatalogPanel from './KbCatalogPanel';
import './HomeView.css';

const SettingsModal = lazy(() => import('./SettingsModal').then(module => ({ default: module.SettingsModal })));

/**
 * What `HomeView` still takes as a prop, and why.
 *
 * KI-770 removed 20 of the original 38. The line it drew is not "fewer props"
 * but WHO OWNS THE CONCERN:
 *
 * - The KB lists and the actions on them ARE this page's subject matter. The
 *   overview exists to render `kbs`/`globalKbs` and to offer create / open /
 *   delete / rename / settings on them, so receiving them is its interface,
 *   not drilling. They also stay out of the shell KI-776 introduced, which
 *   never touches a KB row.
 * - The sharing concern (16 props) moved to `SharingContext`: every one of
 *   them came from a single `useSharing()` call in `AuthenticatedApp`, and the
 *   dialog they drive is self-contained.
 * - The three top-level navigation jumps moved to `AppNavContext`, and logout
 *   to `useAuth().logout`, because KI-776 relocated all four into the shell's
 *   sidebar — a destination this component's signature cannot reach.
 * - The `SettingsModal` group (`currentKb`, `availableConfigs`,
 *   `onUpdateKBSettings`, `showSettings`, `setShowSettings`) stayed, and that
 *   is a deliberate non-change: see the note above its `Suspense` boundary.
 *
 * KI-783 ADDED NOTHING HERE, and that is the point of the card. „Geteilte
 * Knowledge Bases" became a top-level view with a sidebar row of its own; the
 * row reaches it through `AppNavContext`, exactly as the other jumps do, so
 * this signature is byte-for-byte what KI-770 left it as. A prop here would
 * have re-created the drilling layer KI-770 exists to remove.
 */
export interface HomeViewProps {
  kbs: KnowledgeBase[];
  globalKbs: KnowledgeBase[];
  currentKb: KnowledgeBase | null;
  availableConfigs: SafeAIConfig[];
  onCreateKB: () => void;
  onSelectKB: (kb: KnowledgeBase) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  removingKb: boolean;
  onCreateGlobalKB: () => void;
  /** Refetches the KB lists after a subscribe/unsubscribe in the discovery panel. */
  onSubscriptionChange: () => void;
  /** Opens a KB the caller knows only by id — the discovery panel's rows carry nothing else. */
  onOpenKbById: (id: string) => void;
  onDeleteGlobalKB: (id: string, e: React.MouseEvent) => void;
  onOpenGlobalKbSettings: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  /** Opens KbSettingsPanel (RAG settings / evals / workflow) for a KB the caller administers. */
  onOpenKbSettings: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  /** Rename prompt; the card only offers it when canRenameKb allows. */
  onRenameKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onUpdateKBSettings: (data: Record<string, unknown>) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
}

/**
 * The KB overview.
 *
 * SHELL AND CONTENT ARE TWO TEMPLATES (card KI-776, stage 7b of KI-696).
 * `AppShellLayout` is the chrome — branded sidebar, nav, user menu, the
 * page-label bar and its `ThemeToggle`; `SectionedGridLayout` is the page
 * content, hung into the shell as `children`, exactly as the design system's
 * COMPONENT_GUIDELINES prescribe ("SectionedGridLayout … *is* an
 * `AppShellLayout` child"). Nothing here rebuilds a page skeleton, and there is
 * no hand-rolled accordion any more: the sections' open state is this
 * component's (`useSectionOpen`), the arranging is the template's.
 *
 * THE CHROME HALF IS NO LONGER WRITTEN HERE (card KI-783). `AppShellLayout`
 * and its logo / nav / user-menu slots moved to `AppChrome`, because a SECOND
 * top-level view („Geteilte Knowledge Bases") draws the same sidebar — and an
 * inline second copy of it would mean every future nav change has two targets.
 * What moved is a file boundary, not behaviour: the rows, the four menu items,
 * the four chrome labels, the skip link, the imprint footer and the members
 * dialog are the same nodes in the same order. The members dialog went with it
 * because a KB card's share button exists on both views.
 *
 * WHAT WAS DELETED RATHER THAN MOVED (KI-776):
 *  - the overview's own theme button — `AppShellLayout` renders a
 *    `ThemeToggle` unconditionally, and KI-779 wired that toggle to the app's
 *    real tri-state theme, so keeping this one would ship two controls for one
 *    setting;
 *  - the whole `home-view__actions` row — its six controls live in the
 *    sidebar's nav (`Meine Agenten`) and user menu (username copy, profile,
 *    language, logout) now;
 *  - the floating admin action — it became the Admin `NavItem`, which carries
 *    the same accessible name. Keeping both would have put two buttons called
 *    "Admin-Einstellungen" on one screen;
 *  - the page's own `<header>` (logo box, `<h1>`, subtitle) — the logo is the
 *    shell's `logo` slot, and the heading is `SectionedGridLayout`'s
 *    `PageHeader`, which is the page's only `<h1>`.
 *
 * WHAT THE SHELL DOES NOT COVER. `AppShellLayout` has no footer slot, so the
 * operator's imprint stays a sibling AFTER the shell rather than moving inside
 * `children`: inside, a `<footer>` would be a descendant of the shell's
 * `<main>` and HTML-AAM would map it to `generic`, i.e. the page would silently
 * lose its `contentinfo` landmark. (It is `AppChrome` that renders it now;
 * `AuthenticatedApp` renders its own `<Footer>` as a further sibling.)
 *
 * KNOWN GAP, deliberately not worked around here (design-system card
 * `nhyfbxcfggpr`): `AppShellLayout` forwards none of `ThemeToggle`'s four label
 * props, so that control's labels stay German in an English session; and
 * `SectionedGridLayout` has no width prop, so the page measure is `Container`'s
 * default `page` (1440px) rather than the 1000px this page used to have. A
 * `max-w-*` at the call site would be a guidelines violation, so neither is
 * patched locally.
 */
export function HomeView(props: HomeViewProps) {
  const { language, t } = useTheme();
  const { user } = useAuth();
  // The whole sharing concern, including the `handleOpenShare` whose
  // `e.stopPropagation()` is what keeps the share button from also opening the
  // KB card it sits in. See SharingContext's header.
  const sharing = useSharingContext();
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(language, { numeric: 'auto' }), [language]);

  const {
    kbs, globalKbs, currentKb, availableConfigs,
    onCreateKB, onSelectKB, onDeleteKB, removingKb, onCreateGlobalKB, onSubscriptionChange, onOpenKbById, onDeleteGlobalKB,
    onOpenGlobalKbSettings, onOpenKbSettings, onRenameKB, onUpdateKBSettings,
    showSettings, setShowSettings,
  } = props;

  const isSystemAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  // `kbs` is GET /api/kb — private KBs the caller holds any kb_members row
  // for. Splitting it client-side rather than server-side keeps it one request:
  // the rows already carry myRole, and every row in this list has one (the
  // query requires the membership). The predicate itself lives in
  // `utils/kbAccess.ts` since KI-783, because the „Geteilte Knowledge Bases"
  // view applies the same one and an inline second copy could be inverted in
  // only one of the two places.
  const { ownedKbs, sharedKbs } = useMemo(() => splitKbsByOwnership(kbs), [kbs]);

  // Controlled disclosure state, one per section, with the same localStorage
  // keys and the same first-visit defaults the deleted `KbAccordion` used.
  const favoritesOpen = useSectionOpen('favorites', true);
  const discoverOpen = useSectionOpen('discover', false);
  const sharedOpen = useSectionOpen('shared', false);
  const mineOpen = useSectionOpen('mine', true);

  /* The three body shapes are picked HERE, per section, because the template
     deliberately refuses to derive "empty" from `items` — its own doc block
     says so. These three ternaries are the same `list.length === 0 ? empty :
     grid` branches this file wrote inline before. */
  const favoritesBody: SectionedGridSectionBody =
    globalKbs.length === 0 && !isSystemAdmin
      ? { emptyState: t('homeFavoritesEmpty') }
      : {
          createCell: isSystemAdmin
            ? <CreateCell onClick={onCreateGlobalKB} label={t('createGlobalKB')} text={t('createGlobalKB')} />
            : undefined,
          items: globalKbs.map(kb => (
            <PublicKbCard
              key={kb.id}
              kb={kb}
              isSystemAdmin={isSystemAdmin}
              removingKb={removingKb}
              rtf={rtf}
              t={t}
              onSelectKB={onSelectKB}
              onOpenGlobalKbSettings={onOpenGlobalKbSettings}
              onDeleteGlobalKB={onDeleteGlobalKB}
              onDeleteKB={onDeleteKB}
            />
          )),
        };

  const sharedBody: SectionedGridSectionBody =
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
    // Favoriten — the public KBs this user keeps. Open by default: it is
    // the section most people came for.
    {
      id: 'favorites',
      title: t('homeFavorites'),
      count: globalKbs.length,
      icon: <Star size={20} color="var(--accent-primary)" aria-hidden="true" />,
      isOpen: favoritesOpen.isOpen,
      onOpenChange: favoritesOpen.onOpenChange,
      ...favoritesBody,
    },
    // Discovery. Closed by default, and its body unmounted while closed — that
    // is what makes expanding it re-read the catalog, so a KB published after
    // this page loaded needs no reload. The template keeps that property: the
    // panel element stays in the DOM (so `aria-controls` resolves) but its
    // CHILDREN are mounted only while open.
    {
      id: 'discover',
      title: t('discoverKbs'),
      icon: <Search size={20} color="var(--text-secondary)" aria-hidden="true" />,
      isOpen: discoverOpen.isOpen,
      onOpenChange: discoverOpen.onOpenChange,
      body: <KbCatalogPanel onSubscriptionChange={onSubscriptionChange} onOpenKb={onOpenKbById} />,
    },
    /* Private KBs somebody else shared with me.
     *
     * KEPT, although KI-783 gave the same list a view of its own. Deleting it
     * here would be a behaviour change this card was not asked to make: the
     * developer decides, and the recommendation (reduce the section to a
     * pointer into the new view rather than drop it, because the count badge
     * is the only discovery affordance shared KBs have on this page) is
     * written on KI-783 with its reasoning.
     * // TODO: duplicate of the „Geteilte Knowledge Bases" view — awaiting the
     * // developer's decision on KI-783; not yet confirmed. */
    {
      id: 'shared',
      title: t('homeSharedWithMe'),
      count: sharedKbs.length,
      icon: <Users size={20} color="var(--text-secondary)" aria-hidden="true" />,
      isOpen: sharedOpen.isOpen,
      onOpenChange: sharedOpen.onOpenChange,
      ...sharedBody,
    },
    // My own KBs, last and open by default.
    {
      id: 'mine',
      title: t('myKBs'),
      count: ownedKbs.length,
      icon: <BookOpen size={20} color="var(--text-secondary)" aria-hidden="true" />,
      isOpen: mineOpen.isOpen,
      onOpenChange: mineOpen.onOpenChange,
      createCell: <CreateCell onClick={onCreateKB} label={t('createNewKb')} text={t('newKB')} />,
      items: ownedKbs.map(kb => (
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
    },
  ];

  return (
    <AppChrome active="home" contentId="home-main-content" pageLabel={t('myKBs')}>
      <SectionedGridLayout
        id="home-main-content"
        label={t('myKBs')}
        title={t('myKBs')}
        description={t('kbDescription')}
        sections={sections}
      />

      {/* NOT moved to context, and not reachable from this screen either:
          nothing in the overview sets `showSettings`, so this boundary is
          dormant here and only `useKbLifecycle` ever closes it. Left exactly
          as it was — deleting it would be a behaviour change this card is not
          allowed to make. Recorded on card KI-770 for KI-696 to resolve.
          // TODO: unreachable from HomeView — confirm with the developer
          // before removing. */}
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
