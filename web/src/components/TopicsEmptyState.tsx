import type { ReactNode } from 'react';
import { Button } from '@ki4jlu/design-system';
import { SearchX } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { FILTER_ALL, type TopicFilterState } from '../hooks/useTopicFilters';

export interface TopicsEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** The way out of the empty page. */
  action: ReactNode;
}

/**
 * What a topic page shows in place of its grid while it has no cards.
 *
 * The create tile used to be the grid's first cell and so stood in for an
 * empty state; since creation moved to the toolbar an empty page had nothing
 * below the filter row.
 */
export function TopicsEmptyState({ icon, title, description, action }: TopicsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-stack-sm rounded-xl border border-dashed border-outline-variant px-6 py-12 text-center">
      <span aria-hidden="true" className="text-on-surface-variant [&_svg]:size-8">{icon}</span>
      <h2 className="m-0 text-base font-semibold text-on-surface">{title}</h2>
      <p className="m-0 max-w-prose text-sm text-on-surface-variant">{description}</p>
      <div className="mt-2">{action}</div>
    </div>
  );
}

/**
 * The empty state for a topic page: `none` while the page has no topics at
 * all, the filter variant while it has some and the active chip matches none
 * of them, nothing otherwise.
 */
export function TopicListEmptyState({ total, shown, loading, filters, none }: {
  /** Topics on the page before the chip filter. */
  total: number;
  /** Topics left after it. */
  shown: number;
  /** The list has not arrived yet: an empty page would be a claim. */
  loading: boolean;
  filters: Pick<TopicFilterState, 'active' | 'setActive'>;
  none: ReactNode;
}) {
  const { t } = useTheme();
  if (loading || shown > 0) return null;
  if (total === 0 || filters.active === FILTER_ALL) return none;
  return (
    <TopicsEmptyState
      icon={<SearchX />}
      title={t('topicsFilterEmptyTitle')}
      description={t('topicsFilterEmptyBody')}
      action={(
        <Button variant="outline" onClick={() => filters.setActive(FILTER_ALL)}>
          {t('topicsFilterShowAll')}
        </Button>
      )}
    />
  );
}
