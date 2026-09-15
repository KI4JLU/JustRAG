import { lazy, Suspense, useMemo } from 'react';
import {
  AppShellLayout,
  DropdownMenuItem,
  Logo,
  NavItem,
  SectionedGridLayout,
  SidebarUserMenu,
  type SectionedGridSection,
  type SectionedGridSectionBody,
} from '@ki4jlu/design-system';
import {
  BookOpen, Settings, User, LogOut, Copy, Check, Plus,
  Trash2, UserPlus, Globe, Pencil, FileText, MessageSquare, Loader2, Bot, Search, Star, Users,
  SlidersHorizontal, Home, Languages
} from 'lucide-react';
import type { KnowledgeBase, SafeAIConfig } from '../types';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../contexts/AppNavContext';
import { useSharingContext } from '../contexts/SharingContext';
import { useSectionOpen } from '../hooks/useSectionOpen';
import { KBCardSkeleton } from './Skeleton';
import { canOpenKbAdvancedSettings, canRenameKb } from '../utils/kbAccess';
import KbCatalogPanel from './KbCatalogPanel';
import './HomeView.css';

const MembersModal = lazy(() => import('./MembersModal').then(module => ({ default: module.MembersModal })));
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

const LoadingFallback = () => (
  <ul className="home-view__grid" aria-busy="true" aria-label="Loading...">
    <KBCardSkeleton />
    <KBCardSkeleton />
    <KBCardSkeleton />
  </ul>
);

// lastActiveLabel renders the KB-card freshness line (improvement #6): the
// newest of lastActivityAt / createdAt as a locale-aware "Zuletzt aktiv vor …".
function lastActiveLabel(
  kb: KnowledgeBase,
  rtf: Intl.RelativeTimeFormat,
  t: (k: string) => string,
): string {
  const iso = kb.lastActivityAt || kb.createdAt;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = then - Date.now(); // negative => past
  const min = Math.round(diffMs / 60000);
  const hr = Math.round(diffMs / 3600000);
  const day = Math.round(diffMs / 86400000);
  let rel: string;
  if (Math.abs(min) < 60) rel = rtf.format(min, 'minute');
  else if (Math.abs(hr) < 24) rel = rtf.format(hr, 'hour');
  else rel = rtf.format(day, 'day');
  return `${t('kbLastActive')} ${rel}`;
}

// Drei angezeigte Zustaende aus zwei gespeicherten. memberCount enthaelt den
// Owner, deshalb <= 1 und nicht === 0. Single source of truth for the
// three-way branch — text, CSS class and icon all derive from this instead
// of each re-implementing their own kb.visibility === 'public' check.
type VisibilityState = 'public' | 'shared' | 'personal';

function visibilityState(kb: KnowledgeBase): VisibilityState {
  if (kb.visibility === 'public') return 'public';
  return (kb.memberCount ?? 1) > 1 ? 'shared' : 'personal';
}

// Der Zaehler steht ausserhalb der Uebersetzung, weil t() keine
// Interpolation kann.
function visibilityBadge(kb: KnowledgeBase, t: (k: string) => string): string {
  const state = visibilityState(kb);
  if (state === 'public') return t('visibilityPublic');
  if (state === 'shared') return `${t('visibilityShared')} (${kb.memberCount})`;
  return t('visibilityPersonal');
}

// VisibilityBadge renders the three-state badge on every KB card, personal and
// public alike. It has to be shared: GET /api/kb hard-filters
// `WHERE kb.visibility = 'private'`, so a public KB never reaches the personal
// grid — and while the public grid rendered its own static "Global" chip, the
// 'public' state of this badge was unreachable code and the spec's third state
// shipped to nobody. One component, one branch, three reachable states.
function VisibilityBadge({ kb, t }: { kb: KnowledgeBase; t: (k: string) => string }) {
  const state = visibilityState(kb);
  return (
    <div className={`home-view__badge home-view__badge--${state}`}>
      {state === 'public'
        ? <Globe size={10} aria-hidden="true" />
        : <User size={10} aria-hidden="true" />}
      {visibilityBadge(kb, t)}
    </div>
  );
}

