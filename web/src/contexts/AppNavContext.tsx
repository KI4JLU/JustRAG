import { createContext, useContext, type ReactNode } from 'react';

/**
 * Top-level navigation destinations that are reachable from a chrome element
 * rather than from page content — today the overview's action row, from KI-696
 * onwards the shell's sidebar.
 *
 * WHY THESE THREE AND NOT MORE. They are exactly the `setView(...)` jumps that
 * KI-696 moves out of `HomeView`'s body and into a sidebar rendered by
 * `AppShellLayout`. A sidebar owned by the shell cannot receive a callback
 * threaded through the page's props without the shell becoming a second
 * prop-drilling layer, which is the problem KI-770 exists to remove. The
 * fourth control in that row, logout, is deliberately absent: it is already
 * published by `AuthContext` as `logout`, and re-publishing it here would give
 * one action two sources of truth.
 *
 * Deliberately NOT extended to the legal pages (`Footer` keeps its own
 * `onNavigate`) or to `handleGoHome`/`handleViewHome` (KB-workspace
 * navigation, already on `KbCoreContext`).
 */
export interface AppNavContextValue {
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
