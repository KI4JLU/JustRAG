import { createContext, useContext } from 'react';

/**
 * True once the AI-use notice no longer stands in the way: its state is
 * known and nothing is left to accept (or the page is exempt). Dialogs that
 * open on their own after sign-in (the join dialog) wait for it, so two
 * modals never stack. Provided by PolicyAcceptanceGate; outside it, true.
 */
export const PolicyClearedContext = createContext(true);

export function usePolicyCleared(): boolean {
    return useContext(PolicyClearedContext);
}
