import { useSyncExternalStore } from 'react';
import type { SettingsTab } from '../components/UserSettingsModal';

/*
 * Open state of the user settings dialog (`UserSettingsModal`), shared by the
 * one component that renders it (`AppUserMenu`, mounted once per page) and any
 * control elsewhere that opens it — today the search field's default list
 * (⌘K → „Einstellungen"). A module store rather than a context: the dialog is
 * one per app, and a context would add a required field to every
 * `AppNavContext` fixture for a single boolean.
 */
type State = { open: boolean; tab: SettingsTab };

let state: State = { open: false, tab: 'general' };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function openSettingsDialog(tab: SettingsTab = 'general') {
  set({ open: true, tab });
}

export function setSettingsDialogOpen(open: boolean) {
  set({ ...state, open });
}

export function setSettingsDialogTab(tab: SettingsTab) {
  set({ ...state, tab });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSettingsDialog(): State {
  return useSyncExternalStore(subscribe, () => state);
}
