import { useSyncExternalStore } from 'react';

/*
 * Whether the search palette is open. Outside React because the control that
 * opens it (a row deep in the sidebar) and the dialog itself (mounted by the
 * view's shell) share no parent short of the app root, and the state is one
 * boolean with no data to carry.
 */
let open = false;
const listeners = new Set<() => void>();

/** What had focus when the palette opened: the sidebar row, or wherever ⌘K was pressed. */
let opener: HTMLElement | null = null;

/**
 * Gives focus back to what opened the palette, if it is still on the page (a
 * hit that changed the view took it away). The dialog cannot do this itself:
 * it is opened from state, not from a trigger element it knows.
 */
export function restoreSearchPaletteFocus(): void {
  if (opener?.isConnected) opener.focus();
  opener = null;
}

export function setSearchPaletteOpen(next: boolean): void {
  if (next === open) return;
  if (next) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  open = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
};

export function useSearchPaletteOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
