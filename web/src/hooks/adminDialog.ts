import { createUrlDialog } from '../routing/urlDialog';

/*
 * Open state of the admin settings dialog (`AdminUI`), shared by the one component that renders
 * it (`AppUserMenu`, mounted once per page) and the controls that open it (the user menu's
 * „Admin-Einstellungen" item, the ⌘K account group).
 *
 * BACKED BY THE URL: `?admin=<section>` on any page opens the dialog over whatever view is
 * showing; a bare `?admin` means the first section. Opening pushes, switching sections replaces,
 * closing goes back (or replaces, for a link that carried the parameter) — the rules live in
 * `routing/urlDialog.ts`, shared with the user and topic settings. THIS FILE IS THE ONLY PLACE
 * THAT NAMES THE PARAMETER; callers use the functions below and `useAdminDialog`.
 *
 * Rights are the caller's: the store knows no user. `stripAdminDialog` is for a user who may not
 * open it (the parameter is ignored and removed); a section a user may not see falls back to the
 * first one in `AdminUI`.
 */

/** The sections, in the order of the dialog's nav. The first is what a bare `?admin` opens. */
export const ADMIN_SECTIONS = [
  'configs', 'auth', 'search', 'agent', 'site', 'kb-overview', 'global-kbs', 'users', 'roles', 'health', 'eval',
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

const dialog = createUrlDialog<AdminSection>('admin', ADMIN_SECTIONS);

export const openAdminDialog = (section?: AdminSection) => dialog.open(section);
export const setAdminDialogOpen = dialog.setOpen;
export const setAdminDialogSection = dialog.setValue;
export const stripAdminDialog = dialog.strip;

export function useAdminDialog(): { open: boolean; section: AdminSection } {
  const { open, value } = dialog.useDialogState();
  return { open, section: value };
}
