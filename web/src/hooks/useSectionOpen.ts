import { STORAGE_NAMESPACE, useStoredFlag } from './useStoredFlag';

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
 * KI-789 EXTRACTED THE MECHANISM, NOT THE BEHAVIOUR. The `localStorage`
 * read/write pair (and the reason it is wrapped in try/catch) now lives in
 * `useStoredFlag.ts`, so the sidebar's collapsed state could reuse it instead
 * of hand-rolling a second one. The key, the stored `'1'`/`'0'` values and the
 * read-once-per-mount semantics are unchanged.
 */
const STORAGE_PREFIX = `${STORAGE_NAMESPACE}home.section.`;

export interface SectionOpenState {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * @param id          stable section id — also the localStorage key suffix.
 * @param defaultOpen open state on first visit, before the user ever toggled it.
 */
export function useSectionOpen(id: string, defaultOpen: boolean): SectionOpenState {
  const [isOpen, onOpenChange] = useStoredFlag(STORAGE_PREFIX + id, defaultOpen);
  return { isOpen, onOpenChange };
}
