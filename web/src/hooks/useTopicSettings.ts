import { useCallback, useState } from 'react';
import type { KbSettingsSection } from '../types';

/**
 * Whether „Thema-Einstellungen" are open, and on which section.
 *
 * They belong to the topic they were opened for, so the state is a request
 * naming that topic: it shows only while that topic is open, and a topic
 * change by any route (sidebar, search, URL, back) drops it, so the new topic
 * opens in its chat. The one exception is the request that CAUSES the change —
 * „Teilen" on a card opens its topic and asks for Mitglieder in one step, so
 * `openFor` is called before the topic is selected. Dropped during render, not
 * in an effect, so the settings never render for the wrong topic even for one
 * commit.
 */
export function useTopicSettings(currentKbId: string | undefined) {
  const [request, setRequest] = useState<{ kbId: string; section: KbSettingsSection } | null>(null);
  const [seenKbId, setSeenKbId] = useState(currentKbId);
  if (seenKbId !== currentKbId) {
    setSeenKbId(currentKbId);
    if (request && request.kbId !== currentKbId) setRequest(null);
  }

  const open = !!currentKbId && request?.kbId === currentKbId;
  /** The gear in the workspace header: open on Verhalten, or close. */
  const setOpen = useCallback((next: boolean) => {
    setRequest(next && currentKbId ? { kbId: currentKbId, section: 'behavior' } : null);
  }, [currentKbId]);
  /** Ask for `kbId`'s settings on `section`; they show once that topic is open. */
  const openFor = useCallback((kbId: string, section: KbSettingsSection) => {
    setRequest({ kbId, section });
  }, []);

  return { open, section: request?.section ?? 'behavior', setOpen, openFor };
}
