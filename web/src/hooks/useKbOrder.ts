import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { STORAGE_NAMESPACE } from './useStoredFlag';

/* ---------------------------------------------------------------------------
 * The user's own order of the topics, set by dragging them.
 *
 * KEPT WITH THE ACCOUNT, like the favorites, so it follows the user to every
 * browser and device: `GET /api/kb-user-order` returns the order of both
 * views, `PUT /api/kb-user-order/{view}` saves one, whole. View mode and
 * hidden categories stay in the browser — those are per device.
 *
 * ONE LOAD PER SIGN-IN (`session` below): both views read the same
 * response, and an order set since then wins over it, so a view mounted again
 * shows the latest drag rather than the order of the first load. A new
 * sign-in — another user, or the same one again — starts a new session.
 *
 * SAVES go out one at a time per view, and only the newest waiting one is
 * sent: two quick drags can never reach the server in the wrong order. Each
 * save carries the credentials of the sign-in that made it, and a session
 * that ended drops what it still had waiting, so a save can never land in
 * another account. The screen never waits for a save; a failed one shows a
 * toast, and the order stays as dragged.
 *
 * MOVED FROM THE BROWSER ONCE. The order used to be in `localStorage`, one
 * key per view. When the account's orders arrive, both keys are settled at
 * once: a view the account has an order for drops its key, a view it has
 * none for uploads the key's order. Either way the keys are gone after the
 * first sign-in, so on a shared computer they do not pass to the next person.
 * A failed upload keeps the key, marked with its owner, and is tried again
 * when a view mounts; another user who signs in meanwhile drops it instead.
 *
 * WHAT THE ORDER DOES NOT KNOW. Topics created (or shared with the user) after
 * the last drag are not in it; they go FIRST, in the server's order, so a new
 * topic shows up where the user looks rather than at the end of a long grid.
 * Ids of topics that are gone are dropped on the next drag.
 *
 * FAVORITES COME FIRST, as a group of their own: `useTopicFilters`
 * partitions the ordered list stably, so the user's order holds inside each
 * half. Dragging a topic from one group into the other also (un)favorites it.
 * ------------------------------------------------------------------------- */

export type KbOrderView = 'my' | 'shared';

const ORDER_URL = `${API_BASE_URL}/api/kb-user-order`;

/** The browser key the order used to live in; read once, for the upload. */
export const kbOrderKey = (view: KbOrderView) => `${STORAGE_NAMESPACE}topics.order.${view}`;

/**
 * What a browser key holds: the old bare array, which belongs to nobody yet,
 * or `{owner, ids}` once a sign-in claimed it for the upload. The owner keeps
 * a claimed order from passing to the next person on a shared computer.
 */
interface BrowserOrder {
  owner: string | null;
  ids: string[];
}

const onlyStrings = (value: unknown[]) => value.filter((v): v is string => typeof v === 'string');

function readBrowserOrder(view: KbOrderView): BrowserOrder {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(kbOrderKey(view)) ?? '[]');
    if (Array.isArray(parsed)) return { owner: null, ids: onlyStrings(parsed) };
    if (typeof parsed === 'object' && parsed !== null) {
      const { owner, ids } = parsed as Record<string, unknown>;
      return { owner: typeof owner === 'string' ? owner : null, ids: Array.isArray(ids) ? onlyStrings(ids) : [] };
    }
  } catch {
    // Unreadable: no order.
  }
  return { owner: null, ids: [] };
}

function claimBrowserOrder(view: KbOrderView, owner: string, ids: string[]) {
  try {
    window.localStorage.setItem(kbOrderKey(view), JSON.stringify({ owner, ids }));
  } catch {
    // See useStoredFlag: storage that cannot be written is not an error.
  }
}

/** Removes the key, unless another user claimed it meanwhile. */
function forgetBrowserOrder(view: KbOrderView, userId: string) {
  try {
    const { owner } = readBrowserOrder(view);
    if (owner === null || owner === userId) window.localStorage.removeItem(kbOrderKey(view));
  } catch {
    // See useStoredFlag: storage that cannot be written is not an error.
  }
}

