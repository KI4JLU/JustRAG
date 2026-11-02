import {
  Trash2, UserPlus, Globe, Pencil, FileText, MessageSquare, Loader2, User, Settings, Star, Clock, RefreshCw,
} from 'lucide-react';
import { ActionMenu, Badge, Button, Card, cardNeutralAccent, CardBand, CardContent, CardFooter, CardHairline, CardTitle, Tooltip, TooltipContent, TooltipTrigger, type ActionMenuItem } from '@ki4jlu/design-system';
import { visibilityState } from '../utils/kbVisibility';
import type { KnowledgeBase } from '../types';
import type { Language } from '../translations';
import { formatRelativeCoarse } from '../utils/dates';
import { CategoryPill } from './CategoryPill';
import { categoryDotColor } from './kbSettings/assistant/startPageModel';
import { canOpenKbTopicSettings, canRenameKb } from '../utils/kbAccess';
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
const VISIBILITY_TONE = { public: 'success', shared: 'primary', personal: 'neutral' } as const;

function VisibilityBadge({ kb, t }: { kb: KnowledgeBase; t: T }) {
  const state = visibilityState(kb);
  return (
    // `shrink-0` (KI-843): in the card footer the chip group is the elastic
    // half and wraps; the badge keeps its size at the right edge. The legacy
    // badge rule sets no `flex-shrink`, so the utility is not shadowed.
    <Badge tone={VISIBILITY_TONE[state]} className="home-view__badge ml-auto shrink-0">
      {state === 'public'
        ? <Globe size={10} aria-hidden="true" />
        : <User size={10} aria-hidden="true" />}
      {visibilityBadge(kb, t)}
    </Badge>
  );
}

