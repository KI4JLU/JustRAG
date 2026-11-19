import { useCallback, useRef, useState } from 'react';
import {
  DEFAULT_HISTORY_FILTERS, parseHistoryFilters, type HistoryFilters,
} from '../components/history/historyFilters';
import { STORAGE_NAMESPACE } from './useStoredFlag';

export const HISTORY_FILTERS_KEY = `${STORAGE_NAMESPACE}history.filters`;

function readStored(): HistoryFilters {
  try {
    const raw = window.localStorage.getItem(HISTORY_FILTERS_KEY);
    return raw === null ? DEFAULT_HISTORY_FILTERS : parseHistoryFilters(JSON.parse(raw));
  } catch {
    // No storage (private mode) or a value that is not JSON: the defaults.
    return DEFAULT_HISTORY_FILTERS;
  }
}

/**
 * The sidebar history's filters, remembered in this browser like the other
 * view preferences (sidebar width, collapsed state). The history works
 * without storage; the choice then lasts for the session.
 */
export function useHistoryFilters() {
  const [filters, setFilters] = useState<HistoryFilters>(readStored);
  // The latest filters for `set`, which changes one of them: read from here
  // rather than from storage, which may not be there.
  const current = useRef(filters);

  const store = useCallback((next: HistoryFilters) => {
    current.current = next;
    setFilters(next);
    try {
      window.localStorage.setItem(HISTORY_FILTERS_KEY, JSON.stringify(next));
    } catch {
      // Not stored; the state above still applies.
    }
  }, []);

  const set = useCallback(<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) => {
    store({ ...current.current, [key]: value });
  }, [store]);
  const reset = useCallback(() => store(DEFAULT_HISTORY_FILTERS), [store]);

  return { filters, set, reset };
}
