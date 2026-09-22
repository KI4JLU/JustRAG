import { useState, useCallback, useMemo } from 'react';
import { type MobileTab } from '../components/MobileTabBar';
import { useSwipeGesture } from './useSwipeGesture';
import { deriveActiveMobileTab } from '../utils/activeMobileTab';

/* The four content views of the app shell, then the rest.
 *
 * RENAMED 18.09.2026: 'home' -> 'my-topics', 'shared-kbs' -> 'shared-topics',
 * and 'discover' / 'tools' are new. „Home" named a SCREEN, but the screen is
 * `AppChrome` — the shell every one of these mounts. These name the CONTENT of
 * its main area, which is what actually differs between them.
 *
 * There is no router here: a view is a member of this union, a render branch in
 * AuthenticatedApp, and a nav row wired through AppNavContext. The URL does not
 * change and no history entry is pushed — the existing architecture. */
type ViewType = 'my-topics' | 'shared-topics' | 'discover' | 'tools' | 'kb' | 'admin' | 'profile' | 'global-kb-settings' | 'kb-settings' | 'terms' | 'privacy' | 'accessibility' | 'agents';
/* NUR 'chat' (Entwickler, 22.09.2026): die KB-Ansicht ist der Chat. Die
 * früheren Werte 'dashboard' | 'research' | 'academic_research' |
 * 'workspace' | 'mindmap' sind absichtlich aus dem Typ gestrichen — die
 * Komponenten dahinter (Dashboard, ResearchMode, AcademicMode,
 * StudioWorkspace, MindMapView) bleiben im Repo und werden später als Tools
 * angebunden, dürfen bis dahin aber von nirgends erreichbar sein. Der Typ
 * ist die Sperre: ein `setKbView('workspace')` kompiliert nicht mehr. */
type KbViewType = 'chat';

interface UseViewStateParams {
  setView: React.Dispatch<React.SetStateAction<ViewType>>;
  setKbView: React.Dispatch<React.SetStateAction<KbViewType>>;
  setShowSettings: (val: boolean) => void;
}

export type { ViewType, KbViewType };

export function useViewState({ setView, setKbView, setShowSettings }: UseViewStateParams) {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  const TAB_ORDER: MobileTab[] = useMemo(() => ['history', 'chat', 'files'], []);

  // Der Reiter „chat" setzt kbView explizit zurück; ein anderer Wert als
  // 'chat' existiert seit dem 22.09.2026 nicht mehr (siehe KbViewType).
  const applyTab = useCallback((tab: MobileTab) => {
    if (tab === 'chat') setKbView('chat');
    setMobileTab(tab);
  }, [setKbView]);

  // Derselbe Ableitungsweg wie in KbWorkspaceLayout, damit Swipe-Start und
  // gerenderter Reiter nicht auseinanderlaufen.
  const activeTab = deriveActiveMobileTab(mobileTab);

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
    setView('my-topics');
  }, [setShowSettings, setKbView, setView]);

  const handleViewHome = useCallback(() => setView('my-topics'), [setView]);

  return {
    mobileTab, setMobileTab,
    swipeHandlers,
    handleGoHome,
    handleViewHome,
  };
}
