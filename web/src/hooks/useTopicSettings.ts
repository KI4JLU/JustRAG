import type { KbSettingsSection } from '../types';
import { createUrlDialog } from '../routing/urlDialog';

/**
 * Whether „Thema-Einstellungen" are open, and on which section.
 *
 * BACKED BY THE URL: `?topic=<section>` on a topic's URL (`/kb/<id>`), with
 * the push/replace/back rules of `routing/urlDialog.ts` — the gear pushes it,
 * switching sections replaces it, closing goes back. The parameter belongs to
 * the topic URL it sits on, so a topic change by any route (sidebar, search,
 * a link, back) drops it and the new topic opens in its chat. On a page that
 * is not a topic it is ignored.
 *
 * „Teilen" on a card opens the topic and then its Mitglieder: two history
 * entries, so back closes the settings first and then leaves the topic.
 */
const SECTIONS = ['start', 'behavior', 'roles', 'members', 'versions'] as const satisfies readonly KbSettingsSection[];

const dialog = createUrlDialog<KbSettingsSection>('topic', SECTIONS);

/** Opens the open topic's settings on `section`. Call after navigating to the topic. */
export const openTopicSettings = (section: KbSettingsSection) => dialog.open(section);

export function useTopicSettings(onTopic: boolean) {
  const { open, value } = dialog.useDialogState();
  return {
    open: onTopic && open,
    section: value,
    /** The gear in the workspace header: open on Startseite, or close. */
    setOpen: (next: boolean) => (next ? dialog.open('start') : dialog.setOpen(false)),
    setSection: dialog.setValue,
  };
}
