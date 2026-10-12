import type { MobileTab } from '../components/MobileTabBar';

/**
 * Which mobile tab is displayed. 'history' and 'files' render their own
 * panel; everything else is the chat — since 22.09.2026 the KB has exactly
 * one main-area view (`KbViewType = 'chat'`), so the former re-derivation
 * from `kbView` ('chat' vs 'workspace') has nothing left to decide.
 *
 * Shared by `KbWorkspaceLayout` and `useViewState` so the two cannot drift.
 */
export function deriveActiveMobileTab(mobileTab: MobileTab): MobileTab {
    if (mobileTab === 'history' || mobileTab === 'files') return mobileTab;
    return 'chat';
}
