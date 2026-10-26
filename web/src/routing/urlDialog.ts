import { useSyncExternalStore } from 'react';
import { createBrowserHistory, type RouterHistory } from '@tanstack/react-router';

/*
 * A dialog whose open state and section live in one URL parameter
 * (`?<param>=<value>`), on whatever page is showing. The admin console
 * (`?admin=`), the user settings (`?settings=`) and a topic's settings
 * (`?topic=`) are built on it, each behind its own small store module whose
 * functions stay the only way callers touch the parameter.
 *
 *   - Read from the history's location, and again on every history change
 *     (back, forward, a navigation elsewhere — which drops the parameter, so
 *     the dialog closes with the page it was opened on).
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
 * called once by App.tsx): a bare `window.history` call is invisible to the
 * router, whose idea of the location would then drift from the address bar.
 * Until one is bound (unit tests of a store on its own) a browser history of
 * its own is used. Each write is flushed: the router's browser history batches
 * `pushState` into a microtask, and the address bar should not lag the dialog.
 */

let boundHistory: RouterHistory | null = null;
const rebinders = new Set<() => void>();

function history(): RouterHistory {
  if (!boundHistory) boundHistory = createBrowserHistory();
  return boundHistory;
}

/** Hands the router's history to every URL dialog. Called once, where the router is created. */
export function bindUrlDialogHistory(h: RouterHistory) {
  if (boundHistory === h) return;
  boundHistory = h;
  rebinders.forEach((rebind) => rebind());
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

  function read(): UrlDialogState<V> {
    const params = new URLSearchParams(history().location.search);
    if (!params.has(param)) return { open: false, value: state?.value ?? first };
    const v = params.get(param);
    return { open: true, value: isValue(v) ? v : first };
  }

  /** The current location with the parameter set to `value`, or removed. Everything else stays. */
  function urlWith(value: V | null): string {
    const { pathname, search, hash } = history().location;
    const params = new URLSearchParams(search);
    if (value) params.set(param, value);
    else params.delete(param);
    const q = params.toString();
    return pathname + (q ? `?${q}` : '') + hash;
  }

  function currentState(): Record<string, unknown> {
    const { key: _key, __TSR_key: _tsrKey, __TSR_index: _index, ...rest } = history().location.state ?? {};
    void _key; void _tsrKey; void _index;
    return rest;
  }

  let state: UrlDialogState<V> | undefined;
  state = read();
  const listeners = new Set<() => void>();

  function set(next: UrlDialogState<V>) {
    if (state && next.open === state.open && next.value === state.value) return;
    state = next;
    listeners.forEach((l) => l());
  }

  let unsubscribe = history().subscribe(() => set(read()));
  rebinders.add(() => {
    unsubscribe();
    unsubscribe = history().subscribe(() => set(read()));
    set(read());
  });

  function open(value: V = first) {
    if (state!.open) {
      setValue(value);
      return;
    }
    history().push(urlWith(value), { ...currentState(), [marker]: true });
    history().flush();
  }

  function setValue(value: V) {
    if (state!.open && state!.value !== value) {
      history().replace(urlWith(value), currentState());
      history().flush();
    }
    set({ ...state!, value });
  }

  function setOpen(next: boolean) {
    if (next) {
      open(state!.value);
      return;
    }
    if (!state!.open) return;
    // Close at once, so the dialog does not wait for the browser; the history
    // change re-reads the URL afterwards.
    set({ ...state!, open: false });
    if ((history().location.state as unknown as Record<string, unknown> | undefined)?.[marker]) {
      history().back();
    } else {
      history().replace(urlWith(null), currentState());
      history().flush();
    }
  }

  function strip() {
    if (!state!.open) return;
    history().replace(urlWith(null), currentState());
    history().flush();
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
    useDialogState: () => useSyncExternalStore(subscribe, () => state!),
  };
}
