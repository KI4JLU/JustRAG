import { useMemo, useState, type ReactNode } from 'react';
import { Stack } from '@ki4jlu/design-system';
import { useAuth } from '../contexts/AuthContext';
import { useAppUpdate } from '../contexts/AppUpdateContext';
import { AppUpdateAlert, NoticeHeight, SystemNoticeAlert } from '../components/shell/SystemNotice';
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
  /**
   * `AppShell` `statusPosition`: top centre (`inline`), bottom right (`toast`)
   * or, while the update card is shown, top right.
   */
  statusPosition: 'top' | 'top-end' | 'bottom-end';
}

const NONE: SystemNoticeSlots = { notice: null, status: null, statusPosition: 'top' };

/**
 * The shell's `notice` and `status` slot content: the admin's system notice
 * in the slot its placement names, and, while a newer build is waiting, the
 * update card in the top corner of the `status` slot. The shell has one
 * floating position, so a floating system notice joins the card there, under
 * it, for as long as the card is shown. Null
 * rather than an empty component, because the design system renders a slot
 * for any truthy node.
 *
 * @param returnFocusTo where focus goes after the close button, which leaves
 * the page with the alert, has been pressed.
 */
export function useSystemNoticeBanner(returnFocusTo?: () => HTMLElement | null): SystemNoticeSlots {
  const { siteConfigs } = useAuth();
  const notice = useMemo(() => readSystemNotice(siteConfigs), [siteConfigs]);
  const [dismissed, setDismissed] = useState(readDismissed);

  const update = useAppUpdate();
  const updateCard = update.available ? <AppUpdateAlert onApply={update.apply} /> : null;

  if (!notice || (notice.dismissible && dismissed === notice.version)) {
    return updateCard ? { notice: null, status: updateCard, statusPosition: 'top-end' } : NONE;
  }

  const onDismiss = notice.dismissible
    ? () => {
        writeDismissed(notice.version);
        setDismissed(notice.version);
        requestAnimationFrame(() => returnFocusTo?.()?.focus({ preventScroll: true }));
      }
    : undefined;
  if (notice.placement === 'banner') {
    return {
      // The banner pushes the chrome down; the toasts follow it (NoticeHeight).
      notice: <NoticeHeight><SystemNoticeAlert notice={notice} onDismiss={onDismiss} /></NoticeHeight>,
      status: updateCard,
      statusPosition: updateCard ? 'top-end' : 'top',
    };
  }
  if (updateCard) {
    return {
      notice: null,
      status: (
        <Stack direction="column" gap="sm">
          {updateCard}
          <SystemNoticeAlert notice={{ ...notice, placement: 'toast' }} onDismiss={onDismiss} />
        </Stack>
      ),
      statusPosition: 'top-end',
    };
  }
  return {
    notice: null,
    status: <SystemNoticeAlert notice={notice} onDismiss={onDismiss} />,
    statusPosition: notice.placement === 'toast' ? 'bottom-end' : 'top',
  };
}
