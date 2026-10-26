import { useSyncExternalStore } from 'react';

/*
 * Open state of the admin settings dialog (`AdminUI`), shared by the one component that renders
 * it (`AppUserMenu`, mounted once per page) and the controls that open it (the user menu's
 * „Admin-Einstellungen" item, the ⌘K account group).
 *
 * BACKED BY THE URL: `?admin=<section>` on any page opens the dialog over whatever view is
 * showing; a bare `?admin` means the first section. THIS FILE IS THE ONLY PLACE THAT TOUCHES THAT
 * PARAMETER — callers use the four functions below and `useAdminDialog`, so a router can later
 * replace this one file without touching them.
 *
 *   - Read: on load and on `popstate`.
 *   - Opening PUSHES `?admin=<section>`, so the browser's back button closes the dialog.
 *   - Switching sections REPLACES the URL: back must not step through every section before it
 *     closes, which would be a trap in a modal.
 *   - Closing goes back one step when the dialog pushed the entry (the entry carries
 *     `history.state.adminDialog`), else (a link that already carried `?admin`) it replaces the
 *     URL without the parameter.
 *   - The path, the other parameters and the hash are left as they are.
 *   - Rights are the caller's: the store knows no user. `stripAdminDialog` is for a user who may
 *     not open it (the parameter is ignored and removed); a section a user may not see falls
 *     back to the first one in `AdminUI`.
 */

/** The sections, in the order of the dialog's nav. The first is what a bare `?admin` opens. */
export const ADMIN_SECTIONS = [
  'configs', 'auth', 'search', 'agent', 'site', 'kb-overview', 'global-kbs', 'users', 'roles', 'health', 'eval',
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

const PARAM = 'admin';
const MARKER = 'adminDialog';

type State = { open: boolean; section: AdminSection };

const CLOSED: State = { open: false, section: 'configs' };

function isSection(v: string | null): v is AdminSection {
  return (ADMIN_SECTIONS as readonly string[]).includes(v ?? '');
}

/** What the address bar says: `?admin` (bare or unknown value) is the first section. */
function readUrl(): State {
  if (typeof window === 'undefined') return CLOSED;
  const params = new URLSearchParams(window.location.search);
  if (!params.has(PARAM)) return CLOSED;
  const value = params.get(PARAM);
  return { open: true, section: isSection(value) ? value : 'configs' };
}

/** The current location with the parameter set to `section`, or removed. Everything else stays. */
function urlWith(section: AdminSection | null): string {
  const url = new URL(window.location.href);
  if (section) url.searchParams.set(PARAM, section);
  else url.searchParams.delete(PARAM);
  return url.pathname + url.search + url.hash;
}

/** Whether the current history entry was pushed by this dialog. */
function dialogPushedEntry(): boolean {
  return Boolean((window.history.state as Record<string, unknown> | null)?.[MARKER]);
}

let state: State = readUrl();
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  // Back, forward and manual edits of the history: the URL is the truth.
  window.addEventListener('popstate', () => set(readUrl()));
}

/** Opens the dialog on `section` (default: the first). Pushes a history entry, unless it is already open. */
export function openAdminDialog(section: AdminSection = 'configs') {
  if (state.open) {
    setAdminDialogSection(section);
    return;
  }
  window.history.pushState({ ...(window.history.state as object | null), [MARKER]: true }, '', urlWith(section));
  set({ open: true, section });
}

export function setAdminDialogOpen(open: boolean) {
  if (open) {
    openAdminDialog(state.section);
    return;
  }
  if (!state.open) return;
  if (dialogPushedEntry()) {
    // Leave the entry the dialog pushed; `popstate` then reads the URL again. The store closes at
    // once, so the dialog does not wait for the browser.
    set({ ...state, open: false });
    window.history.back();
  } else {
    window.history.replaceState(window.history.state, '', urlWith(null));
    set({ ...state, open: false });
  }
}

/** Switches the open dialog to `section`. Replaces the URL: it is not a step of its own. */
export function setAdminDialogSection(section: AdminSection) {
  if (state.open && state.section !== section) {
    window.history.replaceState(window.history.state, '', urlWith(section));
  }
  set({ ...state, section });
}

/** For a user who may not open the dialog: ignore `?admin` and take it off the URL, keeping the history as it is. */
export function stripAdminDialog() {
  if (!state.open) return;
  window.history.replaceState(window.history.state, '', urlWith(null));
  set({ ...state, open: false });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAdminDialog(): State {
  return useSyncExternalStore(subscribe, () => state);
}
