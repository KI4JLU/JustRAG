import {
  BookOpen, Trash2, UserPlus, Globe, Pencil, FileText, MessageSquare, Loader2, User, Plus, SlidersHorizontal, Star,
} from 'lucide-react';
import { visibilityState } from '../utils/kbVisibility';
import type { KnowledgeBase } from '../types';
import { canOpenKbAdvancedSettings, canRenameKb } from '../utils/kbAccess';
import './HomeView.css';

/* ---------------------------------------------------------------------------
 * The KB tile, and the grid cells around it (card KI-783).
 *
 * WHY THIS FILE EXISTS. Every line below was module-private inside
 * `HomeView.tsx` until „Geteilte Knowledge Bases" became a top-level view of
 * its own. That view lists the same rows `HomeView`'s „Mit mir geteilt" section
 * lists, so it needs the same tile — and the card that commissioned it named
 * the alternative as the cost to avoid: "duplicated section-rendering logic".
 * So the renderer moved OUT rather than being copied: one definition,
 * `HomeView` and `SharedKbsView` as two mount points. Nothing here changed in
 * the move; it is a file boundary, not a rewrite.
 *
 * WHY THE STYLESHEET IS STILL `HomeView.css` AND THE CLASSES ARE STILL
 * `home-view__*`. Renaming the BEM block would be ~40 selector edits plus the
 * locators in two suites, for no behaviour — and the build's cascade guard
 * (`scripts/check-css-cascade.mjs`) reasons over the emitted stylesheets, so
 * adding an eighth source file here would be a change to the thing being
 * guarded for cosmetic reasons. The stylesheet is shared exactly as the
 * component is.
 * ------------------------------------------------------------------------- */

/** Translate function shape, as `useTheme()` publishes it. */
type T = (k: string) => string;

// lastActiveLabel renders the KB-card freshness line (improvement #6): the
// newest of lastActivityAt / createdAt as a locale-aware "Zuletzt aktiv vor …".
function lastActiveLabel(
  kb: KnowledgeBase,
  rtf: Intl.RelativeTimeFormat,
  t: T,
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
// Der Zaehler steht ausserhalb der Uebersetzung, weil t() keine
// Interpolation kann.
function visibilityBadge(kb: KnowledgeBase, t: T): string {
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
function VisibilityBadge({ kb, t }: { kb: KnowledgeBase; t: T }) {
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
function KbCardChips({ kb, t }: { kb: KnowledgeBase; t: T }) {
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
/**
 * The create tile. `onClick` is optional ONLY together with `disabled`: a tile
 * with neither is a button that looks live and swallows the click, which is
 * the failure mode `ToolsView`'s placeholder would otherwise have. `disabled`
 * is the HTML attribute, so the control is announced as unavailable rather
 * than merely styled as such.
 */
export function CreateCell({
  onClick,
  label,
  text,
  disabled = false,
}: {
  onClick?: () => void;
  label: string;
  text: string;
  disabled?: boolean;
}) {
  return (
    <div className="source-card home-view__create-card">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="home-view__create-button"
      >
        <Plus size={32} aria-hidden="true" />
        <span className="home-view__create-label">{text}</span>
      </button>
    </div>
  );
}

/* `PublicKbCard` and `PublicKbCardProps` stood here and are deleted
   (18.09.2026). It was the tile of the „Favoriten" section, then of „Global
   sichtbar" on „Geteiltes Wissen"; both are gone, and global topics are drawn
   by the catalog's own card in „Entdecken" now. Its two admin actions are not
   lost — editing a global topic is `AdminGlobalKbsTab`, deleting one is the
   admin KB overview. */


export interface PrivateKbCardProps {
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
  t: T;
  onSelectKB: (kb: KnowledgeBase) => void;
  onOpenShare: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onToggleFavourite: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onOpenKbSettings: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onRenameKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
}

/**
 * The favourite star, its own component because the two layouts put it in
 * different places: the card keeps it among the other icon actions, the list
 * row renders it FIRST, ahead of the title.
 *
 * It is ungated on purpose — the caller's own private flag, not a permission.
 * The label names what pressing it DOES, so it flips with the state: a single
 * „Favorit" would leave a screen-reader user guessing the direction, while
 * `aria-pressed` carries the state itself.
 */
function FavouriteButton({
  kb, t, onToggleFavourite,
}: Pick<PrivateKbCardProps, 'kb' | 't' | 'onToggleFavourite'>) {
  return (
    <button
      onClick={(e) => onToggleFavourite(kb, e)}
      className="home-view__mini-icon"
      aria-pressed={kb.isFavourite === true}
      title={kb.isFavourite ? t('removeFavourite') : t('addFavourite')}
      aria-label={kb.isFavourite ? t('removeFavourite') : t('addFavourite')}
    >
      <Star size={16} aria-hidden="true" fill={kb.isFavourite ? 'currentColor' : 'none'} />
    </button>
  );
}

/**
 * The per-card action buttons, extracted so the card and the compact list row
 * render ONE copy rather than two that could drift. Every gate below is the
 * shared predicate the rest of the app uses — none of them is re-derived here.
 */
function KbCardActions({
  kb, systemRole, removingKb, t, onOpenShare, onToggleFavourite, onOpenKbSettings, onRenameKB, onDeleteKB,
  includeFavourite = true,
}: Pick<PrivateKbCardProps,
  'kb' | 'systemRole' | 'removingKb' | 't' | 'onOpenShare' | 'onToggleFavourite'
  | 'onOpenKbSettings' | 'onRenameKB' | 'onDeleteKB'>
  & {
    /** The list row renders the star FIRST instead, so it opts out here. */
    includeFavourite?: boolean;
  }) {
  return (
    <>
      {includeFavourite && <FavouriteButton kb={kb} t={t} onToggleFavourite={onToggleFavourite} />}
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
    </>
  );
}

// PrivateKbCard is one tile in „Mein Wissen" and in „Geteiltes Wissen" — the
// same card in both, since the only difference between them is the caller's own
// role, which the card already reads off myRole.
export function PrivateKbCard({
  kb, currentUserId, systemRole, removingKb, rtf, t, onSelectKB, onOpenShare, onToggleFavourite, onOpenKbSettings, onRenameKB, onDeleteKB,
}: PrivateKbCardProps) {
  const actions = (
    <KbCardActions
      kb={kb}
      systemRole={systemRole}
      removingKb={removingKb}
      t={t}
      onOpenShare={onOpenShare}
      onToggleFavourite={onToggleFavourite}
      onOpenKbSettings={onOpenKbSettings}
      onRenameKB={onRenameKB}
      onDeleteKB={onDeleteKB}
    />
  );

  const nameButton = (
    <button
      type="button"
      className="text-button home-view__kb-name-btn"
      aria-label={`${t('openKb')}: ${kb.name}`}
      onClick={(e) => { e.stopPropagation(); onSelectKB(kb); }}
    >
      {kb.name}
    </button>
  );

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
          {actions}
        </div>
      </div>

      <div className="source-title home-view__kb-name">{nameButton}</div>

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
