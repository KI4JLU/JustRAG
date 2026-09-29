import {
  Trash2, UserPlus, Globe, Pencil, FileText, MessageSquare, Loader2, User, Plus, SlidersHorizontal, Star, Clock, RefreshCw,
} from 'lucide-react';
import { ActionMenu, Tooltip, TooltipContent, TooltipTrigger, type ActionMenuItem } from '@ki4jlu/design-system';
import { visibilityState } from '../utils/kbVisibility';
import type { KnowledgeBase } from '../types';
import type { Language } from '../translations';
import { formatRelativeCoarse } from '../utils/dates';
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
    // `shrink-0` (KI-843): in the card footer the chip group is the elastic
    // half and wraps; the badge keeps its size at the right edge. The legacy
    // badge rule sets no `flex-shrink`, so the utility is not shadowed.
    <div className={`home-view__badge home-view__badge--${state} shrink-0`}>
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

// A scent chip shows icon + count only; the full phrase ("36 Dateien") is the
// tooltip and the screen-reader text.
function CountChip({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="home-view__chip">
          {icon}
          <span aria-hidden="true">{n}</span>
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// KbCardChips is the compact metadata slice on each KB card (improvement #6):
// up to two scent chips (files · messages) plus the processing chip while
// files are being ingested. Lucide icons (#2), status tokens (#1).
//
// NO FRESHNESS CHIP ANY MORE (card KI-848, developer mockup). Its information
// moved: in the card it is the „Aktualisiert" meta line (`newestFileAt`, the
// NEWEST file's date — the chip showed the OLDEST); in the list row it is
// dropped, see the row below for why.
/**
 * TWO LAYOUTS, one per caller, and neither carries a legacy class.
 * `.home-view__chip-row`'s `margin-top: var(--space-2)` is stacked-card
 * spacing, and it cannot be overridden with a utility — the rule is unlayered
 * and Tailwind's utilities are in `@layer utilities`, so the unlayered one
 * wins (`scripts/check-css-cascade.mjs` gates on that). So both forms are
 * utilities only:
 *  - `row`, the compact list row: one line, `shrink-0` — the row's NAME is
 *    what truncates, the chips keep their size.
 *  - `footer`, the card footer (KI-843): `min-w-0 flex-1 flex-wrap`, so the
 *    chip group takes the footer's width left of the badge and WRAPS rather
 *    than pushing the badge out of the card.
 */
function KbCardChips({ kb, t, layout }: { kb: KnowledgeBase; t: T; layout: 'row' | 'footer' }) {
  const processing = kb.processingFileCount ?? 0;
  const files = kb.fileCount ?? 0;
  const messages = kb.turnCount ?? 0;
  if (files === 0 && messages === 0 && processing === 0) return null;
  return (
    <div
      className={layout === 'footer'
        ? 'flex min-w-0 flex-1 flex-wrap items-center gap-stack-sm'
        : 'flex shrink-0 items-center gap-stack-sm'}
    >
      {files > 0 && (
        <CountChip icon={<FileText size={12} aria-hidden="true" />} n={files} label={t('kbFilesChip').replace('{n}', String(files))} />
      )}
      {messages > 0 && (
        <CountChip icon={<MessageSquare size={12} aria-hidden="true" />} n={messages} label={t('kbMessagesChip').replace('{n}', String(messages))} />
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
 * One line of the card's meta block (card KI-848, developer mockup): a muted
 * 16px icon, a muted label and a BOLD value — „🕒 Genutzt **gestern**".
 *
 * Utilities only, and none of the legacy `.source-meta` / `.home-view__kb-meta`
 * / `.home-view__owner-meta` rules: those are unlayered and carry stacked-card
 * margins a flex column does not want (see `KbCardChips`). The line truncates
 * rather than wrapping, so every card's meta block has the same height per
 * line count — the equal-height grid (KI-843) then only has to absorb the
 * number of lines, not their wrapping.
 */
function MetaLine({ icon, label, value, testId }: { icon: React.ReactNode; label: string; value: React.ReactNode; testId: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 font-label-sm text-label-sm text-on-surface-variant" data-testid={testId}>
      <span className="flex shrink-0">{icon}</span>
      <span className="truncate">
        {label}{' '}<span className="font-semibold text-on-surface">{value}</span>
      </span>
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
 * the failure mode `ToolsView`'s placeholder tile had to avoid. `disabled`
 * is the HTML attribute, so the control is announced as unavailable rather
 * than merely styled as such. (No caller passes `disabled` since card KI-833
 * replaced that placeholder tile with the first real tool.)
 */
export function CreateCell({
  onClick,
  label,
  text,
  disabled = false,
  compact = false,
}: {
  onClick?: () => void;
  label: string;
  text: string;
  disabled?: boolean;
  /** One list row instead of a tile — matches `PrivateKbCard`'s compact form. */
  compact?: boolean;
}) {
  /* THE COMPACT TILE IS THE SAME HEIGHT AS A LIST ROW, and neither states one.
 
     Both are `px-gutter py-stack-sm` around a single 24px line box, so the two
     heights are equal by construction rather than by a number kept in step:
       - a row's tallest children are its mini-icon buttons (4px padding around
         a 16px icon = 24px) and its name (`text-body-base`, 16px x 1.5 = 24px);
       - this tile's line is the same 16px icon and the same type token.
     Change the type scale or the icon size and both move together.
 
     It uses `.home-view__create-row`, a sibling of `.home-view__create-card`
     that repeats the tile's three appearance declarations (dashed border,
     --bg-secondary, --accent-primary) and drops its shape — the `min-height`
     and the centred column. A modifier ON the tile class would not work: that
     rule and `.source-card`'s `padding: 1rem` are unlayered, so no utility
     could override them, and the row needs different padding. */
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="home-view__create-row"
      >
        {/* The icon sits in the SAME 24px box as a row's leading star
            (`home-view__mini-icon` = 4px around a 16px glyph), which is what
            makes this label and a topic's title start at the same x. Matching
            it with a padding value instead would tie the two together through a
            number nobody would think to keep in step. */}
        <span className="home-view__mini-icon flex shrink-0 items-center justify-center">
          <Plus size={16} aria-hidden="true" />
        </span>
        <span className="truncate">{text}</span>
      </button>
    );
  }

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
  language: Language;
  onSelectKB: (kb: KnowledgeBase) => void;
  onOpenShare: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onToggleFavourite: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  /** One compact line instead of a card — the list view. */
  compact?: boolean;
  onOpenKbSettings: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onRenameKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
}

/**
 * The per-card actions for the ⋮ menu, ONE list for the card and the compact
 * list row so the two cannot drift. Every gate below is the shared predicate
 * the rest of the app uses — none of them is re-derived here. The handlers
 * only call `stopPropagation`, which a menu's DOM `Event` shares with a
 * `React.MouseEvent`.
 */
function kbCardActions({
  kb, systemRole, removingKb, t, onOpenShare, onToggleFavourite, onOpenKbSettings, onRenameKB, onDeleteKB,
}: Pick<PrivateKbCardProps,
  'kb' | 'systemRole' | 'removingKb' | 't' | 'onOpenShare' | 'onToggleFavourite' | 'onOpenKbSettings' | 'onRenameKB' | 'onDeleteKB'>,
): ActionMenuItem[] {
  const asMouse = (e: Event) => e as unknown as React.MouseEvent;
  // The favourite is ungated — the caller's own flag, not a permission. Its
  // label names what selecting it DOES, so it flips with the state.
  const items: ActionMenuItem[] = [{
    label: kb.isFavourite ? t('removeFavourite') : t('addFavourite'),
    icon: <Star size={16} aria-hidden="true" fill={kb.isFavourite ? 'currentColor' : 'none'} />,
    onSelect: e => onToggleFavourite(kb, asMouse(e)),
  }];
  if (canManageMembers(kb)) {
    items.push({ label: t('share'), icon: <UserPlus size={16} aria-hidden="true" />, onSelect: e => onOpenShare(kb, asMouse(e)) });
  }
  // Rename: owner-only (superadmin resolves to owner), mirroring
  // kbaccess.CanRename on the server — a KB admin edits everything but the name.
  if (canRenameKb(kb, systemRole)) {
    items.push({ label: t('renameKb'), icon: <Pencil size={16} aria-hidden="true" />, onSelect: e => onRenameKB(kb, asMouse(e)) });
  }
  // RAG settings: kbAdvancedChain needs a system role in {api-user, admin,
  // superadmin} on top of the KB admin role — not the members gate.
  if (canOpenKbAdvancedSettings(kb, systemRole)) {
    items.push({ label: t('kbAdvancedSettings'), icon: <SlidersHorizontal size={16} aria-hidden="true" />, onSelect: e => onOpenKbSettings(kb, asMouse(e)) });
  }
  // Owners delete the KB, everyone else only leaves it (useKbRemoval decides
  // the request). Disabled while any removal is in flight.
  items.push({
    label: kb.myRole === 'owner' ? t('deleteKb') : t('removeFromMyView'),
    icon: <Trash2 size={16} aria-hidden="true" />,
    destructive: true,
    disabled: removingKb,
    separatorBefore: true,
    onSelect: e => onDeleteKB(kb, asMouse(e)),
  });
  return items;
}

/** A click on one of the card's own controls — or on its portaled menu, whose
 *  React events still bubble through the card. */
const isControlClick = (e: React.MouseEvent) =>
  (e.target as HTMLElement).closest('button, a, [role="menu"], [role="menuitem"]') !== null;

// PrivateKbCard is one tile in „Mein Wissen" and in „Geteiltes Wissen" — the
// same card in both, since the only difference between them is the caller's own
// role, which the card already reads off myRole.
export function PrivateKbCard({
  kb, currentUserId, systemRole, removingKb, rtf, t, language, onSelectKB, onOpenShare, onToggleFavourite, onOpenKbSettings, onRenameKB, onDeleteKB, compact = false,
}: PrivateKbCardProps) {
  const menu = (
    <ActionMenu
      actions={kbCardActions({ kb, systemRole, removingKb, t, onOpenShare, onToggleFavourite, onOpenKbSettings, onRenameKB, onDeleteKB })}
      label={`${t('kbActions')}: ${kb.name}`}
      triggerClassName="size-6 rounded-[var(--ui-radius-control)]"
    />
  );

  // A favourite shows a filled star ahead of its title; toggling it is a menu
  // action. Decorative: the state is in the menu item's label.
  const favStar = kb.isFavourite ? (
    <Star size={16} fill="currentColor" aria-hidden="true" className="home-view__fav-star" />
  ) : null;

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

  /* THE LIST ROW. One line, everything on one vertical centre.
   *
     IT SHARES NO CLASS WITH THE CARD, and that is the fix rather than a style
     preference. `.source-card` (padding 1rem, margin-bottom 1rem),
     `.source-title` (margin-bottom .25rem), `.home-view__kb-name`
     (margin-top 1rem) and `.home-view__kb-meta` (margin-top .5rem) are all
     STACKED-CARD spacing: inside a flex row those top margins push their child
     down and defeat `items-center`, which is what tilted the row off its
     baseline.
 
     They cannot be overridden with a utility either. Those rules are UNLAYERED
     while Tailwind's utilities sit in `@layer utilities`, so an unlayered rule
     wins regardless of order — the repo gates on exactly that
     (`scripts/check-css-cascade.mjs`). So the row is built from tokens only,
     and carries no legacy class at all.
 
     No fixed height: `items-center` on a row whose children have none makes the
     height the tallest child plus the token padding. `p-stack-md` is one value
     on all four sides (developer ruling) — a row is small enough that an
     asymmetric inset reads as a mistake rather than as rhythm. */
  if (compact) {
    return (
      <div
        className="flex cursor-pointer items-center gap-stack-md rounded-[var(--ui-radius-card)] border border-outline-variant bg-surface-container-lowest p-stack-md transition-colors hover:bg-secondary-container"
        role="presentation"
        onClick={(e) => { if (!isControlClick(e)) onSelectKB(kb); }}
      >
        {favStar}
        <div className="flex min-w-0 flex-1 items-center font-body-base text-body-base text-on-surface">
          <span className="truncate">{nameButton}</span>
        </div>
        <div className="flex shrink-0 items-center gap-stack-sm">
          {/* No freshness chip in the row (KI-848). It used to show the
              OLDEST file's date; the card's replacement, „Aktualisiert
              {relative}", is text, and ~150px of text on top of the row's
              existing „Zuletzt aktiv …" line pushes the worst-case row
              (four-digit counts, processing chip, „Geteilt (12)") past its
              width. The row keeps one date line, the card carries both. */}
          <KbCardChips kb={kb} t={t} layout="row" />
          <span className="whitespace-nowrap font-label-sm text-label-sm text-on-surface-variant">
            {lastActiveLabel(kb, rtf, t)}
          </span>
          <VisibilityBadge kb={kb} t={t} />
          {menu}
        </div>
      </div>
    );
  }

  return (
    // Card-level click is a mouse convenience (role="presentation"); the
    // accessible control is the KB-name button below, which carries the
    // label and the keyboard path.
    <div
      className="source-card home-view__kb-card"
      role="presentation"
      onClick={(e) => { if (!isControlClick(e)) onSelectKB(kb); }}
    >
      {/* Title first, top left (after the star of a favourite); every action,
          the favourite toggle included, sits in the ⋮ menu top right. */}
      <div className="home-view__card-top">
        {favStar}
        <div className="source-title home-view__kb-name">{nameButton}</div>
        {menu}
      </div>

      {/* The meta block (KI-848, developer mockup): „Genutzt" (last use),
          „Aktualisiert" (the newest file's effective date — omitted without
          files) and, for a topic somebody else owns, who shared it. Values
          are `formatRelativeCoarse`: „gestern", „vor 7 Tagen", „vor 3
          Stunden" (the unit rule is written down in utils/dates.ts). */}
      <div className="mt-stack-sm flex min-w-0 flex-col gap-1">
        <MetaLine
          testId="kb-meta-used"
          icon={<Clock size={16} aria-hidden="true" />}
          label={t('kbCardUsed')}
          value={formatRelativeCoarse(kb.lastActivityAt || kb.createdAt, language)}
        />
        {kb.newestFileAt && (
          <MetaLine
            testId="kb-meta-updated"
            icon={<RefreshCw size={16} aria-hidden="true" />}
            label={t('kbCardUpdated')}
            value={formatRelativeCoarse(kb.newestFileAt, language)}
          />
        )}
        {kb.userId !== currentUserId && (() => {
          const fullName = `${kb.ownerFirstName || ''} ${kb.ownerLastName || ''}`.trim();
          const displayName = fullName || kb.ownerUsername || t('unknownUser');
          // „von {name}": the words around the name are the muted label, the
          // name is the bold value — one template, so translators keep the
          // word order.
          const [before, after = ''] = t('sharedBy').split('{name}');
          return (
            <MetaLine
              testId="kb-meta-owner"
              icon={<User size={16} aria-hidden="true" />}
              label={before.trim()}
              value={<>{displayName}{after}</>}
            />
          );
        })()}
      </div>
      {/* Footer: scent chips left (wrapping when they do not fit), the
          visibility badge right — both inside the card at every width the
          grid renders (card KI-843). */}
      <div className="home-view__card-footer">
        <KbCardChips kb={kb} t={t} layout="footer" />
        <VisibilityBadge kb={kb} t={t} />
      </div>
    </div>
  );
}
