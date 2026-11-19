import { SidebarFilterMenu, type SidebarFilter } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import {
    historyFilterOptions, historyFiltersNarrow, isDefaultHistoryFilters, type HistoryFilters,
} from './historyFilters';

/* The label of each option, by filter. A translation key per value, so a new
   option without a label fails the type check here. */
const LABELS: { [K in keyof HistoryFilters]: Record<HistoryFilters[K], string> } = {
    topic: { all: 'historyFilterAll', open: 'historyFilterTopicOpen' },
    section: {
        all: 'historyFilterAll', 'my-topics': 'myTopics', 'shared-topics': 'sharedTopics', discover: 'discoverTopics',
    },
    activity: {
        all: 'historyFilterAll', today: 'today', week: 'historyFilterWeek', month: 'historyFilterMonth',
    },
    groupBy: { day: 'historyGroupDay', topic: 'historyFilterTopic', none: 'historyGroupNone' },
    sortBy: { activity: 'historyFilterActivity', created: 'historySortCreated' },
};

const TITLES: Record<keyof HistoryFilters, string> = {
    topic: 'historyFilterTopic',
    section: 'historyFilterSection',
    activity: 'historyFilterActivity',
    groupBy: 'historyGroupBy',
    sortBy: 'historySortBy',
};

interface HistoryFilterMenuProps {
    filters: HistoryFilters;
    onChange: <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) => void;
    onReset: () => void;
    /** Create a section of the user's own (named in place afterwards). */
    onCreateSection: () => void;
}

/**
 * The history's filter menu, beside the „Verlauf" heading: what to show
 * (topic, section, last activity), then how (grouping, sorting). Each row
 * names its current value and opens its options; choosing one keeps the menu
 * open, so several can be set in one go.
 */
export function HistoryFilterMenu({ filters, onChange, onReset, onCreateSection }: HistoryFilterMenuProps) {
    const { t } = useTheme();
    const row = <K extends keyof HistoryFilters>(key: K, separatorBefore = false): SidebarFilter => ({
        key,
        label: t(TITLES[key]),
        value: filters[key],
        options: historyFilterOptions(key).map(option => ({ value: option, label: t(LABELS[key][option]) })),
        separatorBefore,
    });
    return (
        <SidebarFilterMenu
            label={t('historyFilter')}
            activeLabel={t('historyFilterActive')}
            // A filter that hides chats shows on the button, which then stays in sight.
            active={historyFiltersNarrow(filters)}
            filters={[row('topic'), row('section'), row('activity'), row('groupBy', true), row('sortBy')]}
            onValueChange={(key, value) => onChange(key as keyof HistoryFilters, value as never)}
            resetLabel={t('historyFilterReset')}
            resetDisabled={isDefaultHistoryFilters(filters)}
            onReset={onReset}
            actions={[{ label: t('sectionCreate'), onSelect: onCreateSection }]}
        />
    );
}
