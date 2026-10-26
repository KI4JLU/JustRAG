import type { RefObject } from 'react';
import { useBlocker, useRouter } from '@tanstack/react-router';

interface LeaveGuardProps {
  /** Unsaved changes: leave only after `confirm`. */
  when: boolean;
  /** Set by the caller's own confirmed close, so its navigation is not asked about twice. */
  allow: RefObject<boolean>;
  /** Asks whether to discard; resolves true to leave. */
  confirm: () => Promise<boolean>;
}

/**
 * Asks before the browser's back/forward leaves a dialog with unsaved changes.
 * A dialog that lives in the URL (`?topic=`) closes on back like a page, and
 * without this its drafts would go without the discard prompt every other way
 * of closing it shows. In-app navigations (push/replace) are the app's own
 * decisions and pass. Renders nothing; outside a router (component tests) it
 * is inert.
 */
export function LeaveGuard(props: LeaveGuardProps) {
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | undefined;
  return router ? <RouterLeaveGuard {...props} /> : null;
}

function RouterLeaveGuard({ when, allow, confirm }: LeaveGuardProps) {
  useBlocker({
    shouldBlockFn: async ({ action }) => {
      if (!when || allow.current) return false;
      if (action !== 'BACK' && action !== 'FORWARD' && action !== 'GO') return false;
      return !(await confirm());
    },
    enableBeforeUnload: false,
  });
  return null;
}
