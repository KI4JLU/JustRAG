import { useSyncExternalStore } from 'react';

/*
 * Which synced source's details dialog is open (RSS feed, Confluence space,
 * git repository), shared by the dialog's one renderer (`SourcesPanel`) and
 * the rows that open it. A module store like `settingsDialog`, so an opener
 * need not be a child of the renderer. It holds the kind and the id only; the
 * renderer looks the source up
 * in the live lists, so the dialog follows a sync that lands while it is open.
 */
export type SourceDetailsRef = { kind: 'rss' | 'confluence' | 'git'; id: string };

let state: SourceDetailsRef | null = null;
const listeners = new Set<() => void>();

function set(next: SourceDetailsRef | null) {
  state = next;
  listeners.forEach((l) => l());
}

export function openSourceDetails(ref: SourceDetailsRef) {
  set(ref);
}

export function closeSourceDetails() {
  set(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSourceDetails(): SourceDetailsRef | null {
  return useSyncExternalStore(subscribe, () => state);
}
