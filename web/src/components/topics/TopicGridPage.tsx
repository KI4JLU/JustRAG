import { Container, Grid, PageHeader, Sortable, SortableDropZone, SortableGroup, SortableItem, SortableOverlay,
  type SortableProps,
} from '@ki4jlu/design-system';
import type { ReactNode } from 'react';

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
   * „Mein Wissen" and „Geteiltes Wissen" pass `TopicsEmptyState`: with no
   * topics at all, or with none matching the active chip.
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
   * Opt-in. Ignored in list view: one-line rows are not cards.
   */
  uniformRows?: boolean;
  /**
   * The cards (or, in list view, the rows) can be dragged into a new order
   * (`useKbSortable` builds it). `ids[i]` is `items[i]`'s id, `pinnedIds[i]`
   * `pinned.items[i]`'s. A card dropped into the other group calls
   * `onMoveToGroup` with `PINNED_GROUP` or `REST_GROUP`.
   */
  sortable?: Pick<SortableProps<string>, 'announcements' | 'screenReaderInstructions'> & {
    /** A drop inside the card's own group, onto another card. */
    onMove: (activeId: string, overId: string) => void;
    /** A drop into another group: onto a card of it (`overId`) or its free area. */
    onMoveToGroup: (activeId: string, group: string, overId: string | null) => void;
    ids: string[];
    pinnedIds: string[];
    /** The drop zone shown for the pinned group while it is empty. */
    dropZoneLabel: string;
    /** The drop zone shown for the rest while it is empty (all shown cards are favorites). */
    restDropZoneLabel: string;
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
  const grid = (cells: ReactNode[]) => (
    <Grid
      cols={viewMode === 'list' ? 1 : 'auto'}
      gap={viewMode === 'list' ? 'sm' : 'gutter'}
      className={uniformRows && viewMode === 'card' ? 'auto-rows-fr' : undefined}
    >
      {cells}
    </Grid>
  );

  const dnd = sortable;
  const group = (groupId: string, ids: string[], cells: ReactNode[]) => (
    // The grid itself is the group's drop area: no wrapper box comes between the page and its grid.
    dnd
      ? (
        <SortableGroup value={groupId} items={ids} asChild>
          {grid(cells.map((cell, i) => <SortableItem key={ids[i]} value={ids[i]}>{cell}</SortableItem>))}
        </SortableGroup>
      )
      : grid(cells)
  );
  const pinnedItems = pinned?.items ?? [];

  const listHeaderEl = viewMode === 'list' && (items.length > 0 || pinnedItems.length > 0) && listHeader
    ? <div className="-mb-stack-md">{listHeader}</div>
    : null;
  const headerInGroups = pinnedItems.length === 0;

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
    // Every shown card is a favorite: while dragging, an empty rest to drop
    // one into, the way the empty favorites get one below.
    groups = (
      <>
        {group(PINNED_GROUP, dnd?.pinnedIds ?? [], pinnedItems)}
        {dnd && <SortableDropZone group={REST_GROUP}>{dnd.restDropZoneLabel}</SortableDropZone>}
      </>
    );
  } else {
    // In list view the column header goes between the favorites' drop zone and
    // the rows, so the zone appearing during a drag does not part the header
    // from its columns.
    groups = (
      <>
        {dnd && pinned && <SortableDropZone group={PINNED_GROUP}>{dnd.dropZoneLabel}</SortableDropZone>}
        {headerInGroups && listHeaderEl}
        {group(REST_GROUP, dnd?.ids ?? [], items)}
      </>
    );
  }

  if (dnd) {
    const byId = new Map<string, ReactNode>();
    dnd.pinnedIds.forEach((cardId, i) => byId.set(cardId, pinnedItems[i]));
    dnd.ids.forEach((cardId, i) => byId.set(cardId, items[i]));
    groups = (
      <Sortable
        value={{ [PINNED_GROUP]: dnd.pinnedIds, [REST_GROUP]: dnd.ids }}
        // The order is the caller's own (it also holds topics a filter hides):
        // it is told what moved where, and the new `value` is not used.
        onValueCommit={(_, meta) => {
          if (meta.fromGroup !== meta.toGroup) dnd.onMoveToGroup(meta.id, meta.toGroup, meta.overId);
          else if (meta.overId) dnd.onMove(meta.id, meta.overId);
        }}
        announcements={dnd.announcements}
        screenReaderInstructions={dnd.screenReaderInstructions}
      >
        {groups}
        {/* A row is as wide as the page: lifted less than a card. */}
        <SortableOverlay lift={viewMode === 'list' ? 'row' : 'card'}>{({ value }) => byId.get(value)}</SortableOverlay>
      </Sortable>
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
        {!headerInGroups && listHeaderEl}
        {groups}
      </Container>
    </section>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <h2 className="m-0 text-sm font-semibold text-on-surface-variant">{children}</h2>;
}
