import { createContext, useContext, type ReactNode } from 'react';
import type { useChat } from '../hooks/useChat';

export interface KbChatContextValue {
  chat: ReturnType<typeof useChat>;
  enhance: 'rewrite' | 'expand' | 'spell' | null;
  setEnhance: (val: 'rewrite' | 'expand' | 'spell' | null) => void;
  reasoningEnabled: boolean;
  setReasoningEnabled: (val: boolean) => void;
  webSearchEnabled: boolean;
  setWebSearchEnabled: (val: boolean) => void;
  reasoningLevel: 'low' | 'medium' | 'high';
  setReasoningLevel: (val: 'low' | 'medium' | 'high') => void;
}

const KbChatContext = createContext<KbChatContextValue | null>(null);

export function KbChatProvider({ value, children }: { value: KbChatContextValue; children: ReactNode }) {
  return <KbChatContext.Provider value={value}>{children}</KbChatContext.Provider>;
}

export function useKbChat(): KbChatContextValue {
  const ctx = useContext(KbChatContext);
  if (!ctx) throw new Error('useKbChat must be used within KbChatProvider');
  return ctx;
}
