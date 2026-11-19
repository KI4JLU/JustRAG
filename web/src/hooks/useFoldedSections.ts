import { useCallback, useRef, useState } from 'react';
import { STORAGE_NAMESPACE } from './useStoredFlag';

export const FOLDED_SECTIONS_KEY = `${STORAGE_NAMESPACE}history.folded`;

function readStored(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FOLDED_SECTIONS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    // No storage (private mode) or a value that is not JSON: nothing folded.
    return [];
  }
}

/**
 * Which sections of the sidebar history are folded away, by key (a section's
 * id, or the built-in ones' names). Remembered in this browser like the other
 * view preferences; without storage the choice lasts for the session. A key
 * of a section that no longer exists stays in the list and matches nothing.
 */
export function useFoldedSections() {
  const [folded, setFolded] = useState<string[]>(readStored);
  const current = useRef(folded);

  const store = useCallback((next: string[]) => {
    current.current = next;
    setFolded(next);
    try {
      window.localStorage.setItem(FOLDED_SECTIONS_KEY, JSON.stringify(next));
    } catch {
      // Not stored; the state above still applies.
    }
  }, []);

  const isOpen = useCallback((key: string) => !folded.includes(key), [folded]);
  const setOpen = useCallback((key: string, open: boolean) => {
    const rest = current.current.filter(k => k !== key);
    store(open ? rest : [...rest, key]);
  }, [store]);
  /** Open `key` and fold every other one of `all`. */
  const foldOthers = useCallback((key: string, all: string[]) => {
    store(all.filter(k => k !== key));
  }, [store]);

  return { isOpen, setOpen, foldOthers };
}
