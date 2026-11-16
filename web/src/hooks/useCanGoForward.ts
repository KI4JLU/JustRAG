import { useSyncExternalStore } from 'react';
import { useRouter, type RouterHistory } from '@tanstack/react-router';

/*
 * Whether there is a history entry ahead of the current one. The History API
 * does not say, so it is tracked: the router numbers its entries
 * (`__TSR_index`), and the furthest one reached stays ahead until a new
 * navigation (a push) cuts everything after the current entry off.
 *
 * Kept per history object and outside React, because the buttons that read it
 * are mounted by whichever view is on screen: state inside the component
 * would start over on every change of view — exactly when „forward" becomes
 * possible.
 *
 * After a reload the count starts at the current entry, so „forward" stays
 * off until the user has gone back once in this session.
 */
interface Tracker {
  index: number;
  furthest: number;
  listeners: Set<() => void>;
}

const trackers = new WeakMap<RouterHistory, Tracker>();

function trackerOf(history: RouterHistory): Tracker {
  let tracker = trackers.get(history);
  if (!tracker) {
    const index = history.location.state.__TSR_index;
    const created: Tracker = { index, furthest: index, listeners: new Set() };
    history.subscribe(({ location, action }) => {
      const next = location.state.__TSR_index;
      created.furthest = action.type === 'PUSH' ? next : Math.max(created.furthest, next);
      created.index = next;
      created.listeners.forEach((listener) => listener());
    });
    trackers.set(history, created);
    tracker = created;
  }
  return tracker;
}

export function useCanGoForward(): boolean {
  const { history } = useRouter();
  const tracker = trackerOf(history);
  return useSyncExternalStore(
    (onChange) => {
      tracker.listeners.add(onChange);
      return () => { tracker.listeners.delete(onChange); };
    },
    () => tracker.index < tracker.furthest,
  );
}
