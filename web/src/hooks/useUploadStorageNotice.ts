import { useCallback, useSyncExternalStore } from 'react';
import { STORAGE_NAMESPACE, useSharedStoredFlag } from './useStoredFlag';

/**
 * Per user, so a second account on the same browser is asked on its own
 * uploads. Per browser too: acceptance is UI state, not a server record, so a
 * new device asks once more.
 */
export const uploadStorageNoticeKey = (userId: string) => `${STORAGE_NAMESPACE}chrome.uploadStorageNotice.${userId}`;

// The upload waiting on the notice. Kept in memory on purpose: a notice left
// unanswered asks again on the next upload, never on its own at a login.
let pending: { userId: string; answer: Promise<boolean>; resolve: (ok: boolean) => void } | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const settle = (ok: boolean) => {
  if (!pending) return;
  const { resolve } = pending;
  pending = null;
  listeners.forEach((fn) => fn());
  resolve(ok);
};

/**
 * The notice that says how long uploaded documents are kept. It stands before
 * every upload (a chat attachment or a source) until the user accepts it once:
 * `confirm` resolves true on "Verstanden" (or at once when already accepted)
 * and false when the notice is closed otherwise, and the caller then drops the
 * files. Uploads that ask while it is open share its one answer.
 */
export function useUploadStorageNotice(userId: string) {
  const [accepted, setAccepted] = useSharedStoredFlag(`${uploadStorageNoticeKey(userId)}.accepted`, false);
  const asking = useSyncExternalStore(subscribe, () => pending?.userId === userId);

  const confirm = useCallback((): Promise<boolean> => {
    if (accepted) return Promise.resolve(true);
    if (pending?.userId === userId) return pending.answer;
    settle(false);
    let resolve!: (ok: boolean) => void;
    const answer = new Promise<boolean>((r) => { resolve = r; });
    pending = { userId, answer, resolve };
    listeners.forEach((fn) => fn());
    return answer;
  }, [accepted, userId]);
  const decline = useCallback(() => settle(false), []);
  const accept = useCallback(() => {
    setAccepted(true);
    settle(true);
  }, [setAccepted]);

  return { open: asking && !accepted, accepted, confirm, decline, accept };
}
