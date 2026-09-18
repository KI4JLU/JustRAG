import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import type { KbUserCategory, KnowledgeBase } from '../types';
import { visibilityState } from '../utils/kbVisibility';

/* ---------------------------------------------------------------------------
 * The chip row's state: which filter is active, and the caller's own
 * categories behind the „+".
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
 * FILTERING IS CLIENT-SIDE, off one payload. `isFavourite` and
 * `userCategoryIds` ride along on every row (migration 0068), so a chip is an
 * array filter and never a request — which is also why switching chips is
 * instant and cannot fail.
 * ------------------------------------------------------------------------- */

/** The two chips that are not categories. Ids cannot collide with a UUID. */
export const FILTER_ALL = 'all';
export const FILTER_FAVOURITES = 'favourites';

/**
 * „Mein Wissen" only: the topics you own, split by whether anyone else is on
 * them. Both key off `visibilityState`, the same predicate the card's badge
 * uses — a chip that disagreed with the badge on the card beneath it would be
 * the obvious bug.
 */
export const FILTER_PERSONAL = 'personal';
export const FILTER_SHARED = 'shared';

/* FAVOURITES FIRST, whatever the filter (developer ruling). The create tile
   is rendered by the page and always precedes the list, so „first" here means
   first among the topics — directly after that button.
 
   A STABLE partition rather than a comparator: `Array.prototype.sort` is
   stable in every engine this app targets, but reaching for it would still
   invite a second sort key later and quietly reorder the rest. Splitting the
   list in two and rejoining it keeps the server's order inside each half,
   which is the only ordering promise the API makes. */
function favouritesFirst(kbs: KnowledgeBase[]): KnowledgeBase[] {
  const favourites = kbs.filter(kb => kb.isFavourite === true);
  if (favourites.length === 0 || favourites.length === kbs.length) return kbs;
  return [...favourites, ...kbs.filter(kb => kb.isFavourite !== true)];
}

export interface TopicFilterState {
  active: string;
  setActive: (value: string) => void;
  categories: KbUserCategory[];
  /** Creates one and selects it — the user named it to use it. */
  createCategory: (name: string) => Promise<void>;
  renameCategory: (id: string, name: string) => Promise<void>;
  /** Removes it, and clears the chip if that category was the active filter. */
  deleteCategory: (id: string) => Promise<void>;
  /** Applies `active` to a list. Identity when the chip is „Alle". */
  apply: (kbs: KnowledgeBase[]) => KnowledgeBase[];
}

export function useTopicFilters(): TopicFilterState {
  const [active, setActive] = useState<string>(FILTER_ALL);
  const [categories, setCategories] = useState<KbUserCategory[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await axios.get<KbUserCategory[]>(`${API_BASE_URL}/api/kb-user-categories`);
      /* The shape is checked, not assumed. A non-array here — an error page, a
         proxy's HTML, a mocked endpoint that answers something else — used to
         reach `categories.map` and take the WHOLE VIEW down with
         „map is not a function". A filter row is chrome; it must not be able to
         blank the page it sits on. */
      setCategories(Array.isArray(res.data) ? res.data : []);
    } catch {
      /* A failed category fetch leaves „Alle" and „Favoriten" working rather
         than taking the whole row down: those two need no server state, and a
         filter bar that disappears on a transient error is worse than one
         missing the categories it could not read. */
      setCategories([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createCategory = useCallback(async (name: string) => {
    const res = await axios.post<KbUserCategory>(
      `${API_BASE_URL}/api/kb-user-categories`,
      { name, sortOrder: 0 },
    );
    setCategories(prev => [...prev, res.data]);
    setActive(res.data.id);
  }, []);

  const renameCategory = useCallback(async (id: string, name: string) => {
    const res = await axios.patch<KbUserCategory>(
      `${API_BASE_URL}/api/kb-user-categories/${id}`,
      { name, sortOrder: categories.find(c => c.id === id)?.sortOrder ?? 0 },
    );
    /* The server's row, not the string that was typed: the endpoint replaces
       both fields (it has no field-level patch), so its answer is the truth
       about what the category now is. */
    setCategories(prev => prev.map(c => (c.id === id ? res.data : c)));
  }, [categories]);

  const deleteCategory = useCallback(async (id: string) => {
    await axios.delete(`${API_BASE_URL}/api/kb-user-categories/${id}`);
    setCategories(prev => prev.filter(c => c.id !== id));
    /* If the deleted category was the active chip the row would keep filtering
       by an id that no longer exists — an empty list with no visible cause.
       `apply` treats an unknown id as „match nothing" on purpose, so this reset
       is what stops that state being reachable at all. */
    setActive(prev => (prev === id ? FILTER_ALL : prev));
  }, []);

  const apply = useCallback((kbs: KnowledgeBase[]): KnowledgeBase[] => {
    if (active === FILTER_ALL) return favouritesFirst(kbs);
    // The „Favoriten" chip needs no reordering — every row in it is one.
    if (active === FILTER_FAVOURITES) return kbs.filter(kb => kb.isFavourite === true);
    if (active === FILTER_PERSONAL) return favouritesFirst(kbs.filter(kb => visibilityState(kb) === 'personal'));
    if (active === FILTER_SHARED) return favouritesFirst(kbs.filter(kb => visibilityState(kb) === 'shared'));
    /* A category id that matches nothing yields an empty list rather than
       falling back to everything — a filter that silently stopped filtering
       would look like the category had every topic in it. */
    return favouritesFirst(kbs.filter(kb => kb.userCategoryIds?.includes(active) === true));
  }, [active]);

  return useMemo(
    () => ({
      active, setActive, categories,
      createCategory, renameCategory, deleteCategory,
      apply,
    }),
    [active, categories, createCategory, renameCategory, deleteCategory, apply],
  );
}
