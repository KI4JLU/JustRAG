import { createContext, useContext, type ReactNode } from 'react';

/**
 * The catalog search — the query itself, plus the one section it drives
 * (card KI-787).
 *
 * WHY IT EXISTS. The „KBs entdecken" search field moved out of
 * `KbCatalogPanel` and into the shell's top bar, where `AppChrome` renders it.
 * The query therefore has two readers that are nowhere near each other in the
 * tree — the field in the chrome and the fetch in the panel — and `AppChrome`
 * deliberately takes NO props from the page (its file header states that
 * invariant: it is what keeps a new chrome control from needing a new prop on
 * every page component). A context mounted by the route is the only shape that
 * satisfies both, and it is the shape `AppNavContext` / `SharingContext`
 * already established here.
 *
 * WHY THE SECTION'S OPEN STATE IS IN THE SAME CONTEXT AND NOT A SECOND ONE.
 * The overview unmounts a collapsed section's body, so while „KBs entdecken"
 * is closed there is no `KbCatalogPanel` to receive a keystroke at all — the
 * header field would look live and do nothing. Typing therefore has to expand
 * the section, which means the setter for the query and the setter for the
 * section have to be reachable from ONE place. Putting them in one value lets
 * `useKbSearchState` do it in the setter (see there), instead of an effect in
 * `HomeView` that watches the query and calls `setState` during a cascade.
 *
 * WHAT IS DELIBERATELY NOT HERE: the 250 ms debounce and the `q=` request.
 * Both stay in `KbCatalogPanel`, where the fetch is. This context holds the
 * raw keystroke value; a second debounce in the header would only make the
 * first one's timing unobservable.
 */
export interface KbSearchContextValue {
  /** Raw, undebounced field value. `KbCatalogPanel` debounces it. */
  query: string;
  /**
   * Writes the query. Expands „KBs entdecken" when the new query is non-empty
   * — see the header above for why that is not optional.
   */
  setQuery: (next: string) => void;
  /** „KBs entdecken" open state, persisted like every other section. */
  discoverOpen: boolean;
  /** The section's own disclosure toggle (`SectionedGridLayout.onOpenChange`). */
  setDiscoverOpen: (open: boolean) => void;
  /**
   * „The field should have the caret after the next mount." Set by the chrome
   * when a keystroke on „Geteilte Knowledge Bases" jumps to the overview.
   *
   * WHY IT IS STATE AND NOT A REF. The jump swaps one top-level branch of
   * `AuthenticatedApp` for another, so the whole chrome — `AppChrome`, the
   * field, and any ref pointing at it — is unmounted and rebuilt. A user who
   * typed „Recht" would land on the overview with „R" in the box, focus on
   * `<body>`, and the rest of the word thrown away. This flag survives the
   * remount because, like `query` itself, it is held one level above both
   * branches.
   */
  focusPending: boolean;
  /** Ask for the caret after the next mount (chrome -> chrome, across a jump). */
  requestFocus: () => void;
  /** Clear it; the chrome calls this once it has moved the caret. */
  consumeFocus: () => void;
}

const KbSearchContext = createContext<KbSearchContextValue | null>(null);

export function KbSearchProvider({ value, children }: { value: KbSearchContextValue; children: ReactNode }) {
  return <KbSearchContext.Provider value={value}>{children}</KbSearchContext.Provider>;
}

export function useKbSearch(): KbSearchContextValue {
  const ctx = useContext(KbSearchContext);
  if (!ctx) throw new Error('useKbSearch must be used within KbSearchProvider');
  return ctx;
}