// canManageMembers gates the members-dialog trigger: admins and owners
// manage membership, edit/view callers don't. Checking myRole (not the
// legacy kb.userId === user.id owner comparison) is what makes the admin
// tier reachable from the UI at all — an admin who isn't the owner used to
// have no way to open the dialog.
function canManageMembers(kb: KnowledgeBase): boolean {
  return kb.myRole === 'admin' || kb.myRole === 'owner';
}

// KbCardChips is the compact metadata slice on each Home KB card (improvement
// #6): up to two scent chips (files · messages) plus a single needs-attention
// chip (failed, else processing). Lucide icons (#2), status tokens (#1).
function KbCardChips({ kb, t }: { kb: KnowledgeBase; t: (k: string) => string }) {
  const processing = kb.processingFileCount ?? 0;
  const files = kb.fileCount ?? 0;
  const messages = kb.turnCount ?? 0;
  if (files === 0 && messages === 0 && processing === 0) return null;
  return (
    <div className="home-view__chip-row">
      {files > 0 && (
        <span className="home-view__chip">
          <FileText size={12} aria-hidden="true" />
          {t('kbFilesChip').replace('{n}', String(files))}
        </span>
      )}
      {messages > 0 && (
        <span className="home-view__chip">
          <MessageSquare size={12} aria-hidden="true" />
          {t('kbMessagesChip').replace('{n}', String(messages))}
        </span>
      )}
      {processing > 0 && (
        <span className="home-view__chip home-view__chip--processing">
          <Loader2 size={12} className="spin" aria-hidden="true" />
          {t('kbProcessingChip').replace('{n}', String(processing))}
        </span>
      )}
    </div>
  );
}

/**
 * The "create" tile, rendered as the FIRST cell of a section's grid.
 *
 * It used to be an `<li>` inside `HomeView`'s own `<ul className="home-view__
 * grid">`. `SectionedGridLayout` lays the cells out with the design system's
 * `Grid`, which is a `<div>` — an `<li>` in it would be a list item with no
 * list, so every cell in this file is a `<div>` now. The visual card chrome is
 * unchanged: it is still `.source-card` + `.home-view__create-card`.
 */
function CreateCell({ onClick, label, text }: { onClick: () => void; label: string; text: string }) {
  return (
    <div className="source-card home-view__create-card">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="home-view__create-button"
      >
        <Plus size={32} aria-hidden="true" />
        <span className="home-view__create-label">{text}</span>
      </button>
    </div>
  );
}

interface PublicKbCardProps {
  kb: KnowledgeBase;
  isSystemAdmin: boolean;
  removingKb: boolean;
  rtf: Intl.RelativeTimeFormat;
  t: (k: string) => string;
  onSelectKB: (kb: KnowledgeBase) => void;
  onOpenGlobalKbSettings: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onDeleteGlobalKB: (id: string, e: React.MouseEvent) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
}

// PublicKbCard is one tile in the Favoriten section. System admins get the
// settings/delete pair on top of the shared card chrome.
function PublicKbCard({
  kb, isSystemAdmin, removingKb, rtf, t,
  onSelectKB, onOpenGlobalKbSettings, onDeleteGlobalKB, onDeleteKB,
}: PublicKbCardProps) {
  return (
    <div
      className="source-card home-view__kb-card"
      role="button"
      tabIndex={0}
      aria-label={`${t('openKb')}: ${kb.name}`}
      onClick={() => onSelectKB(kb)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectKB(kb);
        }
      }}
    >
      <div className="home-view__card-top">
        <Globe size={20} color="var(--accent-primary)" aria-hidden="true" />
        <div className="home-view__badge-row">
          {isSystemAdmin && (
            <div className={`home-view__badge home-view__badge--publish ${kb.isPublished ? 'home-view__badge--published' : 'home-view__badge--unpublished'}`}>
              {kb.isPublished ? t('published') : t('unpublished')}
            </div>
          )}

          <VisibilityBadge kb={kb} t={t} />

          {isSystemAdmin && (
            <>
              <button
                onClick={(e) => onOpenGlobalKbSettings(kb, e)}
                className="home-view__mini-icon"
                title={t('editSettings')}
                aria-label={t('editSettings')}
              >
                <Pencil size={16} aria-hidden="true" />
              </button>
              <button
                onClick={(e) => onDeleteGlobalKB(kb.id, e)}
                className="home-view__mini-icon"
                title={t('delete')}
                aria-label={t('deleteGlobalKb')}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </>
          )}

          {/* A favorites toggle, and nothing more. It is offered to everyone,
              system admins included — their overview query is the same one
              everybody else gets (kb.Handler.ListGlobalKnowledgeBases passes
              isAdmin=false), so the action sticks. removeKb (useKbRemoval)
              routes every public KB through the unsubscribe branch regardless
              of myRole: no membership is dropped, no chats are deleted, and
              the KB stays listed under "KBs entdecken". Deleting the KB
              outright is the separate Trash2 above, gated on isSystemAdmin. */}
          <button
            onClick={(e) => onDeleteKB(kb, e)}
            className="home-view__mini-icon"
            disabled={removingKb}
            title={t('removeFromFavorites')}
            aria-label={t('removeFromFavorites')}
          >
            <Star size={16} aria-hidden="true" fill="currentColor" />
          </button>
        </div>
      </div>

      <div className="source-title home-view__kb-name">
        <button
          type="button"
          className="text-button home-view__kb-name-btn"
          onClick={(e) => {
            e.stopPropagation();
            onSelectKB(kb);
          }}
        >
          {kb.name}
        </button>
      </div>

      {kb.headerText && <div className="home-view__kb-header-text">{kb.headerText}</div>}
      <div className="source-meta home-view__kb-meta">{lastActiveLabel(kb, rtf, t)}</div>
      <KbCardChips kb={kb} t={t} />
    </div>
  );
}

