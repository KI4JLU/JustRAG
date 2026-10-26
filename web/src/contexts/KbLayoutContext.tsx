import { createContext, useContext, type ReactNode } from 'react';
import type { useSidebarResize } from '../hooks/useSidebarResize';
import type { KbSettingsSection } from '../types';

export interface KbLayoutContextValue {
  sidebar: ReturnType<typeof useSidebarResize>;
  /** The Thema-Einstellungen dialog: opened from the chrome bar
   *  (KbWorkspaceLayout), rendered by ChatView — hence shared here. Open while
   *  the topic's URL carries `?topic=` (useTopicSettings). */
  systemPromptOpen: boolean;
  setSystemPromptOpen: (open: boolean) => void;
  /** Its open section — `?topic=<section>` in the URL: Verhalten from the gear, Mitglieder from „Teilen". */
  systemPromptSection: KbSettingsSection;
  setSystemPromptSection: (section: KbSettingsSection) => void;
}

const KbLayoutContext = createContext<KbLayoutContextValue | null>(null);

export function KbLayoutProvider({ value, children }: { value: KbLayoutContextValue; children: ReactNode }) {
  return <KbLayoutContext.Provider value={value}>{children}</KbLayoutContext.Provider>;
}

export function useKbLayout(): KbLayoutContextValue {
  const ctx = useContext(KbLayoutContext);
  if (!ctx) throw new Error('useKbLayout must be used within KbLayoutProvider');
  return ctx;
}
