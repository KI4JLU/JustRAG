import { useCallback, useMemo, useState } from 'react';
import type { KbSearchContextValue } from '../contexts/KbSearchContext';

/**
 * The state behind `KbSearchContext` (cards KI-787, KI-837).
 *
 * IT IS CALLED IN `AuthenticatedApp`, NOT IN A PROVIDER COMPONENT, and that is
 * load-bearing rather than stylistic. Each top-level view is a separate
 * `return` from `AuthenticatedApp`; a provider that owned the state
 * internally would rely on React reconciling those branches at the same
 * position to keep it, and the behaviour that depends on surviving the switch
 * — the „show all in Discover" row lands on „Entdecken" WITH the query and
 * the caret — would silently break. Holding it one level up, the way
 * `sharing` and `appNav` are already held, makes that independent of how the
 * branches reconcile.
 *
 * KI-837 removed the „KBs entdecken" section flag (`useSectionOpen('discover')`)
 * that used to be read here: the section is a view now, see
 * `KbSearchContext`.
 */
export function useKbSearchState(): KbSearchContextValue {
  const [query, setQueryRaw] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  /* See `KbSearchContext.focusPending`: a jump between the top-level views
     rebuilds the chrome, so „keep the caret in the field" cannot be a ref. */
  const [focusPending, setFocusPending] = useState(false);
  const requestFocus = useCallback(() => setFocusPending(true), []);
  const consumeFocus = useCallback(() => setFocusPending(false), []);

  const setQuery = useCallback((next: string) => {
    setQueryRaw(next);
    // Emptying the field is the one edit that also resets „Entdecken": a
    // catalog filtered by a query that is no longer visible anywhere would be
    // a filter the user cannot see or remove. Any other edit leaves it alone —
    // the dropdown, not the catalog, answers a keystroke since KI-837.
    if (!next.trim()) setCatalogQuery('');
  }, []);

  const applyCatalogQuery = useCallback((next: string) => setCatalogQuery(next.trim()), []);

  return useMemo(
    () => ({ query, setQuery, catalogQuery, applyCatalogQuery, focusPending, requestFocus, consumeFocus }),
    [query, setQuery, catalogQuery, applyCatalogQuery, focusPending, requestFocus, consumeFocus],
  );
}
