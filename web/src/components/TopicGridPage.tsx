import { Container, Grid, PageHeader } from '@ki4jlu/design-system';
import type { ReactNode } from 'react';
import { SortableBoard, SortableDropZone, SortableGroup, type SortableBoardProps } from './SortableGrid';

/** The two groups of a sortable page: the favorites on top, then the rest. */
export const PINNED_GROUP = 'pinned';
export const REST_GROUP = 'rest';

/* ---------------------------------------------------------------------------
 * A page that is one flat grid of cards — no sections, no disclosure.
 *
 * WHY THIS EXISTS RATHER THAN A SECOND `SectionedGridLayout`. That template's
 * `sections` are always accordions: every entry requires `isOpen` /
 * `onOpenChange` and renders a chevron trigger inside a heading. Passing it a
 * single permanently-open section would still render that trigger, which is
 * exactly the „remove all tabs" this page was asked to drop. There is no flat
 * variant in the design system today.
 *
 * NOTHING IS REDEFINED HERE. `Container`, `PageHeader` and `Grid` are the
 * design system's own exports and are the same three parts
 * `SectionedGridLayout` composes — this file only omits the accordion layer
 * between them. The page measure, the header typography, the grid tracks and
 * the gaps all stay the template's, so a flat page and a sectioned one line up.
 *
 * THE LANDMARK CONTRACT IS THE TEMPLATE'S, AND IT IS REPRODUCED EXACTLY:
 * `<section aria-label>` with the caller's `id`. `AppChrome`'s skip link
 * targets that id (it cannot go on the shell's own `<main>`, which `AppShell`
 * owns), and the accessible name is what keeps the region distinguishable.
 *
 * // TODO: if a third caller appears, this belongs in the design system as a
 * // `GridLayout` template — or as `sections` becoming optional on
 * // `SectionedGridLayout`. Two callers is not yet evidence for either.
 * ------------------------------------------------------------------------- */

export interface TopicGridPageProps {
  /** Anchors the skip link; must match `AppChrome`'s `contentId`. */
  id: string;
  /** Accessible name of the region, and the visible page heading. */
  title: string;
  /** Sub-heading under the title. */
  description?: ReactNode;
  /**
   * The filter chip row, between the header and the grid — chrome that belongs
   * to the page rather than to the list, which is why it is a slot here and not
   * something each view renders around this component. Omitted, nothing is
   * rendered and the grid moves up.
   */
  filterBar?: ReactNode;
  /** The cards. */
  items: ReactNode[];
  /** Over the items in list view only: the rows' column labels. */
  listHeader?: ReactNode;
  /**
   * `list` renders ONE column at any width; `card` fills as many as fit.
   *
   * It is a column count and not a different card, deliberately: a list view
   * that swapped the tile for a row would be a second card component to keep in
   * step with the first, for a difference the user asked to see as density.
   */
  viewMode?: 'card' | 'list';
  /**
   * Shown ABOVE the grid when there are no items.
   *
   * „Werkzeuge" was the caller while its only tile was a disabled placeholder;
   * since card KI-833 it lists a real tool and passes none. „Mein Wissen" and
   * „Geteiltes Wissen" pass none either — their toolbar's „Neues Thema" /
   * „Thema hinzufügen" button is the way out of an empty page.
   */
  emptyState?: ReactNode;
  /**
   * Every cell in card mode gets ONE height, across rows, set by the tallest
   * cell's content (developer, KI-843: „all cards always the same height").
   * A grid already stretches the cells of one row to that row's tallest; this
   * makes every row as tall as the tallest row (`grid-auto-rows: 1fr`), so a
   * card whose footer chips wrap no longer makes its row taller than the
   * others. Layout only; the cells fill the row by the grid's default
   * `align-items: stretch`, and `PrivateKbCard` pins its footer to the bottom.
   *
   * Opt-in, because the tiles of other pages („Werkzeuge") were not asked to
   * change. Ignored in list view: one-line rows are not cards.
   */
  uniformRows?: boolean;
  /**
   * Card mode only: the cards can be dragged into a new order (`useKbSortable`
   * builds it). `ids[i]` is `items[i]`'s id, `pinnedIds[i]` `pinned.items[i]`'s.
   * A card dropped into the other group calls `onMoveToGroup` with
   * `PINNED_GROUP` or `REST_GROUP`. Ignored in list view.
   */
  sortable?: Omit<SortableBoardProps, 'children' | 'renderOverlay'> & {
    ids: string[];
    pinnedIds: string[];
    /** The drop zone shown for the pinned group while it is empty. */
    dropZoneLabel: string;
  };
  /**
   * The favorites, on lines of their own above `items` — a grid of their own,
   * so the rest always starts on a new line. With both groups non-empty each
   * gets a small label.
   */
  pinned?: {
    label: string;
    restLabel: string;
    items: ReactNode[];
  };
}