// A scent chip shows icon + count only; the full phrase ("36 Dateien") is the
// tooltip and the screen-reader text.
function CountChip({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className="home-view__chip">
          {icon}
          <span aria-hidden="true">{n}</span>
          <span className="sr-only">{label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// KbCardChips is the compact metadata slice on each KB card (improvement #6):
// up to two scent chips (files · messages) plus the processing chip while
// files are being ingested. Lucide icons (#2), status tokens (#1).
//
// NO FRESHNESS CHIP ANY MORE (developer mockup). Its information moved: in
// the card it is the „Aktualisiert" meta line (`lastIngestedAt`, when content
// was last successfully ingested — the chip showed the OLDEST file's date); in
// the list row it is dropped, see the row below for why.
/**
 * The card footer's chip group (KI-843): `min-w-0 flex-1 flex-wrap`, so it
 * takes the footer's width left of the badge and WRAPS rather than pushing the
 * badge out of the card. The list row shows its counts in columns instead.
 */
function KbCardChips({ kb, t }: { kb: KnowledgeBase; t: T }) {
  const processing = kb.processingFileCount ?? 0;
  const files = kb.fileCount ?? 0;
  const messages = kb.turnCount ?? 0;
  if (files === 0 && messages === 0 && processing === 0) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-stack-sm">
      {files > 0 && (
        <CountChip icon={<FileText size={12} aria-hidden="true" />} n={files} label={t('kbFilesChip').replace('{n}', String(files))} />
      )}
      {messages > 0 && (
        <CountChip icon={<MessageSquare size={12} aria-hidden="true" />} n={messages} label={t('kbMessagesChip').replace('{n}', String(messages))} />
      )}
      {processing > 0 && (
        <Badge tone="primary" className="home-view__chip">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          {t('kbProcessingChip').replace('{n}', String(processing))}
        </Badge>
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

/* `PublicKbCard` and `PublicKbCardProps` stood here and are deleted
   (18.09.2026). It was the tile of the „Favoriten" section, then of „Global
   sichtbar" on „Geteiltes Wissen"; both are gone, and global topics are drawn
   by the catalog's own card in „Entdecken" now. Its two admin actions are not
   lost — editing a global topic is `AdminGlobalKbsTab`, deleting one is the
   admin KB overview. */


/**
 * The list view's columns: name (elastic), sources, chats, last activity,
 * sharing, star + menu. Shared by the rows and `KbListHeader`, so the labels
 * stand over their values. Below `md` the count and date columns drop out.
 */
const KB_ROW_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 md:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_8rem_7.5rem_auto] [&>*:nth-child(2)]:max-md:hidden [&>*:nth-child(3)]:max-md:hidden [&>*:nth-child(4)]:max-md:hidden';

/** The column labels over the list view's rows. */
export function KbListHeader({ t }: { t: T }) {
  return (
    <div aria-hidden="true" className={`${KB_ROW_COLUMNS} border-l-4 border-transparent pl-4 pr-3 text-xs font-medium text-on-surface-variant`}>
      <span>{t('kbListColTopic')}</span>
      <span className="text-right">{t('kbListColSources')}</span>
      <span className="text-right">{t('kbListColChats')}</span>
      <span className="text-right">{t('kbListColLastActive')}</span>
      <span className="text-right">{t('kbListColSharing')}</span>
      <span className="w-14" />
    </div>
  );
}

export interface PrivateKbCardProps {
  kb: KnowledgeBase;
  currentUserId?: string;
  /**
   * The caller's SYSTEM role: renaming and the topic settings resolve a
   * superadmin to owner, which the card cannot decide from `kb` alone.
   */
  systemRole?: string;
  removingKb: boolean;
  t: T;
  language: Language;
  onSelectKB: (kb: KnowledgeBase) => void;
  /** „Teilen": opens the topic with Thema-Einstellungen on Mitglieder. */
  onOpenShare: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onToggleFavorite: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  /** One compact line instead of a card — the list view. */
  compact?: boolean;
  /** „Einstellungen": opens the topic with Thema-Einstellungen on Startseite. */
  onOpenSettings: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onRenameKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
  onDeleteKB: (kb: KnowledgeBase, e: React.MouseEvent) => void;
}

/**
 * The per-topic actions for the ⋯ menu — ONE list for the card and the list
 * row (and the same entries in the same order wherever a topic has a menu).
 * Only actions on the topic itself (developer guideline, 2026-10-29):
 *   Umbenennen… / Teilen… · Einstellungen ↗ · Löschen…
 * „…" opens a dialog and keeps the overview, ↗ lands in the topic. Teilen…
 * and Einstellungen jump straight to their section of the topic's settings
 * (Mitglieder, Startseite) rather than rebuilding them here. An entry the
 * caller may not use is not shown — no badges; the RAG configuration moved
 * to Verhalten in the settings. The favorite is the star on the card / row.
 * Every gate is the shared predicate the rest of the app uses. The handlers
 * only call `stopPropagation`, which a menu's DOM `Event` shares with a
 * `React.MouseEvent`.
 */
function kbCardActions({
  kb, currentUserId, systemRole, removingKb, t, onOpenShare, onOpenSettings, onRenameKB, onDeleteKB,
}: Pick<PrivateKbCardProps,
  'kb' | 'currentUserId' | 'systemRole' | 'removingKb' | 't' | 'onOpenShare' | 'onOpenSettings' | 'onRenameKB' | 'onDeleteKB'>,
): ActionMenuItem[] {
  const asMouse = (e: Event) => e as unknown as React.MouseEvent;
  const items: ActionMenuItem[] = [];
  // Rename: owner-only (superadmin resolves to owner), mirroring
  // kbaccess.CanRename on the server — a KB admin edits everything but the name.
  if (canRenameKb(kb, systemRole)) {
    items.push({ label: `${t('rename')}…`, icon: <Pencil size={16} aria-hidden="true" />, onSelect: e => onRenameKB(kb, asMouse(e)) });
  }
  // Teilen and Einstellungen open the topic's settings, so they are offered
  // exactly where that window is: the same predicate as the workspace's gear.
  const canSettings = canOpenKbTopicSettings(kb, systemRole, currentUserId);
  if (canSettings) {
    items.push({ label: `${t('share')}…`, icon: <UserPlus size={16} aria-hidden="true" />, onSelect: e => onOpenShare(kb, asMouse(e)) });
    items.push({
      label: t('settings'),
      icon: <Settings size={16} aria-hidden="true" />,
      opensPage: true,
      separatorBefore: true,
      onSelect: e => onOpenSettings(kb, asMouse(e)),
    });
  }
  // Owners delete the KB, everyone else only leaves it (useKbRemoval decides
  // the request and asks first). Disabled while any removal is in flight.
  items.push({
    label: `${kb.myRole === 'owner' ? t('delete') : t('removeFromMyView')}…`,
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
  kb, currentUserId, systemRole, removingKb, t, language, onSelectKB, onOpenShare, onToggleFavorite, onOpenSettings, onRenameKB, onDeleteKB, compact = false,
}: PrivateKbCardProps) {
  const menu = (
    <ActionMenu
      actions={kbCardActions({ kb, currentUserId, systemRole, removingKb, t, onOpenShare, onOpenSettings, onRenameKB, onDeleteKB })}
      label={`${t('kbActions')}: ${kb.name}`}
      triggerClassName={compact ? 'size-6 rounded-[var(--ui-radius-control)]' : 'size-7 rounded-[var(--ui-radius-control)]'}
    />
  );

  // The favorite toggle, on the card's banner and ahead of the row's title:
  // filled while the topic is a favorite. Its label names what a click does.
  const favoriteLabel = kb.isFavorite ? t('removeFavorite') : t('addFavorite');
  const favoriteButton = (className: string, size: number) => (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={favoriteLabel}
      title={favoriteLabel}
      onClick={(e) => { e.stopPropagation(); onToggleFavorite(kb, e); }}
    >
      <Star size={size} aria-hidden="true" fill={kb.isFavorite ? 'currentColor' : 'none'} />
    </Button>
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

  /* THE LIST ROW (developer mockup „Hairline", Liste, 30.10.2026): a DS Card
     with the category's colour as its left edge and a faint tint from it
     (grey edge, no tint without a category); the name with the category pill
     under it, then one column each for sources, chats, last activity and
     sharing, then the star and the ⋯ menu. The columns are `KB_ROW_COLUMNS`,
     which `KbListHeader` labels. */
  if (compact) {
    const files = kb.fileCount ?? 0;
    const messages = kb.turnCount ?? 0;
    const processing = kb.processingFileCount ?? 0;
    return (
      <Card
        accent
        tint={!!kb.category}
        accentColor={kb.category ? categoryDotColor(kb.category) : cardNeutralAccent}
        interactive
        role="presentation"
        onClick={(e) => { if (!isControlClick(e)) onSelectKB(kb); }}
        className={`${KB_ROW_COLUMNS} cursor-pointer items-center py-3 pl-4 pr-3`}
      >
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="max-w-full truncate font-semibold text-on-surface">{nameButton}</span>
          {kb.category && <CategoryPill category={kb.category} small />}
        </div>
        <div className="flex justify-end gap-1">
          {processing > 0
            ? (
              <Badge tone="primary" className="home-view__chip">
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                {t('kbProcessingChip').replace('{n}', String(processing))}
              </Badge>
            )
            : <CountChip icon={<FileText size={12} aria-hidden="true" />} n={files} label={t('kbFilesChip').replace('{n}', String(files))} />}
        </div>
        <div className="flex justify-end">
          <CountChip icon={<MessageSquare size={12} aria-hidden="true" />} n={messages} label={t('kbMessagesChip').replace('{n}', String(messages))} />
        </div>
        <span className="truncate text-right text-sm text-on-surface-variant">
          {formatRelativeCoarse(kb.lastActivityAt || kb.createdAt, language)}
        </span>
        <div className="flex justify-end"><VisibilityBadge kb={kb} t={t} /></div>
        <div className="flex items-center justify-end">
          {favoriteButton('size-7 shrink-0 rounded-[var(--ui-radius-control)] text-on-surface-variant', 16)}
          {menu}
        </div>
      </Card>
    );
  }

  return (
    // Card-level click is a mouse convenience (role="presentation"); the
    // accessible control is the KB-name button below, which carries the
    // label and the keyboard path.
    <Card
      interactive
      accentColor={kb.category ? categoryDotColor(kb.category) : undefined}
      className="group/kb-card h-full cursor-pointer"
      data-testid="kb-card"
      role="presentation"
      onClick={(e) => { if (!isControlClick(e)) onSelectKB(kb); }}
    >
      {/* THE HAIRLINE CARD (developer mockup „Hairline", 30.10.2026): title,
          favorite star and ⋯ on a faint tint of the category's colour, closed
          by a rule in that colour with the category on it. Without a category
          the card stays neutral: no tint, a grey rule. */}
      <CardBand data-testid="kb-card-band">
        <CardTitle>{nameButton}</CardTitle>
        {favoriteButton('size-7 shrink-0 rounded-[var(--ui-radius-control)] text-on-surface-variant', 16)}
        {menu}
      </CardBand>
      <CardHairline>{kb.category && <CategoryPill category={kb.category} onHairline />}</CardHairline>

      {/* At rest, the activity — the meta block and the footer; hovered (or
          holding the focus) the card says what the topic is instead: its
          description, as on its title card. The description lies over both and
          they fade out, so it adds no height: the meta block is at least two
          lines tall, and the description takes its space and the footer's. */}
      <CardContent className="relative flex flex-col pb-0">
        <p className="pointer-events-none absolute inset-x-5 top-0 bottom-0 m-0 line-clamp-4 min-w-0 text-sm text-on-surface-variant opacity-0 transition-opacity group-focus-within/kb-card:pointer-events-auto group-focus-within/kb-card:opacity-100 group-hover/kb-card:pointer-events-auto group-hover/kb-card:opacity-100" data-testid="kb-card-description">{kb.description?.trim() || t('kbHeaderDefault')}</p>
        <div className="mb-3 flex min-h-11 min-w-0 flex-col gap-1 transition-opacity group-focus-within/kb-card:opacity-0 group-hover/kb-card:opacity-0">
          {/* The meta block (KI-848, developer mockup): „Genutzt" (last use),
              „Aktualisiert" (`lastIngestedAt`, the last successful ingest —
              omitted while nothing has been ingested) and, for a topic somebody else owns, who shared it. Values
              are `formatRelativeCoarse`: „gestern", „vor 7 Tagen", „vor 3
              Stunden" (the unit rule is written down in utils/dates.ts). */}
          <MetaLine
            testId="kb-meta-used"
            icon={<Clock size={16} aria-hidden="true" />}
            label={t('kbCardUsed')}
            value={formatRelativeCoarse(kb.lastActivityAt || kb.createdAt, language)}
          />
          {kb.lastIngestedAt && (
            <MetaLine
              testId="kb-meta-updated"
              icon={<RefreshCw size={16} aria-hidden="true" />}
              label={t('kbCardUpdated')}
              value={formatRelativeCoarse(kb.lastIngestedAt, language)}
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
      </CardContent>
      {/* Footer: scent chips left (wrapping when they do not fit), the
          visibility badge right — both inside the card at every width the
          grid renders (card KI-843). Hidden while the description shows. */}
      <CardFooter className="justify-between transition-opacity group-focus-within/kb-card:pointer-events-none group-focus-within/kb-card:opacity-0 group-hover/kb-card:pointer-events-none group-hover/kb-card:opacity-0">
        <KbCardChips kb={kb} t={t} />
        <VisibilityBadge kb={kb} t={t} />
      </CardFooter>
    </Card>
  );
}
