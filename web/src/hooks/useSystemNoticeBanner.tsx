import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Stack } from '@ki4jlu/design-system';
import { useAuth } from '../contexts/AuthContext';
import { useAppUpdate } from '../contexts/AppUpdateContext';
import { AppUpdateAlert, SystemNoticeAlert } from '../components/shell/SystemNotice';
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

/**
 * When this browser first showed each notice version — its creation time on
 * the card. The notice carries no time of its own; remembered, so a reload
 * does not move it, and kept per version, so a notice that comes back keeps
 * its first time. `{ [version]: epoch ms }`, the newest few.
 */
export const SYSTEM_NOTICE_SEEN_KEY = `${STORAGE_NAMESPACE}chrome.systemNotice.seen`;
const SEEN_KEEP = 10;
type SeenTimes = Record<string, number>;

/** Only times a `Date` can hold: anything else is dropped. */
const validTime = (at: unknown): at is number =>
  typeof at === 'number' && !Number.isNaN(new Date(at).getTime());

function readSeen(): SeenTimes {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(SYSTEM_NOTICE_SEEN_KEY) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, at]) => validTime(at)));
  } catch {
    return {};
  }
}

// This page's first sightings, over the stored ones: the same time on every
// render, from the first one on, without a second commit to fill it in.
let sightings: SeenTimes | null = null;

function firstSight(version: string): number {
  sightings ??= readSeen();
  sightings[version] ??= Date.now();
  return sightings[version];
}

function writeSeen(): void {
  if (!sightings) return;
  // Merged with what other tabs stored meanwhile, the earliest time per
  // version winning, so one tab does not overwrite another's.
  const merged: SeenTimes = { ...readSeen() };
  for (const [version, at] of Object.entries(sightings)) {
    merged[version] = Math.min(at, merged[version] ?? at);
  }
  sightings = Object.fromEntries(
    Object.entries(merged).sort(([, a], [, b]) => b - a).slice(0, SEEN_KEEP),
  );
  try {
    window.localStorage.setItem(SYSTEM_NOTICE_SEEN_KEY, JSON.stringify(sightings));
  } catch {
    // Not remembered: the next page load shows its own time.
  }
}

/** What the shell hangs into its slots; each null when there is nothing for it. */
export interface SystemNoticeSlots {
  /** `AppShell` `notice`: the full-width banner. */
  notice: ReactNode;
  /** `AppShell` `status`: the floating message, at `statusPosition`. */
  status: ReactNode;
  /**
   * `AppShell` `statusPosition`: top centre (`inline`), or top right in the
   * toast pile (`toast`, and the update card).
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
  // The version on screen, if any: only a notice that is shown is "seen".
  const shown = notice && !(notice.dismissible && dismissed === notice.version) ? notice.version : undefined;
  const seenAt = shown ? new Date(firstSight(shown)) : undefined;
  // Stored once it is on screen.
  useEffect(() => {
    if (shown) writeSeen();
  }, [shown]);

  const update = useAppUpdate();
  const updateCard = update.available ? (
    <AppUpdateAlert onApply={update.apply} time={update.since ?? undefined} />
  ) : null;

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
      notice: <SystemNoticeAlert notice={notice} onDismiss={onDismiss} time={seenAt} />,
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
          <SystemNoticeAlert notice={{ ...notice, placement: 'toast' }} onDismiss={onDismiss} time={seenAt} />
        </Stack>
      ),
      statusPosition: 'top-end',
    };
  }
  return {
    notice: null,
    status: <SystemNoticeAlert notice={notice} onDismiss={onDismiss} time={seenAt} />,
    // A toast joins the toast stack, top right, as the update card does.
    statusPosition: notice.placement === 'toast' ? 'top-end' : 'top',
  };
}
