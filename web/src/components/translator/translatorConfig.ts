import { useEffect, useSyncExternalStore } from 'react';
import { fetchTranslatorConfig } from './api';
import { DEFAULT_LIMITS, type TranslatorConfig } from './types';

/*
 * GET /api/translator/config, read once per session and shared by everything that needs it: the
 * navigation (the entry shows only while `enabled`), the page and the admin section. The answer
 * is kept outside React so the shell and the page do not each ask. `unavailable` is any failure,
 * including 403 for a role without the translation permission: the entry stays hidden.
 */

export type TranslatorConfigState =
  { status: 'idle' | 'loading' | 'unavailable'; config: null } | { status: 'ready'; config: TranslatorConfig };

let state: TranslatorConfigState = { status: 'idle', config: null };
let inflight: Promise<void> | null = null;
/** Counts resets: a read that began before one (another user's) must not publish its answer. */
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: TranslatorConfigState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Reads the config unless it is read or being read; `force` reads it again (after an admin saved). */
export function loadTranslatorConfig(force = false): Promise<void> {
  // A read on its way may predate what made the caller force one: read once more after it.
  if (inflight) return force ? inflight.then(() => loadTranslatorConfig(true)) : inflight;
  if (!force && (state.status === 'ready' || state.status === 'unavailable')) return Promise.resolve();
  if (state.status !== 'ready') publish({ status: 'loading', config: null });
  const mine = generation;
  inflight = fetchTranslatorConfig()
    .then((config) => {
      if (mine !== generation) return;
      publish({
        status: 'ready',
        // A server that leaves limits out falls back on the contract's numbers.
        config: { ...config, limits: { ...DEFAULT_LIMITS, ...config.limits }, languages: config.languages ?? [] },
      });
    })
    .catch(() => {
      if (mine === generation) publish({ status: 'unavailable', config: null });
    })
    .finally(() => {
      if (mine === generation) inflight = null;
    });
  return inflight;
}

/** For tests: forgets the answer. */
export function resetTranslatorConfig(): void {
  generation += 1;
  inflight = null;
  publish({ status: 'idle', config: null });
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The translator's config; starts reading it on first use. */
export function useTranslatorConfig(): TranslatorConfigState {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (current.status === 'idle') void loadTranslatorConfig();
  }, [current.status]);
  return current;
}

/** Whether the translator is switched on for this user: the navigation entry follows it. */
export function useTranslatorEnabled(): boolean {
  const { config } = useTranslatorConfig();
  return config?.enabled === true;
}
