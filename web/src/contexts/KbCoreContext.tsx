import { createContext, useContext, type ReactNode } from 'react';
import type { KnowledgeBase, SafeAIConfig } from '../types';
import type { useKnowledgeBases } from '../hooks/useKnowledgeBases';

export interface KbCoreContextValue {
  currentKb: KnowledgeBase;
  isPro: boolean;
  availableConfigs: SafeAIConfig[];
  kbMgmt: ReturnType<typeof useKnowledgeBases>;
  handleUpdateKBSettings: (data: Record<string, unknown>) => Promise<boolean>;
}

const KbCoreContext = createContext<KbCoreContextValue | null>(null);

export function KbCoreProvider({ value, children }: { value: KbCoreContextValue; children: ReactNode }) {
  return <KbCoreContext.Provider value={value}>{children}</KbCoreContext.Provider>;
}

export function useKbCore(): KbCoreContextValue {
  const ctx = useContext(KbCoreContext);
  if (!ctx) throw new Error('useKbCore must be used within KbCoreProvider');
  return ctx;
}
