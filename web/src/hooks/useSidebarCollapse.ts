import { STORAGE_NAMESPACE, useStoredFlag } from './useStoredFlag';

/* ---------------------------------------------------------------------------
 * Whether the app-shell sidebar is minimised (card KI-789).
 *
 * WHY THE APP OWNS IT. Design-system 0.27.0 made `Sidebar` collapsible with
 * CONTROLLED `collapsed` / `onCollapsedChange` and deliberately no
 * `defaultCollapsed` — "a component that remembered anything would be a second
 * truth next to the app's, and the sidebar's width is exactly the kind of thing
 * an app persists per user" (its own doc block). 0.28.0 forwards the same four
 * props through `AppShellLayout`. So the state, and the remembering, are this
 * app's job; `AppChrome` is the single place that mounts the shell, so it is
 * the single place that calls this.
 *
 * WHY IT IS `useStoredFlag` AND NOT A SECOND MECHANISM. „Remember a UI toggle"
 * already had an answer here — `useSectionOpen`, from Stage 7b. KI-789 moved
 * its `localStorage` half into `useStoredFlag` and made both hooks callers of
 * it, so this app has one storage convention, one key namespace and one
 * answer to "what happens when localStorage throws", rather than a third.
 *
 * WHY THE NAME IS NOT `useSidebarCollapsed`. The design system exports a hook
 * of exactly that name (`useSidebarCollapsed`, which READS the surrounding
 * column's resolved state from context). This one OWNS the state and is passed
 * down. Two different things; two different names, so an import cannot be
 * mistaken for the other.
 * ------------------------------------------------------------------------- */

/**
 * The localStorage key. `chrome.` rather than `home.`: the sidebar belongs to
 * the shell around every view, not to the overview.
 */
export const SIDEBAR_COLLAPSED_KEY = `${STORAGE_NAMESPACE}chrome.sidebar.collapsed`;

export interface SidebarCollapseState {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

/**
 * @param defaultCollapsed state on first visit. `false` — the sidebar has been
 * full width for every user so far, and a bump that silently minimised it
 * would be a change nobody asked for.
 */
export function useSidebarCollapse(defaultCollapsed = false): SidebarCollapseState {
  const [collapsed, onCollapsedChange] = useStoredFlag(
    SIDEBAR_COLLAPSED_KEY,
    defaultCollapsed,
  );
  return { collapsed, onCollapsedChange };
}
