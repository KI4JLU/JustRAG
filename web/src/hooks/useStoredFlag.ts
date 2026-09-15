import { useCallback, useState } from 'react';

/* ---------------------------------------------------------------------------
 * The app's ONE convention for remembering a boolean UI preference.
 *
 * WHY THIS FILE EXISTS (card KI-789). The mechanism below was written by
 * Stage 7b for `useSectionOpen` — same `'1'`/`'0'` values, same swallowed
 * storage errors, same "read once per mount" initialiser. KI-789 needed a
 * second remembered toggle (the sidebar's collapsed width), and a second
 * hand-rolled `localStorage.getItem` next to the first would have been a
 * second truth about how this app persists a preference: two places to fix
 * when Safari private mode changes, two key conventions, two fallback
 * behaviours.
 *
 * So the mechanism moved here UNCHANGED and `useSectionOpen` became its first
 * caller. Its storage key, its stored values and its observable behaviour are
 * byte-for-byte what they were — no user loses a remembered section state, and
 * the migration is a pure extraction.
 *
 * KEY NAMESPACE. Callers pass the FULL key and every key starts `justrag.`:
 *   - `justrag.home.section.<id>`      — `useSectionOpen` (Stage 7b, unchanged)
 *   - `justrag.chrome.sidebar.collapsed` — `useSidebarCollapse` (KI-789)
 * The prefix is assembled by the calling hook rather than here, because a key
 * is part of that hook's contract with the browser — a shared hook that minted
 * keys would make every caller's storage key a detail of THIS file.
 *
 * WHY localStorage ACCESS IS WRAPPED. It throws outright in Safari's private
 * mode and under a blocked-cookies policy. A storage failure must cost the
 * user a remembered preference, never the view. (Carried over verbatim from
 * `useSectionOpen.readStored`, itself carried over from the deleted
 * `KbAccordion.readStored`; the comment is the reason, not decoration.)
 * ------------------------------------------------------------------------- */

/** Every key this app persists a UI preference under starts with this. */
export const STORAGE_NAMESPACE = 'justrag.';

function readStored(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // See readStored: a preference that cannot be persisted is not an error.
  }
}

/**
 * A boolean that survives a reload.
 *
 * @param key      the FULL localStorage key, `justrag.`-prefixed by the caller.
 * @param fallback the value before the user has ever set one.
 * @returns `[value, setValue]` — `setValue` writes through, then re-renders.
 */
export function useStoredFlag(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  // The initialiser runs once per mount, which is what makes a remount pick up
  // the stored value — the property `HomeView.test.tsx` pins across an unmount.
  const [value, setValue] = useState(() => readStored(key, fallback));

  const set = useCallback((next: boolean) => {
    writeStored(key, next);
    setValue(next);
  }, [key]);

  return [value, set];
}
