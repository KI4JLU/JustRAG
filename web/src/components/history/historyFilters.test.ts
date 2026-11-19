import { describe, expect, it } from 'vitest';
import type { ChatListEntry } from '../../types';
import {
  DEFAULT_HISTORY_FILTERS, filterHistory, groupHistory, historyFiltersNarrow, isDefaultHistoryFilters,
  parseHistoryFilters, type HistoryFilters,
} from './historyFilters';
import type { HistoryItem } from './historyItems';

// Local time, so the day arithmetic below does not depend on the zone.
const NOW = new Date(2026, 10, 18, 12, 0, 0);
const at = (daysAgo: number, hour = 9) => new Date(2026, 10, 18 - daysAgo, hour, 0, 0).toISOString();

const item = (id: string, kbId: string, kbRole: string, created: string, updated: string): HistoryItem => {
  const source = {
    id, kbId, kbName: `Topic ${kbId}`, kbVisibility: 'private', kbRole, title: id, createdAt: created, updatedAt: updated,
  } as ChatListEntry;
  return { id, kind: 'chat', title: id, createdAt: created, updatedAt: updated, source };
};

// own-old was created long ago and used today; shared-new was created
// yesterday and not used since.
const ITEMS = [
  item('own-old', 'kb1', 'owner', at(40), at(0)),
  item('shared-new', 'kb2', 'view', at(1), at(1)),
  item('own-week', 'kb1', 'owner', at(5), at(5)),
  item('shared-month', 'kb2', 'view', at(20), at(20)),
];
const ctx = {
  openTopicId: 'kb1' as string | null,
  sectionOf: (c: ChatListEntry) => (c.kbRole === 'owner' ? 'my-topics' as const : 'shared-topics' as const),
  now: NOW,
};
const ids = (items: HistoryItem[]) => items.map(i => i.id);
const withFilters = (patch: Partial<HistoryFilters>) => ({ ...DEFAULT_HISTORY_FILTERS, ...patch });

describe('filterHistory', () => {
  // ORACLE: the fixture dates above.
  it('shows everything by last activity, newest first, by default', () => {
    expect(ids(filterHistory(ITEMS, DEFAULT_HISTORY_FILTERS, ctx))).toEqual(['own-old', 'shared-new', 'own-week', 'shared-month']);
  });

  it('sorts by creation date when asked', () => {
    expect(ids(filterHistory(ITEMS, withFilters({ sortBy: 'created' }), ctx))).toEqual(['shared-new', 'own-week', 'shared-month', 'own-old']);
  });

  it('narrows to the open topic, and to nothing less while none is open', () => {
    expect(ids(filterHistory(ITEMS, withFilters({ topic: 'open' }), ctx))).toEqual(['own-old', 'own-week']);
    expect(filterHistory(ITEMS, withFilters({ topic: 'open' }), { ...ctx, openTopicId: null })).toHaveLength(4);
  });

  it('narrows to the chats of one overview', () => {
    expect(ids(filterHistory(ITEMS, withFilters({ section: 'shared-topics' }), ctx))).toEqual(['shared-new', 'shared-month']);
    expect(filterHistory(ITEMS, withFilters({ section: 'discover' }), ctx)).toEqual([]);
  });

  // ORACLE: calendar days in local time — today, the last 7 and the last 30
  // days each include today.
  it.each([
    ['today', ['own-old']],
    ['week', ['own-old', 'shared-new', 'own-week']],
    ['month', ['own-old', 'shared-new', 'own-week', 'shared-month']],
  ] as const)('keeps the chats active within %s', (activity, expected) => {
    expect(ids(filterHistory(ITEMS, withFilters({ activity }), ctx))).toEqual(expected);
  });

  it('counts the 7th day back as inside the week and the 8th as outside', () => {
    const edge = [item('in', 'kb1', 'owner', at(6, 0), at(6, 0)), item('out', 'kb1', 'owner', at(7, 23), at(7, 23))];
    expect(ids(filterHistory(edge, withFilters({ activity: 'week' }), ctx))).toEqual(['in']);
  });
});

describe('groupHistory', () => {
  const t = (key: string) => key;
  const sorted = filterHistory(ITEMS, DEFAULT_HISTORY_FILTERS, ctx);

  it('groups by the day of the sort date', () => {
    const groups = groupHistory(sorted, DEFAULT_HISTORY_FILTERS, t, 'en', NOW);
    expect(groups.map(g => [g.label, ids(g.items)])).toEqual([
      ['today', ['own-old']],
      ['yesterday', ['shared-new']],
      ['November 13, 2026', ['own-week']],
      ['October 29, 2026', ['shared-month']],
    ]);
  });

  it('groups by topic, in the order of each topic\'s newest chat', () => {
    const groups = groupHistory(sorted, withFilters({ groupBy: 'topic' }), t, 'en', NOW);
    expect(groups.map(g => [g.label, ids(g.items)])).toEqual([
      ['Topic kb1', ['own-old', 'own-week']],
      ['Topic kb2', ['shared-new', 'shared-month']],
    ]);
  });

  it('is one unlabelled group without grouping, and none at all for an empty list', () => {
    const groups = groupHistory(sorted, withFilters({ groupBy: 'none' }), t, 'en', NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('');
    expect(ids(groups[0].items)).toEqual(ids(sorted));
    expect(groupHistory([], withFilters({ groupBy: 'none' }), t, 'en', NOW)).toEqual([]);
  });
});

describe('stored filters', () => {
  it('reads valid values and replaces anything else with the default', () => {
    expect(parseHistoryFilters({ topic: 'open', section: 'nowhere', groupBy: 'topic', extra: 1 })).toEqual({
      ...DEFAULT_HISTORY_FILTERS, topic: 'open', groupBy: 'topic',
    });
    expect(parseHistoryFilters(null)).toEqual(DEFAULT_HISTORY_FILTERS);
    expect(parseHistoryFilters('x')).toEqual(DEFAULT_HISTORY_FILTERS);
  });

  it('tells a filter that hides chats from one that only rearranges them', () => {
    expect(historyFiltersNarrow(DEFAULT_HISTORY_FILTERS)).toBe(false);
    expect(historyFiltersNarrow(withFilters({ groupBy: 'topic', sortBy: 'created' }))).toBe(false);
    expect(historyFiltersNarrow(withFilters({ section: 'discover' }))).toBe(true);
    expect(isDefaultHistoryFilters(withFilters({ sortBy: 'created' }))).toBe(false);
    expect(isDefaultHistoryFilters({ ...DEFAULT_HISTORY_FILTERS })).toBe(true);
  });
});
