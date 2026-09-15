import { createContext, useContext, type ReactNode } from 'react';

/**
 * Top-level navigation destinations that are reachable from a chrome element
 * rather than from page content — today the overview's action row, from KI-696
 * onwards the shell's sidebar.
 *
 * WHAT BELONGS HERE. Exactly the `setView(...)` jumps that are rendered by the
 * shell's sidebar rather than by a page's body. A sidebar owned by the shell
 * cannot receive a callback threaded through the page's props without the
 * shell becoming a second prop-drilling layer, which is the problem KI-770
 * exists to remove. Logout is deliberately absent: it is already published by
 * `AuthContext` as `logout`, and re-publishing it here would give one action
 * two sources of truth.
 *
 * KI-783 ADDED THE FOURTH AND FIFTH, and they are the same kind of thing
 * rather than an exception to the rule. „Geteilte Knowledge Bases" became a
 * top-level view, so the sidebar now has a second destination AND — because
 * the sidebar is drawn on both views by one `AppChrome` — a way back to the
 * overview. Both are chrome-rendered `setView(...)` jumps, i.e. the criterion
 * above verbatim. The alternative was a prop on `HomeView`, which is precisely
 * the drilling layer KI-770 removed.
 *
 * Deliberately NOT extended to the legal pages (`Footer` keeps its own
 * `onNavigate`) or to `handleGoHome`/`handleViewHome` (KB-workspace
 * navigation, already on `KbCoreContext`). `onViewHome` below is NOT those
 * two: they also reset `kbView` and close the settings panel on the way out of
 * a KB workspace, while this one is a plain jump between two chrome-level
 * views that never entered one.
 */
export interface AppNavContextValue {
  /** The KB overview — the sidebar's „Übersicht" row. */
  onViewHome: () => void;
  /** The „Geteilte Knowledge Bases" view (KI-783). */
  onViewSharedKbs: () => void;
  /** The signed-in user's own profile screen. */
  onViewProfile: () => void;
  /** The system-admin console. Rendered only for admin/superadmin. */
  onViewAdmin: () => void;
  /** The user's agents screen. */
  onViewAgents: () => void;
}

const AppNavContext = createContext<AppNavContextValue | null>(null);

export function AppNavProvider({ value, children }: { value: AppNavContextValue; children: ReactNode }) {
  return <AppNavContext.Provider value={value}>{children}</AppNavContext.Provider>;
}

export function useAppNav(): AppNavContextValue {
  const ctx = useContext(AppNavContext);
  if (!ctx) throw new Error('useAppNav must be used within AppNavProvider');
  return ctx;
}