interface PrivateKbCardProps {
  kb: KnowledgeBase;
  currentUserId?: string;
  /**
   * The caller's SYSTEM role. Needed here because the advanced-settings
   * trigger below requires one of {api-user, admin, superadmin} on top of the
   * KB role — the card cannot decide that from `kb` alone.
   */
  systemRole?: string;
  removingKb: boolean;
  rtf: Intl.RelativeTimeFormat;
  t: (k: string) => string;
  onSelectKB: (kb: KnowledgeBase) => void;
  onOpenShare: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onOpenKbSettings: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onRenameKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
}

// PrivateKbCard is one tile in "Meine KBs" and "Mit mir geteilt" — the same
// card in both, since the only difference between the sections is the
// caller's own role, which the card already reads off myRole.
function PrivateKbCard({
  kb, currentUserId, systemRole, removingKb, rtf, t, onSelectKB, onOpenShare, onOpenKbSettings, onRenameKB, onDeleteKB,
}: PrivateKbCardProps) {
  return (
    // Card-level click is a mouse convenience (role="presentation"); the
    // accessible control is the KB-name button below, which carries the
    // label and the keyboard path.
    <div
      className="source-card home-view__kb-card"
      role="presentation"
      onClick={() => onSelectKB(kb)}
    >
      <div className="home-view__card-top">
        <BookOpen size={20} color="var(--text-secondary)" aria-hidden="true" />
        <div className="home-view__badge-row">
          <VisibilityBadge kb={kb} t={t} />

          {canManageMembers(kb) && (
            <button
              onClick={(e) => onOpenShare(kb, e)}
              className="home-view__mini-icon"
              title={t('share')}
              aria-label={t('share')}
            >
              <UserPlus size={16} aria-hidden="true" />
            </button>
          )}

          {/* Rename: owner-only (superadmin resolves to owner). Stricter than
              the members/settings buttons beside it — a KB admin member edits
              everything about a KB except its name. canRenameKb is the
              shared predicate with ChatView's header trigger, mirroring
              kbaccess.CanRename on the server. */}
          {canRenameKb(kb, systemRole) && (
            <button
              onClick={(e) => { e.stopPropagation(); onRenameKB(kb, e); }}
              className="home-view__mini-icon"
              title={t('renameKb')}
              aria-label={t('renameKb')}
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          )}

          {/* RAG settings / evals / workflow (KbSettingsPanel). NOT the same
              gate as the members button beside it: every endpoint the panel
              calls is kbAdvancedChain, which requires a system role in
              {api-user, admin, superadmin} as well as the KB admin role.
              canOpenKbAdvancedSettings is the shared predicate — ChatView's
              trigger calls the same one, so the two entry points cannot drift
              apart again. */}
          {canOpenKbAdvancedSettings(kb, systemRole) && (
            <button
              onClick={(e) => onOpenKbSettings(kb, e)}
              className="home-view__mini-icon"
              title={t('kbAdvancedSettings')}
              aria-label={t('kbAdvancedSettings')}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
            </button>
          )}

          {/* Label + aria-label reflect the caller's own role: owners
              delete the KB outright, everyone else only leaves it
              (removeKb — useKbRemoval — decides which request that
              means; a missing myRole is treated as an implicit
              viewer, never as owner). Disabled while any removal is
              in flight (useKbRemoval.removing) so a double-click
              can't open a second confirmation or fire a second
              request — the hook also guards re-entry itself, this is
              just the UI-visible half of that guard. */}
          <button
            onClick={(e) => onDeleteKB(kb, e)}
            className="home-view__mini-icon"
            disabled={removingKb}
            title={kb.myRole === 'owner' ? t('deleteKb') : t('removeFromMyView')}
            aria-label={kb.myRole === 'owner' ? t('deleteKb') : t('removeFromMyView')}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="source-title home-view__kb-name">
        <button
          type="button"
          className="text-button home-view__kb-name-btn"
          aria-label={`${t('openKb')}: ${kb.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelectKB(kb);
          }}
        >
          {kb.name}
        </button>
      </div>

      <div className="home-view__meta-row">
        <div className="source-meta home-view__kb-meta">{lastActiveLabel(kb, rtf, t)}</div>
        {kb.userId !== currentUserId && (
          <div className="home-view__owner-meta">
            <User size={12} aria-hidden="true" />
            {(() => {
              const fullName = `${kb.ownerFirstName || ''} ${kb.ownerLastName || ''}`.trim();
              const displayName = fullName || kb.ownerUsername || t('unknownUser');
              return t('sharedBy').replace('{name}', displayName);
            })()}
          </div>
        )}
      </div>
      <KbCardChips kb={kb} t={t} />
    </div>
  );
}

/** The system role, as a label. Falls back to the raw value for an unknown role. */
function roleLabel(role: string | undefined, t: (k: string) => string): string {
  switch (role) {
    case 'user': return t('roleUser');
    case 'api-user': return t('roleApiUser');
    case 'admin': return t('roleAdmin');
    case 'superadmin': return t('roleSuperAdmin');
    default: return role ?? '';
  }
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
 * WHAT WAS DELETED RATHER THAN MOVED:
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
 * lose its `contentinfo` landmark. `AuthenticatedApp` already renders its own
 * `<Footer>` as a sibling in the same position.
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
  const { language, setLanguage, t } = useTheme();
  // `logout` is read here rather than taken as a prop: AuthContext already
  // publishes it, and AuthenticatedApp only renamed it on the way down.
  const { user, siteConfigs, logout: onLogout } = useAuth();
  const { onViewProfile, onViewAdmin, onViewAgents } = useAppNav();
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
  // for. Splitting it here rather than server-side keeps it one request: the
  // rows already carry myRole, and every row in this list has one (the query
  // requires the membership). A KB I own is mine; anything else reached me
  // because somebody shared it.
  const { ownedKbs, sharedKbs } = useMemo(() => {
    const owned: KnowledgeBase[] = [];
    const shared: KnowledgeBase[] = [];
    for (const kb of kbs) {
      (kb.myRole === 'owner' ? owned : shared).push(kb);
    }
    return { ownedKbs: owned, sharedKbs: shared };
  }, [kbs]);

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
    // Private KBs somebody else shared with me.
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

  /* The `logo` slot. An operator-uploaded logo still wins (card KI-719, the
     pattern Login established); the fallback is the design system's own
     wordmark rather than a lucide book icon, so it is readable text on the
     brand tokens. NOTE: `AppShell` renders this node TWICE — once in the
     sidebar header, once in the below-lg top bar — so the document holds two
     copies, only one of them visible per breakpoint. */
  const logo = siteConfigs.logo_path ? (
    <img
      src={`${API_BASE_URL}${siteConfigs.logo_path}`}
      alt={t('websiteLogo')}
      className="h-10 max-w-full object-contain"
    />
  ) : (
    <Logo product="RAG" />
  );

  const nav = (
    <>
      {/* This view IS the home route — `AuthenticatedApp` renders `HomeView`
          only for `view === 'home'` — so the row is unconditionally the
          current page. `active` is what puts `aria-current="page"` on it; it
          has no handler because there is nowhere to navigate to. */}
      <NavItem type="button" active>
        <Home size={20} aria-hidden="true" />
        {t('home')}
      </NavItem>
      <NavItem type="button" onClick={onViewAgents}>
        <Bot size={20} aria-hidden="true" />
        {t('myAgents')}
      </NavItem>
      {isSystemAdmin && (
        <NavItem type="button" onClick={onViewAdmin}>
          <Settings size={20} aria-hidden="true" />
          {t('adminSettings')}
        </NavItem>
      )}
    </>
  );

  const userMenu = (
    <SidebarUserMenu
      initials={(user?.username ?? '').slice(0, 2).toUpperCase()}
      name={`@${user?.username}`}
      role={roleLabel(user?.role, t)}
    >
      {/* `preventDefault` keeps the menu open: `copySuccess` is a 2s flag and
          the confirmed icon would otherwise be behind a menu that Radix has
          already closed. */}
      <DropdownMenuItem
        onSelect={(e) => { e.preventDefault(); sharing.copyUserId(); }}
      >
        <span className="icon-swap" key={sharing.copySuccess ? 'check' : 'copy'}>
          {sharing.copySuccess
            ? <Check size={16} className="text-success" aria-hidden="true" />
            : <Copy size={16} aria-hidden="true" />}
        </span>
        {t('copyUsername')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onViewProfile}>
        <User size={16} aria-hidden="true" />
        {t('profile')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setLanguage(language === 'de' ? 'en' : 'de')}>
        <Languages size={16} aria-hidden="true" />
        {t('switchLanguage')}
        {/* The current code, kept as the visible affordance the old DE/EN
            button was. `aria-hidden` because the label already names the
            action, and a trailing "DE" in the accessible name would say
            nothing a screen-reader user needs. */}
        <span className="ml-auto" aria-hidden="true">{language.toUpperCase()}</span>
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={onLogout}>
        <LogOut size={16} aria-hidden="true" />
        {t('logout')}
      </DropdownMenuItem>
    </SidebarUserMenu>
  );

  return (
    <>
      {/* Outside the shell so it stays the document's first focusable element;
          it is absolutely positioned until focused, so it occupies no space.
          Its target is the content template's `<section>`: `AppShell` owns the
          `<main>` and spreads consumer props onto its ROOT div, so the id
          cannot be put on the landmark itself. */}
      <a href="#home-main-content" className="skip-link">{t('skipToContent')}</a>

      <AppShellLayout
        logo={logo}
        nav={nav}
        sidebarFooter={userMenu}
        navLabel={t('mainNavigation')}
        menuLabel={t('openNavigation')}
        drawerLabel={t('navigation')}
        pageLabel={t('myKBs')}
      >
        <SectionedGridLayout
          id="home-main-content"
          label={t('myKBs')}
          title={t('myKBs')}
          description={t('kbDescription')}
          sections={sections}
        />

        {/* The members dialog reads the sharing context directly; the same
            eleven values reach KbWorkspaceModals through KbDataContext.sharing,
            so the two mount points now spell the dialog the same way. */}
        <Suspense fallback={<LoadingFallback />}>
          {sharing.showShareModal && <MembersModal
            show={sharing.showShareModal}
            onClose={() => sharing.setShowShareModal(false)}
            sharingKb={sharing.sharingKb}
            shareUserId={sharing.shareUserId}
            setShareUserId={sharing.setShareUserId}
            shareTargetUser={sharing.shareTargetUser}
            shareLoading={sharing.shareLoading}
            sharePermission={sharing.sharePermission}
            setSharePermission={sharing.setSharePermission}
            onLookupUser={sharing.lookupUser}
            onConfirmShare={sharing.confirmShare}
            notFoundUsername={sharing.notFoundUsername}
            onPendingInvited={sharing.clearNotFound}
            myRole={sharing.sharingKb?.myRole ?? 'view'}
          />}
        </Suspense>

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
      </AppShellLayout>

      {siteConfigs.imprint && (
        <footer className="home-view__imprint">{siteConfigs.imprint}</footer>
      )}
    </>
  );
}
