import { useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { NoticeHeight, SystemNoticeAlert } from '../components/SystemNotice';
import { readSystemNotice } from '../utils/systemNotice';
import { STORAGE_NAMESPACE } from './useStoredFlag';

/** Version of the last notice this browser dismissed. One value: there is one notice. */
export const SYSTEM_NOTICE_DISMISSED_KEY = `${STORAGE_NAMESPACE}chrome.systemNotice.dismissed`;

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(SYSTEM_NOTICE_DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string): void {
  try {
    window.localStorage.setItem(SYSTEM_NOTICE_DISMISSED_KEY, version);
  } catch {
    // Not remembered: the notice comes back on the next page load.
  }
}

/** What the shell hangs into its slots; each null when there is nothing for it. */
export interface SystemNoticeSlots {
  /** `AppShell` `notice`: the full-width banner. */
  notice: ReactNode;
  /** `AppShell` `status`: the floating message, at `statusPosition`. */
  status: ReactNode;
  /** `AppShell` `statusPosition`: top centre (`inline`) or bottom right (`toast`). */
  statusPosition: 'top' | 'bottom-end';
}

const NONE: SystemNoticeSlots = { notice: null, status: null, statusPosition: 'top' };

/**
 * The shell's `notice` and `status` slot content — at most one of them set,
 * by the notice's placement. Null rather than an empty component, because the
 * design system renders a slot for any truthy node.
 *
 * @param returnFocusTo where focus goes after the close button, which leaves
 * the page with the alert, has been pressed.
 */
export function useSystemNoticeBanner(returnFocusTo?: () => HTMLElement | null): SystemNoticeSlots {
  const { siteConfigs } = useAuth();
  const notice = useMemo(() => readSystemNotice(siteConfigs), [siteConfigs]);
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!notice) return NONE;
  if (notice.dismissible && dismissed === notice.version) return NONE;

  const onDismiss = notice.dismissible
    ? () => {
        writeDismissed(notice.version);
        setDismissed(notice.version);
        requestAnimationFrame(() => returnFocusTo?.()?.focus({ preventScroll: true }));
      }
    : undefined;
  const alert = <SystemNoticeAlert notice={notice} onDismiss={onDismiss} />;
  if (notice.placement === 'banner') {
    // The banner pushes the chrome down; the toasts follow it (NoticeHeight).
    return { notice: <NoticeHeight>{alert}</NoticeHeight>, status: null, statusPosition: 'top' };
  }
  return { notice: null, status: alert, statusPosition: notice.placement === 'toast' ? 'bottom-end' : 'top' };
}
