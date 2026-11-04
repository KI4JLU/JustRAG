import { useCallback, useMemo, useState } from 'react';
import { STORAGE_NAMESPACE } from './useStoredFlag';

/* ---------------------------------------------------------------------------
 * The user's own order of the topic cards, set by dragging them.
 *
 * KEPT IN THE BROWSER, as every other UI preference of the topic views (view
 * mode, hidden categories): one key per view, a JSON array of topic ids. „Mein
 * Wissen" and „Geteiltes Wissen" hold different lists, so each has its own key.
 * A value that does not parse reads as „no order yet" — a corrupted key costs
 * the arrangement, never the view.
 *
 * WHAT THE ORDER DOES NOT KNOW. Topics created (or shared with the user) after
 * the last drag are not in it; they go FIRST, in the server's order, so a new
 * topic shows up where the user looks rather than at the end of a long grid.
 * Ids of topics that are gone are dropped on the next drag.
 *
 * FAVORITES COME FIRST, as a group of their own: `useTopicFilters`
 * partitions the ordered list stably, so the user's order holds inside each
 * half. Dragging a topic from one group into the other also (un)favorites it.
 * ------------------------------------------------------------------------- */

export type KbOrderView = 'my' | 'shared';

export const kbOrderKey = (view: KbOrderView) => `${STORAGE_NAMESPACE}topics.order.${view}`;

function readOrder(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Sorts `items` by `order`; ids the order does not know keep the server's order, ahead of the rest. */
export function applyOrder<T extends { id: string }>(items: T[], order: readonly string[]): T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  const unknown = items.filter(item => !rank.has(item.id));
  const known = items.filter(item => rank.has(item.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...unknown, ...known];
}

/**
 * `ids` with `activeId` placed right after `afterId` — or first, with no
 * `afterId` (an empty group). For a drop on a group's free area.
 */
export function placeAfter(ids: readonly string[], activeId: string, afterId: string | null): string[] {
  const rest = ids.filter(id => id !== activeId);
  const at = afterId === null ? 0 : rest.indexOf(afterId) + 1;
  return [...rest.slice(0, at), activeId, ...rest.slice(at)];
}

/**
 * `ids` with `activeId` moved to where `overId` stands. `ids` is the WHOLE
 * displayed order, not just what a filter chip shows: the visible cards are a
 * subsequence of it, so moving one onto another here moves it the same way
 * among the visible ones and leaves the hidden ones where they were.
 */
export function moveId(ids: readonly string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

export interface KbOrder {
  /** Sorts a list of topics by the stored order. */
  apply: <T extends { id: string }>(items: T[]) => T[];
  /** Stores `ids` (the whole displayed order) with `activeId` moved onto `overId`. */
  move: (ids: readonly string[], activeId: string, overId: string) => void;
  /** Stores `ids` as the order. */
  set: (ids: readonly string[]) => void;
}

export function useKbOrder(view: KbOrderView): KbOrder {
  const key = kbOrderKey(view);
  const [order, setOrder] = useState(() => readOrder(key));

  const apply = useCallback(<T extends { id: string }>(items: T[]) => applyOrder(items, order), [order]);

  const set = useCallback((ids: readonly string[]) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      // See useStoredFlag: a preference that cannot be persisted is not an error.
    }
    setOrder([...ids]);
  }, [key]);

  const move = useCallback(
    (ids: readonly string[], activeId: string, overId: string) => set(moveId(ids, activeId, overId)),
    [set],
  );

  return useMemo(() => ({ apply, move, set }), [apply, move, set]);
}
