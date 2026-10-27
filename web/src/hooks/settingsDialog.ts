import { createUrlDialog } from '../routing/urlDialog';
import type { SettingsTab } from '../components/UserSettingsModal';

/*
 * Open state of the user settings dialog (`UserSettingsModal`), shared by the
 * one component that renders it (`AppUserMenu`, mounted once per page) and any
 * control elsewhere that opens it — today the search field's default list
 * (⌘K → „Einstellungen").
 *
 * BACKED BY THE URL: `?settings=<tab>` on any page, with the push/replace/back
 * rules of `routing/urlDialog.ts` (shared with the admin console). A bare
 * `?settings` opens the first tab.
 */
const SETTINGS_TABS = ['general', 'chat', 'profile', 'connectors'] as const satisfies readonly SettingsTab[];

const dialog = createUrlDialog<SettingsTab>('settings', SETTINGS_TABS);

export const openSettingsDialog = (tab?: SettingsTab) => dialog.open(tab);
export const setSettingsDialogOpen = dialog.setOpen;
export const setSettingsDialogTab = dialog.setValue;

export function useSettingsDialog(): { open: boolean; tab: SettingsTab } {
  const { open, value } = dialog.useDialogState();
  return { open, tab: value };
}
