import { useState, useCallback, useMemo } from 'react';
import { type MobileTab } from '../components/MobileTabBar';
import { useSwipeGesture } from './useSwipeGesture';
import { deriveActiveMobileTab } from '../utils/activeMobileTab';
import type { AppNavigate } from '../routing/navigation';

/* NUR 'chat' (Entwickler, 22.09.2026): die KB-Ansicht ist der Chat. Die
 * früheren Werte 'dashboard' | 'research' | 'academic_research' |
 * 'workspace' | 'mindmap' sind absichtlich aus dem Typ gestrichen — die
 * Komponenten dahinter (Dashboard, ResearchMode, AcademicMode,
 * StudioWorkspace, MindMapView) bleiben im Repo und werden später als Tools
 * angebunden, dürfen bis dahin aber von nirgends erreichbar sein. Der Typ
 * ist die Sperre: ein `setKbView('workspace')` kompiliert nicht mehr. */
type KbViewType = 'chat';

interface UseViewStateParams {
  /** Router navigation by view (routing/navigation.ts). */
  navigateTo: AppNavigate;
  setKbView: React.Dispatch<React.SetStateAction<KbViewType>>;
  setShowSettings: (val: boolean) => void;
  /**
   * Whether the 'files' tab exists (capabilities.seeSources). Without it the
   * swipe order is history ↔ chat, the same tabs KbWorkspaceLayout renders,
   * so a swipe never lands on a tab that is not there. Default true.
   */
  showFilesTab?: boolean;
}

export type { KbViewType };

export function useViewState({ navigateTo, setKbView, setShowSettings, showFilesTab = true }: UseViewStateParams) {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  const TAB_ORDER: MobileTab[] = useMemo(
    () => (showFilesTab ? ['history', 'chat', 'files'] : ['history', 'chat']),
    [showFilesTab],
  );

  // Der Reiter „chat" setzt kbView explizit zurück; ein anderer Wert als
  // 'chat' existiert seit dem 22.09.2026 nicht mehr (siehe KbViewType).
  const applyTab = useCallback((tab: MobileTab) => {
    if (tab === 'chat') setKbView('chat');
    setMobileTab(tab);
  }, [setKbView]);

  // Derselbe Ableitungsweg wie in KbWorkspaceLayout, damit Swipe-Start und
  // gerenderter Reiter nicht auseinanderlaufen ('files' ohne Reiter ist der
  // Chat, wie dort).
  const derivedTab = deriveActiveMobileTab(mobileTab);
  const activeTab: MobileTab = !showFilesTab && derivedTab === 'files' ? 'chat' : derivedTab;

  const swipeLeft = useCallback(() => {
    const i = TAB_ORDER.indexOf(activeTab);
    const next = i < TAB_ORDER.length - 1 ? TAB_ORDER[i + 1] : activeTab;
    if (next !== activeTab) applyTab(next);
  }, [TAB_ORDER, activeTab, applyTab]);
  const swipeRight = useCallback(() => {
    const i = TAB_ORDER.indexOf(activeTab);
    const next = i > 0 ? TAB_ORDER[i - 1] : activeTab;
    if (next !== activeTab) applyTab(next);
  }, [TAB_ORDER, activeTab, applyTab]);
  const swipeHandlers = useSwipeGesture(swipeLeft, swipeRight);

  const handleGoHome = useCallback(() => {
    setShowSettings(false);
    setKbView('chat');
    navigateTo({ view: 'my-topics' });
  }, [setShowSettings, setKbView, navigateTo]);

  const handleViewHome = useCallback(() => navigateTo({ view: 'my-topics' }), [navigateTo]);

  return {
    mobileTab, setMobileTab,
    swipeHandlers,
    handleGoHome,
    handleViewHome,
  };
}
