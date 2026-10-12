import { createContext, useContext, type ReactNode } from 'react';
import type { useSharing } from '../hooks/useSharing';

/**
 * The KB sharing concern — the members dialog and the username-copy
 * affordance — published as one context instead of sixteen props.
 *
 * WHY THE WHOLE HOOK RETURN IS THE VALUE. `KbDataContext` already carries
 * `sharing: ReturnType<typeof useSharing>` for the KB workspace half of the
 * app, so this type is the established shape for this concern and not a new
 * one; what this file adds is a mount point on the OTHER half, the KB
 * overview, which sits outside every `Kb*Provider`. Narrowing the value here
 * would have made the two halves disagree about what "the sharing state" is.
 *
 * THE COUPLING THIS CONTEXT MUST NOT LOSE (card KI-770, finding from KI-774).
 * `handleOpenShare` calls `e.stopPropagation()` (hooks/useSharing.ts:27) and
 * has to: the share button sits inside a KB card whose own `onClick` opens the
 * KB. `HomeView` does not stop that propagation itself — it hands the event
 * straight to whatever `handleOpenShare` this context supplies. A value built
 * from anything other than the real hook therefore has to reproduce that line,
 * or clicking "share" silently opens the KB as well. Pinned by the
 * `SharingDoesNotAlsoOpenTheKb` story.
 */
export type SharingContextValue = ReturnType<typeof useSharing>;

const SharingContext = createContext<SharingContextValue | null>(null);

export function SharingProvider({ value, children }: { value: SharingContextValue; children: ReactNode }) {
  return <SharingContext.Provider value={value}>{children}</SharingContext.Provider>;
}

export function useSharingContext(): SharingContextValue {
  const ctx = useContext(SharingContext);
  if (!ctx) throw new Error('useSharingContext must be used within SharingProvider');
  return ctx;
}
