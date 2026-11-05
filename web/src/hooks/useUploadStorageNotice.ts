import { useCallback, useSyncExternalStore } from 'react';
import { STORAGE_NAMESPACE, useSharedStoredFlag } from './useStoredFlag';

/**
 * Chat attachments and sources are kept differently (see the notice texts),
 * so each kind has its own notice and its own acceptance.
 */
export type UploadKind = 'chat' | 'source';

/**
 * Per user, so a second account on the same browser is asked on its own
 * uploads. Per browser too: acceptance is UI state, not a server record, so a
 * new device asks once more.
 */
export const uploadStorageNoticeKey = (userId: string, kind: UploadKind) =>
  `${STORAGE_NAMESPACE}chrome.uploadStorageNotice.${userId}.${kind}.accepted`;

// Uploads waiting on a notice, oldest first; the dialog shows the first.
// Kept in memory on purpose: a notice left unanswered asks again on the next
// upload, never on its own at a login.
interface Ask { userId: string; kind: UploadKind; resolve: (ok: boolean) => void }
let queue: readonly Ask[] = [];
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const head = () => queue[0] ?? null;
const setQueue = (next: readonly Ask[]) => {
  queue = next;
  listeners.forEach((fn) => fn());
};
// Answers every upload waiting on the same notice: they were asked together.
const answer = (userId: string, kind: UploadKind, ok: boolean) => {
  const settled = queue.filter((a) => a.userId === userId && a.kind === kind);
  if (settled.length === 0) return;
  setQueue(queue.filter((a) => !settled.includes(a)));
  settled.forEach((a) => a.resolve(ok));
};

/**
 * For an upload: `confirm` resolves true once the user has accepted the
 * notice for this kind (at once when they already have) and false when they
 * close it otherwise; the caller then drops the files.
 */
export function useUploadStorageNotice(userId: string, kind: UploadKind) {
  const [accepted] = useSharedStoredFlag(uploadStorageNoticeKey(userId, kind), false);
  const confirm = useCallback((): Promise<boolean> => {
    if (accepted) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setQueue([...queue, { userId, kind, resolve }]));
  }, [accepted, userId, kind]);
  return { accepted, confirm };
}

/** For the dialog: the notice to show now, and its answers. */
export function useUploadStorageNoticeDialog(userId: string) {
  const [, acceptChat] = useSharedStoredFlag(uploadStorageNoticeKey(userId, 'chat'), false);
  const [, acceptSource] = useSharedStoredFlag(uploadStorageNoticeKey(userId, 'source'), false);
  const ask = useSyncExternalStore(subscribe, head);
  const kind = ask && ask.userId === userId ? ask.kind : null;

  const accept = useCallback(() => {
    if (!kind) return;
    (kind === 'chat' ? acceptChat : acceptSource)(true);
    answer(userId, kind, true);
  }, [kind, userId, acceptChat, acceptSource]);
  const decline = useCallback(() => {
    if (kind) answer(userId, kind, false);
  }, [kind, userId]);
  // Every waiting upload is dropped, whoever it was for (the dialog unmounts at logout).
  const dropAll = useCallback(() => {
    const dropped = queue;
    setQueue([]);
    dropped.forEach((a) => a.resolve(false));
  }, []);

  return { kind, accept, decline, dropAll };
}
