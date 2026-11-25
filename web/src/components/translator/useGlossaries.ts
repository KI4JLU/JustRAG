import { useCallback, useEffect, useState } from 'react';
import { fetchGlossaries } from './api';
import type { GlossaryList } from './types';

export interface GlossariesState {
  /** `undefined` until the list arrived (or failed). */
  data: GlossaryList | undefined;
  failed: boolean;
  /** Reads the list again, after a glossary was made, changed or left. */
  reload: () => Promise<void>;
}

/** The glossaries the caller can open, each with their role and the flags of what it allows. */
export function useGlossaries(enabled = true): GlossariesState {
  const [data, setData] = useState<GlossaryList | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setData(await fetchGlossaries());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    fetchGlossaries().then(
      (list) => {
        if (!current) return;
        setData(list);
        setFailed(false);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [enabled]);

  return { data, failed, reload };
}
