import type { ChatListEntry } from '../../types';
import type { TopicSection } from '../../utils/topicSection';
import { groupHistoryByDay, type HistoryGroup } from './historyGroups';
import type { HistoryItem } from './historyItems';

/** What the sidebar history shows, and how. Remembered per browser (useHistoryFilters). */
export interface HistoryFilters {
  /** Every topic's chats, or only those of the topic that is open. */
  topic: 'all' | 'open';
  /** Only chats whose topic is listed in this overview. */
  section: 'all' | TopicSection;
  /** Only chats active within this window. */
  activity: 'all' | 'today' | 'week' | 'month';
  groupBy: 'day' | 'topic' | 'none';
  sortBy: 'activity' | 'created';
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  topic: 'all',
  section: 'all',
  activity: 'all',
  groupBy: 'day',
  sortBy: 'activity',
};

const OPTIONS: { [K in keyof HistoryFilters]: readonly HistoryFilters[K][] } = {
  topic: ['all', 'open'],
  section: ['all', 'my-topics', 'shared-topics', 'discover'],
  activity: ['all', 'today', 'week', 'month'],
  groupBy: ['day', 'topic', 'none'],
  sortBy: ['activity', 'created'],
};

/** The options of one filter, in menu order. */
export function historyFilterOptions<K extends keyof HistoryFilters>(key: K): readonly HistoryFilters[K][] {
  return OPTIONS[key];
}

/** A stored value back into filters: unknown keys and values fall back to the default. */
export function parseHistoryFilters(raw: unknown): HistoryFilters {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <K extends keyof HistoryFilters>(key: K): HistoryFilters[K] =>
    (OPTIONS[key] as readonly unknown[]).includes(stored[key])
      ? stored[key] as HistoryFilters[K]
      : DEFAULT_HISTORY_FILTERS[key];
  return {
    topic: pick('topic'),
    section: pick('section'),
    activity: pick('activity'),
    groupBy: pick('groupBy'),
    sortBy: pick('sortBy'),
  };
}

/** True while a filter hides chats; grouping and sorting hide none. */
export function historyFiltersNarrow(filters: HistoryFilters): boolean {
  return filters.topic !== 'all' || filters.section !== 'all' || filters.activity !== 'all';
}

export function isDefaultHistoryFilters(filters: HistoryFilters): boolean {
  return (Object.keys(DEFAULT_HISTORY_FILTERS) as (keyof HistoryFilters)[])
    .every(key => filters[key] === DEFAULT_HISTORY_FILTERS[key]);
}

export interface HistoryFilterContext {
  /** The open topic, or null: „only the open topic" then filters nothing. */
  openTopicId: string | null;
  sectionOf: (chat: ChatListEntry) => TopicSection;
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the activity window, or null for no limit. */
function activitySince(activity: HistoryFilters['activity'], now: Date): number | null {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  switch (activity) {
    case 'today': return midnight;
    // The last 7 / 30 calendar days, today included.
    case 'week': return midnight - 6 * DAY_MS;
    case 'month': return midnight - 29 * DAY_MS;
    default: return null;
  }
}

const sortDate = (filters: HistoryFilters) => (item: HistoryItem) =>
  (filters.sortBy === 'created' ? item.createdAt : item.updatedAt);

/** The chats the filters let through, newest first by the chosen date. */
export function filterHistory(items: HistoryItem[], filters: HistoryFilters, ctx: HistoryFilterContext): HistoryItem[] {
  const since = activitySince(filters.activity, ctx.now ?? new Date());
  const dateOf = sortDate(filters);
  return items
    .filter((item) => {
      const chat = item.source as ChatListEntry;
      if (filters.topic === 'open' && ctx.openTopicId && chat.kbId !== ctx.openTopicId) return false;
      if (filters.section !== 'all' && ctx.sectionOf(chat) !== filters.section) return false;
      if (since !== null && new Date(item.updatedAt).getTime() < since) return false;
      return true;
    })
    .sort((a, b) => new Date(dateOf(b)).getTime() - new Date(dateOf(a)).getTime());
}

/**
 * Filtered, sorted items in their groups. By day: one group per calendar day
 * of the sort date. By topic: one group per topic, in the order of each
 * topic's newest chat. None: a single group without a label.
 */
export function groupHistory(
  items: HistoryItem[],
  filters: HistoryFilters,
  t: (key: string) => string,
  language?: string,
  now: Date = new Date(),
): HistoryGroup[] {
  if (items.length === 0) return [];
  if (filters.groupBy === 'day') return groupHistoryByDay(items, t, language, now, sortDate(filters));
  if (filters.groupBy === 'none') return [{ day: 'all', label: '', items }];
  const groups = new Map<string, HistoryGroup>();
  for (const item of items) {
    const chat = item.source as ChatListEntry;
    const group = groups.get(chat.kbId);
    if (group) group.items.push(item);
    else groups.set(chat.kbId, { day: chat.kbId, label: chat.kbName, items: [item] });
  }
  return [...groups.values()];
}