/** Per view: the saved order, or null for a view never saved. */
type ServerOrders = Record<KbOrderView, string[] | null>;

function stringIds(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null;
}

const VIEWS: readonly KbOrderView[] = ['my', 'shared'];

/** The sign-in's Authorization header, as AppRoot set it on axios. */
function currentAuth(): string {
  const value: unknown = axios.defaults?.headers?.common?.Authorization;
  return typeof value === 'string' ? value : '';
}

/** The GET body, or null when it failed or is not an order. */
async function fetchOrders(auth: string): Promise<ServerOrders | null> {
  try {
    const { data } = await axios.get<unknown>(ORDER_URL, { headers: auth ? { Authorization: auth } : undefined });
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
    const body = data as Record<string, unknown>;
    return { my: stringIds(body.my), shared: stringIds(body.shared) };
  } catch {
    return null;
  }
}

interface Waiting {
  order: string[];
  /** Called when this save fails, before the toast. */
  onFailed?: () => void;
}

interface Session {
  userId: string;
  /** The Authorization header of this sign-in; every request of the session carries it. */
  auth: string;
  loaded: Promise<ServerOrders | null>;
  /** What `loaded` resolved to, once it did: a view mounting later starts from it. */
  orders: ServerOrders | null;
  /** The last load, or the upload of a browser order, failed; the next view that mounts loads again. */
  failed: boolean;
  /** Orders set since the load; they win over it. */
  latest: Partial<Record<KbOrderView, string[]>>;
  /** Per view: the save waiting to go out, and whether one is running. */
  queue: Partial<Record<KbOrderView, { waiting: Waiting | null; running: boolean }>>;
  /** Shows the save-failed toast; set by the view that mounted last. */
  notify: () => void;
}

let session: Session | null = null;

/**
 * Whether `s` is still the sign-in in effect. A save of an ended one is
 * dropped, not sent: after a sign-out its token may be revoked, and the 401
 * would sign out whoever is signed in now (AppRoot's interceptor).
 */
const isCurrent = (s: Session) => session === s && currentAuth() === s.auth;

function startLoad(s: Session) {
  s.failed = false;
  s.loaded = fetchOrders(s.auth).then(orders => {
    if (orders === null) {
      s.failed = true;
    } else {
      s.orders = orders;
    }
    if (orders !== null && isCurrent(s)) {
      for (const view of VIEWS) settleBrowserOrder(s, view, orders);
    }
    return orders;
  });
}

/** The session of this sign-in: a new one for a new sign-in, a new load after a failed one. */
function sessionFor(userId: string): Session {
  const auth = currentAuth();
  if (session === null || session.userId !== userId || session.auth !== auth) {
    session = { userId, auth, loaded: Promise.resolve(null), orders: null, failed: false, latest: {}, queue: {}, notify: () => {} };
    startLoad(session);
  } else if (session.failed) {
    startLoad(session);
  }
  return session;
}

/**
 * The browser's old order of `view` against the account's: dropped when the
 * account has one, or when the view was dragged before the load came back
 * (that order is the one being saved); uploaded when the account has none.
 */
function settleBrowserOrder(s: Session, view: KbOrderView, orders: ServerOrders) {
  const fromBrowser = readBrowserOrder(view);
  // Claimed by someone else, whose upload failed: not this user's to take,
  // and not to be kept for the next one either.
  if (fromBrowser.owner !== null && fromBrowser.owner !== s.userId) {
    try {
      window.localStorage.removeItem(kbOrderKey(view));
    } catch {
      // See useStoredFlag.
    }
    return;
  }
  if (s.latest[view] || orders[view] !== null) {
    forgetBrowserOrder(view, s.userId);
    return;
  }
  const ids = fromBrowser.ids;
  if (ids.length === 0) return;
  claimBrowserOrder(view, s.userId, ids);
  s.latest[view] = ids;
  save(s, view, ids, () => {
    // Not uploaded: the claimed key stays, and the next view that mounts
    // loads again, which settles the keys again.
    if (s.latest[view] === ids) {
      delete s.latest[view];
      s.failed = true;
    }
  });
}

