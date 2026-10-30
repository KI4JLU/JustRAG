import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { STORAGE_NAMESPACE, useSharedStoredIds, useStoredFlag } from './useStoredFlag';
import type { KbCategory, KnowledgeBase } from '../types';
import { visibilityState } from '../utils/kbVisibility';

/* ---------------------------------------------------------------------------
 * The chip row's state: which filter is active, the platform's categories
 * (managed behind the „+"), and which of them are hidden.
 *
 * WHY IT IS A HOOK PER VIEW AND NOT ONE SHARED CONTEXT. The four views hold
 * four independent lists, and the developer's model says they answer different
 * questions — „Favoriten" over the topics you own is a different set from
 * „Favoriten" over the ones shared with you. Carrying one active chip across a
 * view switch would silently apply a filter the user chose somewhere else,
 * which is the failure a single shared value has. The CATEGORIES are shared
 * (they are the user's, not the view's) and every instance fetches them; the
 * list is short and the request is cached by the browser.
 *
 * THE ACTIVE CHIP RESETS ON A VIEW SWITCH, for the same reason — each mount
 * starts at ALL. That is a deliberate default rather than a limitation; if the
 * developer wants it sticky, the state moves up to `AuthenticatedApp` beside
 * the other cross-view values.
 *
 * FILTERING IS CLIENT-SIDE, off one payload. `isFavorite` and `category`
 * ride along on every row, so a chip is an array filter and never a request —
 * which is also why switching chips is instant and cannot fail.
 * ------------------------------------------------------------------------- */

/** The two chips that are not categories. Ids cannot collide with a UUID. */
export const FILTER_ALL = 'all';
export const FILTER_FAVORITES = 'favorites';

/**
 * „Mein Wissen" only: the topics you own, split by whether anyone else is on
 * them. Both key off `visibilityState`, the same predicate the card's badge
 * uses — a chip that disagreed with the badge on the card beneath it would be
 * the obvious bug.
 */
export const FILTER_PERSONAL = 'personal';
export const FILTER_SHARED = 'shared';

/**
 * Card or list. Stored as a BOOLEAN („is it the list?") rather than a string,
 * because `useStoredFlag` is this app's one persistence convention and a second
 * one for a two-valued choice would be a second thing to keep working.
 *
 * One key for all four views, not one each: „I prefer lists" is a statement
 * about the person, not about the page they happened to set it on.
 */
export const VIEW_MODE_KEY = `${STORAGE_NAMESPACE}topics.listView`;

export type TopicViewMode = 'card' | 'list';

/**
 * The categories the user hid from the chip row (the category dialog's
 * „Im Filter" switches): system and own ones alike, by id. One key for every
 * view, like the view mode — „I don't need this filter" is about the person.
 * Kept in the browser, as every other UI preference here.
 */
export const HIDDEN_CATEGORIES_KEY = `${STORAGE_NAMESPACE}topics.hiddenCategories`;

/* FAVORITES FIRST, whatever the filter (developer ruling). The create tile
   is rendered by the page and always precedes the list, so „first" here means
   first among the topics — directly after that button.
 
   A STABLE partition rather than a comparator: `Array.prototype.sort` is
   stable in every engine this app targets, but reaching for it would still
   invite a second sort key later and quietly reorder the rest. Splitting the
   list in two and rejoining it keeps the server's order inside each half,
   which is the only ordering promise the API makes. */
function favoritesFirst(kbs: KnowledgeBase[]): KnowledgeBase[] {
  const favorites = kbs.filter(kb => kb.isFavorite === true);
  if (favorites.length === 0 || favorites.length === kbs.length) return kbs;
  return [...favorites, ...kbs.filter(kb => kb.isFavorite !== true)];
}

export interface TopicFilterState {
  active: string;
  setActive: (value: string) => void;
  /**
   * The platform's categories (admin-curated, `GET /api/kb-categories`) — a
   * topic has at most one (`kb.category`). The user's own categories are not
   * offered for now: nothing attaches one to a topic yet (developer,
   * 30.10.2026).
   */
  systemCategories: KbCategory[];
  /** Categories hidden from the chip row. */
  hiddenCategoryIds: ReadonlySet<string>;
  /** Hides or shows one; hiding the active chip falls back to „Alle". */
  setCategoryHidden: (id: string, hidden: boolean) => void;
  /** Applies `active` to a list. Identity when the chip is „Alle". */
  apply: (kbs: KnowledgeBase[]) => KnowledgeBase[];
  viewMode: TopicViewMode;
  setViewMode: (mode: TopicViewMode) => void;
}

export function useTopicFilters(): TopicFilterState {
  const [active, setActive] = useState<string>(FILTER_ALL);
  const [systemCategories, setSystemCategories] = useState<KbCategory[]>([]);
  const [listView, setListView] = useStoredFlag(VIEW_MODE_KEY, false);
  const [hiddenCategoryIds, setHiddenCategoryIds] = useSharedStoredIds(HIDDEN_CATEGORIES_KEY);

  // The system categories: authentication-only, the same list the catalog and
  // the topic settings read. A failure leaves only the user's own chips.
  useEffect(() => {
    axios.get<KbCategory[]>(`${API_BASE_URL}/api/kb-categories`)
      .then(res => setSystemCategories(Array.isArray(res.data) ? res.data : []))
      .catch(() => setSystemCategories([]));
  }, []);

  const setCategoryHidden = useCallback((id: string, hidden: boolean) => {
    const next = new Set(hiddenCategoryIds);
    if (hidden) next.add(id); else next.delete(id);
    setHiddenCategoryIds(next);
    /* A hidden chip cannot be the active one: the row would filter by a chip
       it no longer shows — an emptier list with no visible cause. */
    if (hidden) setActive(prev => (prev === id ? FILTER_ALL : prev));
  }, [hiddenCategoryIds, setHiddenCategoryIds]);

  const apply = useCallback((kbs: KnowledgeBase[]): KnowledgeBase[] => {
    if (active === FILTER_ALL) return favoritesFirst(kbs);
    // The „Favoriten" chip needs no reordering — every row in it is one.
    if (active === FILTER_FAVORITES) return kbs.filter(kb => kb.isFavorite === true);
    if (active === FILTER_PERSONAL) return favoritesFirst(kbs.filter(kb => visibilityState(kb) === 'personal'));
    if (active === FILTER_SHARED) return favoritesFirst(kbs.filter(kb => visibilityState(kb) === 'shared'));
    /* A category: the topic's one platform category. An id that matches
       nothing yields an empty list rather than falling back to everything — a
       filter that silently stopped filtering would look like the category had
       every topic in it. */
    return favoritesFirst(kbs.filter(kb => kb.category?.id === active));
  }, [active]);

  const viewMode: TopicViewMode = listView ? 'list' : 'card';
  const setViewMode = useCallback((mode: TopicViewMode) => setListView(mode === 'list'), [setListView]);

  return useMemo(
    () => ({
      active, setActive, systemCategories, hiddenCategoryIds, setCategoryHidden,
      apply, viewMode, setViewMode,
    }),
    [active, systemCategories, hiddenCategoryIds, setCategoryHidden, apply, viewMode, setViewMode],
  );
}
