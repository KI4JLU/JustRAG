import { Container, Grid, PageHeader } from '@ki4jlu/design-system';
import type { ReactNode } from 'react';

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
   * The create tile. Rendered FIRST, before the items — it is the primary
   * action of every page that has one, and a create cell that scrolled away
   * under a long list would be unreachable on the page it belongs to.
   */
  createCell?: ReactNode;
  /**
   * The filter chip row, between the header and the grid — chrome that belongs
   * to the page rather than to the list, which is why it is a slot here and not
   * something each view renders around this component. Omitted, nothing is
   * rendered and the grid moves up.
   */
  filterBar?: ReactNode;
  /** The cards. */
  items: ReactNode[];
  /**
   * Shown ABOVE the grid when there are no items — it does not replace it, so a
   * page with a create tile never hides the way out of being empty.
   *
   * „Werkzeuge" is the caller: its tile is disabled, so without this the page
   * would be one greyed-out control and no explanation of why. „Mein Wissen"
   * and „Geteiltes Wissen" pass none — their tiles speak for themselves.
   */
  emptyState?: ReactNode;
}

export function TopicGridPage({
  id,
  title,
  description,
  createCell,
  filterBar,
  items,
  emptyState,
}: TopicGridPageProps) {
  return (
    <section id={id} aria-label={title} className="flex flex-col">
      <Container className="flex flex-col gap-stack-lg py-gutter md:py-margin-page">
        <PageHeader title={title} description={description} />
        {filterBar}
        {items.length === 0 && emptyState}
        {/* `auto`, not a number: the numbered variants are a BREAKPOINT ladder,
            so `cols={3}` renders two columns everywhere from 768 to 1279px. A
            wall of cards wants the count to follow the container — which also
            keeps following it when the shell's nav column collapses, a width
            change no viewport breakpoint can see. */}
        <Grid cols="auto">
          {createCell}
          {items}
        </Grid>
      </Container>
    </section>
  );
}