/** For tests: forget the loaded orders and drop the save queue. */
export function resetKbOrderSession() {
  session = null;
}

function save(s: Session, view: KbOrderView, order: string[], onFailed?: () => void) {
  const q = (s.queue[view] ??= { waiting: null, running: false });
  q.waiting = { order, onFailed };
  if (q.running) return;
  q.running = true;
  void (async () => {
    while (q.waiting && isCurrent(s)) {
      const next = q.waiting;
      q.waiting = null;
      try {
        await axios.put(`${ORDER_URL}/${view}`, { ids: next.order },
          { headers: s.auth ? { Authorization: s.auth } : undefined });
        forgetBrowserOrder(view, s.userId);
      } catch {
        next.onFailed?.();
        if (isCurrent(s)) s.notify();
      }
    }
    // A session that ended (sign-out, another sign-in) drops what it still had.
    q.waiting = null;
    q.running = false;
  })();
}

/** Sorts `items` by `order`; ids the order does not know keep the server's order, ahead of the rest. */
export function applyOrder<T extends { id: string }>(items: T[], order: readonly string[]): T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  const unknown = items.filter(item => !rank.has(item.id));
  const known = items.filter(item => rank.has(item.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...unknown, ...known];
}

/**
 * `ids` with `activeId` placed right after `afterId` — or first, with no
 * `afterId` (an empty group). For a drop on a group's free area.
 */
export function placeAfter(ids: readonly string[], activeId: string, afterId: string | null): string[] {
  const rest = ids.filter(id => id !== activeId);
  const at = afterId === null ? 0 : rest.indexOf(afterId) + 1;
  return [...rest.slice(0, at), activeId, ...rest.slice(at)];
}

/**
 * `ids` with `activeId` moved to where `overId` stands. `ids` is the WHOLE
 * displayed order, not just what a filter chip shows: the visible cards are a
 * subsequence of it, so moving one onto another here moves it the same way
 * among the visible ones and leaves the hidden ones where they were.
 */
export function moveId(ids: readonly string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

export interface KbOrder {
  /** Sorts a list of topics by the stored order. */
  apply: <T extends { id: string }>(items: T[]) => T[];
  /** Stores `ids` (the whole displayed order) with `activeId` moved onto `overId`. */
  move: (ids: readonly string[], activeId: string, overId: string) => void;
  /** Stores `ids` as the order. */
  set: (ids: readonly string[]) => void;
}

export function useKbOrder(view: KbOrderView): KbOrder {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const toast = useToast();
  const { t } = useTheme();
  // A view mounting again in the same sign-in starts sorted: from the latest
  // drag, else from the order already loaded — not unsorted for a frame.
  const [order, setOrder] = useState<string[]>(() =>
    (session !== null && session.userId === userId && session.auth === currentAuth()
      ? session.latest[view] ?? session.orders?.[view]
      : undefined) ?? []);

  // Read through a ref: a save outlives the render that started it, and the
  // load effect below must not re-run when the toast or language changes.
  const sayFailed = useRef(() => {});
  useEffect(() => {
    sayFailed.current = () => toast.error(t('topicOrderSaveError'));
  }, [toast, t]);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    const s = sessionFor(userId);
    s.notify = () => sayFailed.current();
    void s.loaded.then(orders => {
      if (!live) return;
      const shown = s.latest[view] ?? orders?.[view];
      if (shown) setOrder(shown);
    });
    return () => {
      live = false;
    };
  }, [userId, view]);

  const apply = useCallback(<T extends { id: string }>(items: T[]) => applyOrder(items, order), [order]);

  const set = useCallback((ids: readonly string[]) => {
    const next = [...ids];
    setOrder(next);
    if (!userId) return;
    const s = sessionFor(userId);
    s.latest[view] = next;
    save(s, view, next);
  }, [userId, view]);

  const move = useCallback(
    (ids: readonly string[], activeId: string, overId: string) => set(moveId(ids, activeId, overId)),
    [set],
  );

  return useMemo(() => ({ apply, move, set }), [apply, move, set]);
}
