import { useSyncExternalStore } from 'react';
import { createBrowserHistory, type RouterHistory } from '@tanstack/react-router';

/*
 * A dialog whose open state and section live in one URL parameter
 * (`?<param>=<value>`), on whatever page is showing. The admin console
 * (`?admin=`), the user settings (`?settings=`) and a topic's settings
 * (`?topic=`) are built on it, each behind its own small store module whose
 * functions stay the only way callers touch the parameter.
 *
 *   - Read from the location, and again on every history change (back,
 *     forward, a navigation elsewhere — which drops the parameter, so the
 *     dialog closes with the page it was opened on).
 *   - Opening PUSHES the parameter, so the browser's back button closes it.
 *   - Switching sections REPLACES the URL: back must not step through every
 *     section before it closes, which would be a trap in a modal.
 *   - Closing goes back one step when the dialog pushed the entry (the entry
 *     carries a marker in its history state), else — a link that already
 *     carried the parameter — replaces the URL without it.
 *   - A bare parameter (`?admin`) or an unknown value means the first value.
 *   - The path, the other parameters and the hash are left as they are.
 *
 * Every write goes through the ROUTER'S history (`bindUrlDialogHistory`,
 * called by App.tsx): a bare `window.history` call is invisible to the router,
 * whose idea of the location would then drift from the address bar. Until one
 * is bound, reads come from `window.location`; only a write before binding
 * (a store's unit test on its own) creates a browser history of its own, and
 * binding destroys it. App.tsx binds during its first render, before any
 * child can write.
 *
 * Each write first flushes the history, then flushes again: the router's
 * browser history batches `pushState` into a microtask, so a navigation the
 * router queued in the same tick („Teilen": open the topic, then its
 * settings) must land as its own entry before this one, and the address bar
 * should not lag the dialog.
 */

let boundHistory: RouterHistory | null = null;
let ownHistory: RouterHistory | null = null;
const attachers = new Set<() => void>();

/** The history writes go to; reads use it too once there is one. */
function current(): RouterHistory | null {
  return boundHistory ?? ownHistory;
}

function writable(): RouterHistory {
  if (!current()) {
    ownHistory = createBrowserHistory();
    attachers.forEach((attach) => attach());
  }
  return current()!;
}

function location(): { pathname: string; search: string; hash: string; state: Record<string, unknown> } {
  const h = current();
  if (h) return { ...h.location, state: (h.location.state ?? {}) as unknown as Record<string, unknown> };
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash, state: (window.history.state ?? {}) as Record<string, unknown> };
}

/** Hands the router's history to every URL dialog. Idempotent; called where the router is created. */
export function bindUrlDialogHistory(h: RouterHistory) {
  if (boundHistory === h) return;
  boundHistory = h;
  // A history of its own (a write before any binding) is not needed beside
  // the router's: drop it rather than leave its listeners on the page.
  ownHistory?.destroy();
  ownHistory = null;
  attachers.forEach((attach) => attach());
}

export interface UrlDialogState<V extends string> {
  open: boolean;
  value: V;
}

export interface UrlDialog<V extends string> {
  /** Opens on `value` (default: the first). Pushes an entry, unless it is already open: then it switches. */
  open: (value?: V) => void;
  setOpen: (open: boolean) => void;
  /** Switches the open dialog to `value`. Replaces the URL: it is not a step of its own. */
  setValue: (value: V) => void;
  /** For a user who may not open it: ignore the parameter and take it off the URL, keeping the history as it is. */
  strip: () => void;
  useDialogState: () => UrlDialogState<V>;
}

export function createUrlDialog<V extends string>(param: string, values: readonly V[]): UrlDialog<V> {
  const first = values[0];
  const marker = `urlDialog:${param}`;
  const isValue = (v: string | null): v is V => (values as readonly string[]).includes(v ?? '');

  let state: UrlDialogState<V> = { open: false, value: first };

  function read(): UrlDialogState<V> {
    const params = new URLSearchParams(location().search);
    if (!params.has(param)) return { open: false, value: state.value };
    const v = params.get(param);
    return { open: true, value: isValue(v) ? v : first };
  }

  /** The current location with the parameter set to `value`, or removed. Everything else stays. */
  function urlWith(value: V | null): string {
    const { pathname, search, hash } = location();
    const params = new URLSearchParams(search);
    if (value) params.set(param, value);
    else params.delete(param);
    const q = params.toString();
    return pathname + (q ? `?${q}` : '') + hash;
  }

  /** The entry's own state, without the history's bookkeeping keys. */
  function entryState(): Record<string, unknown> {
    const rest = { ...location().state };
    delete rest.key;
    delete rest.__TSR_key;
    delete rest.__TSR_index;
    return rest;
  }

  const listeners = new Set<() => void>();
  function set(next: UrlDialogState<V>) {
    if (next.open === state.open && next.value === state.value) return;
    state = next;
    listeners.forEach((l) => l());
  }

  state = read();
  let detach: (() => void) | null = null;
  const attach = () => {
    detach?.();
    detach = current()?.subscribe(() => set(read())) ?? null;
    set(read());
  };
  attachers.add(attach);
  attach();

  /** A write, after any navigation still queued in this tick, flushed at once. */
  function write(fn: (h: RouterHistory) => void) {
    const h = writable();
    h.flush();
    fn(h);
    h.flush();
  }

  function open(value: V = first) {
    if (state.open) {
      setValue(value);
      return;
    }
    write((h) => h.push(urlWith(value), { ...entryState(), [marker]: true }));
  }

  function setValue(value: V) {
    if (state.open && state.value !== value) {
      write((h) => h.replace(urlWith(value), entryState()));
    }
    set({ ...state, value });
  }

  function setOpen(next: boolean) {
    if (next) {
      open(state.value);
      return;
    }
    if (!state.open) return;
    // Close at once, so the dialog does not wait for the browser; the history
    // change re-reads the URL afterwards.
    set({ ...state, open: false });
    if (location().state[marker]) {
      writable().back();
    } else {
      write((h) => h.replace(urlWith(null), entryState()));
    }
  }

  function strip() {
    if (!state.open) return;
    write((h) => h.replace(urlWith(null), entryState()));
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return {
    open,
    setOpen,
    setValue,
    strip,
    useDialogState: () => useSyncExternalStore(subscribe, () => state),
  };
}
