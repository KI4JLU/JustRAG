import { createContext, useContext, type ReactNode } from 'react';

/**
 * The header search's state: the field text, the query handed to „Entdecken",
 * and the caret handoff across a chrome rebuild (cards KI-787, KI-837).
 *
 * WHY IT IS A CONTEXT. The field lives in the shell's top bar, which
 * `AppChrome` renders, and `AppChrome` deliberately takes NO props from the
 * page (its file header states that invariant: it is what keeps a new chrome
 * control from needing a new prop on every page component). The catalog
 * panel that reads the Discover query sits in the page. A context mounted by
 * the route is the only shape that satisfies both, and it is the shape
 * `AppNavContext` / `SharingContext` already established here.
 *
 * TWO QUERIES SINCE KI-837, and they are different things on purpose.
 *  - `query` is the header field's text. It drives the global search
 *    dropdown (`GlobalSearch` → `GET /api/search`), and it is held here, not
 *    in the field, only so it survives the chrome being rebuilt.
 *  - `catalogQuery` is what `KbCatalogPanel` filters „Entdecken" by
 *    (`GET /api/kb/catalog?q=`). The header field no longer writes it on
 *    every keystroke: it is set by the dropdown's „show all matching topics
 *    in Discover" row, and cleared when the field is emptied.
 * // TODO: this split is the ASSUMPTION on KI-837 (reversible) — the
 * // alternative, giving Discover its own field back, is the developer's call;
 * // not yet confirmed.
 *
 * WHAT WAS REMOVED (KI-837). `discoverOpen` / `setDiscoverOpen` and the
 * expand-on-type in `setQuery` served the old „KBs entdecken" accordion
 * section. Discover is its own view since 18.09.2026 and the panel mounts
 * with it, so nothing read them any more (`DiscoverView.tsx`'s header had
 * already said so).
 *
 * WHAT IS DELIBERATELY NOT HERE: any debounce. `useGlobalSearch` owns the
 * dropdown's, `KbCatalogPanel` owns the catalog's; this context holds raw
 * values only.
 */
export interface KbSearchContextValue {
  /** The header field's raw text. */
  query: string;
  /** Writes it. Emptying the field also clears `catalogQuery`. */
  setQuery: (next: string) => void;
  /** The query „Entdecken" is filtered by (trimmed); '' for the full catalog. */
  catalogQuery: string;
  /** Hands a query to „Entdecken" — the dropdown's „show all" row. */
  applyCatalogQuery: (next: string) => void;
  /**
   * „The field should have the caret after the next mount." Set by the chrome
   * when a selection swaps the view branch (the „show all in Discover" row).
   *
   * WHY IT IS STATE AND NOT A REF. The jump swaps one top-level branch of
   * `AuthenticatedApp` for another, so the whole chrome — `AppChrome`, the
   * field, and any ref pointing at it — is unmounted and rebuilt. This flag
   * survives the remount because, like `query` itself, it is held one level
   * above both branches.
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
