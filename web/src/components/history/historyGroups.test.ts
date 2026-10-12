import { describe, it, expect } from 'vitest';
import { groupHistoryByDay } from './historyGroups';
import type { HistoryItem } from './historyItems';

const item = (id: string, createdAt: string): HistoryItem =>
    ({ id, kind: 'chat', title: id, createdAt, source: {} } as unknown as HistoryItem);

// Oracle: the grouping is checked against dates chosen by hand relative to a
// fixed `now`, not against anything the function itself computes.
const now = new Date(2026, 8, 23, 10, 0, 0); // 23 Sep 2026, local

describe('groupHistoryByDay', () => {
  it('splits by local calendar day and labels today / yesterday relatively', () => {
    const groups = groupHistoryByDay([
      item('a', new Date(2026, 8, 23, 9).toISOString()),
      item('b', new Date(2026, 8, 23, 1).toISOString()),
      item('c', new Date(2026, 8, 22, 23).toISOString()),
      item('d', new Date(2026, 8, 16, 12).toISOString()),
    ], k => k, 'en', now);

    expect(groups.map(g => g.label)).toEqual(['today', 'yesterday', 'September 16, 2026']);
    expect(groups.map(g => g.items.map(i => i.id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('formats older days in the UI language', () => {
    const [g] = groupHistoryByDay([item('d', new Date(2026, 8, 16, 12).toISOString())], k => k, 'de', now);
    expect(g.label).toBe('16. September 2026');
  });

  it('returns no groups for no items', () => {
    expect(groupHistoryByDay([], k => k, 'en', now)).toEqual([]);
  });
});
