import { useState, useCallback, useMemo } from 'react';
import { type MobileTab } from '../utils/activeMobileTab';
import { useSwipeGesture } from './useSwipeGesture';

interface UseViewStateParams {
  /**
   * Whether the 'files' tab exists (capabilities.seeSources). Without it the
   * swipe order is history ↔ chat, the same tabs AppFrame renders,
   * so a swipe never lands on a tab that is not there. Default true.
   */
  showFilesTab?: boolean;
}

export function useViewState({ showFilesTab = true }: UseViewStateParams = {}) {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  const TAB_ORDER: MobileTab[] = useMemo(
    () => (showFilesTab ? ['history', 'chat', 'files'] : ['history', 'chat']),
    [showFilesTab],
  );

  // Same rule as AppChrome, so the swipe starts from the tab that is shown:
  // 'files' without a files tab is the chat.
  const activeTab: MobileTab = !showFilesTab && mobileTab === 'files' ? 'chat' : mobileTab;

  const swipeLeft = useCallback(() => {
    const i = TAB_ORDER.indexOf(activeTab);
    const next = i < TAB_ORDER.length - 1 ? TAB_ORDER[i + 1] : activeTab;
    if (next !== activeTab) setMobileTab(next);
  }, [TAB_ORDER, activeTab]);
  const swipeRight = useCallback(() => {
    const i = TAB_ORDER.indexOf(activeTab);
    const next = i > 0 ? TAB_ORDER[i - 1] : activeTab;
    if (next !== activeTab) setMobileTab(next);
  }, [TAB_ORDER, activeTab]);
  const swipeHandlers = useSwipeGesture(swipeLeft, swipeRight);


  return {
    mobileTab, setMobileTab,
    swipeHandlers,
  };
}
