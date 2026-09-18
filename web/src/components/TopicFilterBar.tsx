import { FilterChips, SegmentedControl } from '@ki4jlu/design-system';
import { LayoutGrid, List, Star } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useState } from 'react';
import { CategoryManagerModal } from './CategoryManagerModal';
import {
  FILTER_ALL, FILTER_FAVOURITES, FILTER_PERSONAL, FILTER_SHARED,
  type TopicFilterState,
} from '../hooks/useTopicFilters';

/* ---------------------------------------------------------------------------
 * The chip row every shell view mounts: „Alle · Favoriten · <Kategorien> · +".
 *
 * ONE COMPONENT FOR FOUR VIEWS, because the row is chrome rather than content:
 * a view that built its own would be free to order the chips differently or to
 * drop the „+", and the four pages would drift. `FilterChips` (design system
 * 0.32.0) owns the appearance and the ARIA; this file owns which chips exist
 * and what „+" does.
 *
 * „ALLE" AND „FAVORITEN" ARE ALWAYS FIRST and are not categories — their ids
 * are the two literals in `useTopicFilters`, which cannot collide with a UUID.
 * The user's categories follow in the server's order.
 *
 * THE VIEW TOGGLE SITS IN THE SAME ROW BUT NOT IN THE SAME GROUP. Visually it
 * is the right-hand end of one strip, which is what the developer asked for.
 * Semantically it is a second control: the chip group is named „Themen
 * filtern", and a card/list switch is not a filter — announcing it as one more
 * member of that group would be a lie to a screen reader. So the row is a flex
 * container holding two named controls, and `justify-between` is what puts the
 * toggle on the right.
 *
 * „+" OPENS THE CATEGORY MANAGER. It used to call `showPrompt` — one string,
 * create-only — which left a typo permanent and an unwanted category
 * unremovable, although the `PATCH` and `DELETE` endpoints existed the whole
 * time. A create-only control over a mutable list is a dead end, so the chip
 * opens `CategoryManagerModal` instead, which does all three.
 * ------------------------------------------------------------------------- */

export interface TopicFilterBarProps {
  filters: TopicFilterState;
  /**
   * „Persönlich" / „Geteilt", between „Favoriten" and the categories.
   *
   * „Mein Wissen" only, and that is the model rather than a layout choice: the
   * split is „does anyone else have this topic of mine", which is a question
   * only about topics you own. On „Geteiltes Wissen" every row is by definition
   * shared, so the pair would be one chip matching everything and one matching
   * nothing.
   */
  showOwnership?: boolean;
  /** Names the group for a screen reader — the view says what is filtered. */
  label: string;
}

export function TopicFilterBar({ filters, label, showOwnership = false }: TopicFilterBarProps) {
  const { t } = useTheme();

  const [managing, setManaging] = useState(false);

  return (
    <div className="flex items-center gap-stack-md">
    <FilterChips
      className="min-w-0 flex-1"
      aria-label={label}
      value={filters.active}
      /* Pressing the ACTIVE chip clears it back to „Alle" (developer ruling).
         Handled here rather than in `FilterChips`, which stays „exactly one
         active": the component has no idea what an empty filter means, and on
         this row it is not empty at all — it is „Alle", a chip of its own.
         Pressing „Alle" while it is active is therefore a no-op, which is what
         a user pressing the state they are already in expects. */
      onValueChange={(next) => filters.setActive(next === filters.active ? FILTER_ALL : next)}
      onAdd={() => setManaging(true)}
      addLabel={t('manageCategories')}
      options={[
        { value: FILTER_ALL, label: t('filterAll') },
        {
          value: FILTER_FAVOURITES,
          label: t('filterFavourites'),
          icon: <Star className="h-4 w-4" aria-hidden="true" />,
        },
        ...(showOwnership
          ? [
              { value: FILTER_PERSONAL, label: t('filterPersonal') },
              { value: FILTER_SHARED, label: t('filterShared') },
            ]
          : []),
        ...filters.categories.map(c => ({ value: c.id, label: c.name })),
      ]}
    />

      {/* `shrink-0` so the chips scroll past it rather than squeezing it: the
          toggle is the row's fixed end, the filter strip is the elastic half. */}
      <SegmentedControl
        className="shrink-0"
        aria-label={t('viewMode')}
        value={filters.viewMode}
        onValueChange={(v) => filters.setViewMode(v as 'card' | 'list')}
        /* Icon-only (design-system 0.33.0): the label stays the accessible
           name and is rendered sr-only, so the control is two glyphs to the eye
           and still answers to „Karten" / „Liste". */
        options={[
          { value: 'card', label: t('viewModeCards'), icon: <LayoutGrid className="h-4 w-4" aria-hidden="true" /> },
          { value: 'list', label: t('viewModeList'), icon: <List className="h-4 w-4" aria-hidden="true" /> },
        ]}
      />

      <CategoryManagerModal
        show={managing}
        onClose={() => setManaging(false)}
        categories={filters.categories}
        onCreate={filters.createCategory}
        onRename={filters.renameCategory}
        onDelete={filters.deleteCategory}
      />
    </div>
  );
}
