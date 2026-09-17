import { useCallback, useMemo, useState } from 'react';
import type { KbSearchContextValue } from '../contexts/KbSearchContext';
import { useSectionOpen } from './useSectionOpen';

/**
 * The state behind `KbSearchContext` (card KI-787).
 *
 * IT IS CALLED IN `AuthenticatedApp`, NOT IN A PROVIDER COMPONENT, and that is
 * load-bearing rather than stylistic. The overview and „Geteilte Knowledge
 * Bases" are two separate `return`s from `AuthenticatedApp`; a provider that
 * owned the state internally would rely on React reconciling the two branches
 * at the same position to keep it, and the one behaviour that depends on
 * surviving the switch is exactly the one this card adds (typing on the shared
 * view navigates Home WITH the query applied). Holding it one level up, the
 * way `sharing` and `appNav` are already held, makes that independent of how
 * the branches reconcile.
 *
 * WHY THE SECTION FLAG MOVED HERE FROM `HomeView`. `useSectionOpen('discover')`
 * used to be called in `HomeView`; it is the same hook with the same key and
 * the same stored values, so no user loses a remembered section. What changed
 * is only WHERE it is read — one level up, so `setQuery` can expand the section
 * in the same call that writes the query, rather than `HomeView` watching the
 * query in an effect and setting state during a cascading render.
 */
export function useKbSearchState(): KbSearchContextValue {
  const [query, setQueryRaw] = useState('');
  /* Destructured rather than kept as the object `useSectionOpen` returns: that
     object is a fresh literal per render, while `onOpenChange` underneath it is
     stable (`useStoredFlag` wraps it in `useCallback`). Depending on the object
     would give `setQuery` a new identity on every render of `AuthenticatedApp`
     and re-fire `KbCatalogPanel`'s debounced effect through the context value. */
  const { isOpen: discoverOpen, onOpenChange: setDiscoverOpen } = useSectionOpen('discover', false);
  /* See `KbSearchContext.focusPending`: a jump between the two top-level views
     rebuilds the chrome, so „keep the caret in the field" cannot be a ref. */
  const [focusPending, setFocusPending] = useState(false);
  const requestFocus = useCallback(() => setFocusPending(true), []);
  const consumeFocus = useCallback(() => setFocusPending(false), []);

  const setQuery = useCallback((next: string) => {
    setQueryRaw(next);
    // Typing into the header field while the section is collapsed would
    // otherwise talk to an unmounted panel. Only a non-empty query expands:
    // clearing the field back to '' is not a reason to open a section the
    // user closed, and it is also what a browser's "clear" gesture sends.
    if (next.trim()) setDiscoverOpen(true);
  }, [setDiscoverOpen]);

  return useMemo(
    () => ({ query, setQuery, discoverOpen, setDiscoverOpen, focusPending, requestFocus, consumeFocus }),
    [query, setQuery, discoverOpen, setDiscoverOpen, focusPending, requestFocus, consumeFocus],
  );
}
