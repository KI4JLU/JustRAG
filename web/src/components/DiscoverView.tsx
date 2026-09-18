import { Container, PageHeader } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { AppChrome } from './AppChrome';
import KbCatalogPanel from './KbCatalogPanel';

/* ---------------------------------------------------------------------------
 * „Entdecken" — the catalog of global topics you do NOT hold yet (developer
 * ruling, 18.09.2026).
 *
 * WHY IT IS A VIEW NOW. It used to be „KBs entdecken", the third of four
 * collapsible sections on the overview, and it never fitted there: the
 * overview's other sections listed things the user already had, while this one
 * lists everything they do not. Removing global topics from „Mein Wissen" took
 * the section with it, and the developer chose a nav row over folding it into
 * „Geteiltes Wissen" — which is the page for what you already hold.
 *
 * WHAT THE PROMOTION DELETED, and it is worth stating because it removes a
 * whole mechanism rather than moving it. As a section the panel was UNMOUNTED
 * while collapsed, which is what made expanding it re-read the catalog, and
 * what forced the top-bar search field to expand the section before it could
 * talk to the panel at all (`useKbSearchState.setQuery` did that). On a page
 * of its own the panel mounts when the page does, so:
 *   - the catalog is re-read on every visit, for free, with no disclosure
 *     state to coordinate;
 *   - `discoverOpen` / `setDiscoverOpen` are gone from `KbSearchContext`;
 *   - the search field navigates HERE instead of expanding something.
 *
 * NO PAGE-LEVEL FILTERING. The query lives in `KbSearchContext` and is read by
 * `KbCatalogPanel`, which owns the 250 ms debounce and the
 * `GET /api/kb/catalog?q=` request. This file adds a heading and a landmark.
 * ------------------------------------------------------------------------- */

/** Anchors the skip link; must match the `contentId` handed to `AppChrome`. */
const CONTENT_ID = 'discover-content';

export interface DiscoverViewProps {
  onSubscriptionChange: () => void;
  onOpenKbById: (id: string) => void;
}

export function DiscoverView({ onSubscriptionChange, onOpenKbById }: DiscoverViewProps) {
  const { t } = useTheme();

  return (
    <AppChrome active="discover" contentId={CONTENT_ID}>
      <section id={CONTENT_ID} aria-label={t('discoverTopics')} className="flex flex-col">
        <Container className="flex flex-col gap-stack-lg py-gutter md:py-margin-page">
          <PageHeader title={t('discoverTopics')} description={t('discoverTopicsDescription')} />
          <KbCatalogPanel onSubscriptionChange={onSubscriptionChange} onOpenKb={onOpenKbById} />
        </Container>
      </section>
    </AppChrome>
  );
}
