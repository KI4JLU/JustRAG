import { useCallback, useState } from 'react';

/**
 * Per-section open/closed state for the KB overview's collapsible sections.
 *
 * This is the persistence half of the deleted `KbAccordion` (card KI-776).
 * `SectionedGridLayout` takes `isOpen` / `onOpenChange` as CONTROLLED props and
 * deliberately has no `defaultOpen` — "a template that remembers anything would
 * be a second truth next to the app's" (its own doc block). So the remembering
 * moved here, byte-for-byte: same storage prefix, same values, same fallback
 * behaviour, so no user loses a section state across the migration.
 *
 * localStorage access is wrapped because it throws outright in Safari's private
 * mode and under a blocked-cookies policy — a storage failure must cost the
 * user a remembered preference, never the whole overview. (Carried over from
 * `KbAccordion.readStored`; the comment is the reason, not decoration.)
 */
const STORAGE_PREFIX = 'justrag.home.section.';

function readStored(id: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function writeStored(id: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, open ? '1' : '0');
  } catch {
    // See readStored: a preference that cannot be persisted is not an error.
  }
}

export interface SectionOpenState {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * @param id          stable section id — also the localStorage key suffix.
 * @param defaultOpen open state on first visit, before the user ever toggled it.
 */
export function useSectionOpen(id: string, defaultOpen: boolean): SectionOpenState {
  // The initialiser runs once per mount, which is what makes a remount pick up
  // the stored value — the property `HomeView.test.tsx` pins across an unmount.
  const [isOpen, setIsOpen] = useState(() => readStored(id, defaultOpen));

  const onOpenChange = useCallback((next: boolean) => {
    writeStored(id, next);
    setIsOpen(next);
  }, [id]);

  return { isOpen, onOpenChange };
}
