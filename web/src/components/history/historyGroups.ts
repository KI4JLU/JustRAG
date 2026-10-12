import type { HistoryItem } from './historyItems';

export interface HistoryGroup {
    /** YYYY-MM-DD in local time; also the React key. */
    day: string;
    /** 'today' | 'yesterday' are translation keys; anything else is a formatted date. */
    label: string;
    items: HistoryItem[];
}

const localDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Groups already date-sorted history items by calendar day (local time).
 * Today and yesterday get relative labels, everything else the long date in
 * the UI language. `now` is injectable so tests have an independent oracle.
 */
export function groupHistoryByDay(
    items: HistoryItem[],
    t: (key: string) => string,
    language?: string,
    now: Date = new Date(),
): HistoryGroup[] {
    const today = localDay(now);
    const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const groups: HistoryGroup[] = [];
    for (const item of items) {
        const date = new Date(item.createdAt);
        const day = localDay(date);
        const last = groups[groups.length - 1];
        if (last && last.day === day) {
            last.items.push(item);
            continue;
        }
        const label = day === today ? t('today')
            : day === yesterday ? t('yesterday')
            : date.toLocaleDateString(language, { year: 'numeric', month: 'long', day: 'numeric' });
        groups.push({ day, label, items: [item] });
    }
    return groups;
}