export function TopicGridPage({
  id,
  title,
  description,
  filterBar,
  items,
  emptyState,
  viewMode = 'card',
  uniformRows = false,
  listHeader,
  sortable,
  pinned,
}: TopicGridPageProps) {
  const grid = (cells: ReactNode[], ref?: (node: HTMLElement | null) => void, extraClass?: string) => (
    <Grid
      ref={ref}
      cols={viewMode === 'list' ? 1 : 'auto'}
      gap={viewMode === 'list' ? 'sm' : 'gutter'}
      className={[uniformRows && viewMode === 'card' ? 'auto-rows-fr' : '', extraClass ?? ''].join(' ').trim() || undefined}
    >
      {cells}
    </Grid>
  );

  const dnd = sortable && viewMode === 'card' ? sortable : undefined;
  const group = (groupId: string, ids: string[], cells: ReactNode[]) => (
    dnd ? <SortableGroup id={groupId} ids={ids} items={cells}>{grid}</SortableGroup> : grid(cells)
  );
  const pinnedItems = pinned?.items ?? [];

  let groups: ReactNode;
  if (pinnedItems.length > 0 && items.length > 0) {
    groups = (
      <>
        <div className="flex flex-col gap-stack-sm">
          <GroupLabel>{pinned!.label}</GroupLabel>
          {group(PINNED_GROUP, dnd?.pinnedIds ?? [], pinnedItems)}
        </div>
        <div className="flex flex-col gap-stack-sm">
          <GroupLabel>{pinned!.restLabel}</GroupLabel>
          {group(REST_GROUP, dnd?.ids ?? [], items)}
        </div>
      </>
    );
  } else if (pinnedItems.length > 0) {
    groups = group(PINNED_GROUP, dnd?.pinnedIds ?? [], pinnedItems);
  } else {
    groups = (
      <>
        {dnd && pinned && <SortableDropZone group={PINNED_GROUP} label={dnd.dropZoneLabel} />}
        {group(REST_GROUP, dnd?.ids ?? [], items)}
      </>
    );
  }

  if (dnd) {
    const byId = new Map<string, ReactNode>();
    dnd.pinnedIds.forEach((cardId, i) => byId.set(cardId, pinnedItems[i]));
    dnd.ids.forEach((cardId, i) => byId.set(cardId, items[i]));
    groups = (
      <SortableBoard
        onMove={dnd.onMove}
        onMoveToGroup={dnd.onMoveToGroup}
        announcements={dnd.announcements}
        screenReaderInstructions={dnd.screenReaderInstructions}
        renderOverlay={cardId => byId.get(cardId)}
      >
        {groups}
      </SortableBoard>
    );
  }

  return (
    <section id={id} aria-label={title} className="flex flex-col">
      <Container className="flex flex-col gap-stack-lg py-gutter md:py-margin-page">
        <PageHeader title={title} description={description} />
        {filterBar}
        {items.length === 0 && !pinned?.items.length && emptyState}
        {/* `auto`, not a number: the numbered variants are a BREAKPOINT ladder,
            so `cols={3}` renders two columns everywhere from 768 to 1279px. A
            wall of cards wants the count to follow the container — which also
            keeps following it when the shell's nav column collapses, a width
            change no viewport breakpoint can see. */}
        {/* `sm` in list view: cards need the gutter to read as separate
            objects, stacked rows do not — at 24px apart they read as unrelated
            bands rather than one list. The value is the design system's own
            gap scale, not a literal. */}
        {viewMode === 'list' && (items.length > 0 || !!pinned?.items.length) && listHeader && <div className="-mb-stack-md">{listHeader}</div>}
        {groups}
      </Container>
    </section>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <h2 className="m-0 text-sm font-semibold text-on-surface-variant">{children}</h2>;
}
