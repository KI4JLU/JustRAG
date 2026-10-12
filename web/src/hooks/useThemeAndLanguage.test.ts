/**
 * `useThemeAndLanguage` after KI-779, i.e. the app's THEME CONTRACT.
 *
 * Since KI-779 the hook does not own the theme any more: it reads the design
 * system's `ThemeProvider`, mounted uncontrolled by `contexts/ThemeContext`.
 * This suite therefore renders it under the REAL DS provider — the installed
 * `@ki4jlu/design-system` — rather than a stand-in, because the thing worth
 * pinning is what the app ships, not a copy of the DS's rules.
 *
 * ORACLES, and why each is independent of the code under test:
 *
 *  - The tri-state values `light | dark | system` and the storage key `theme`
 *    come from the DS typings + the app's own pre-KI-779 storage format, not
 *    from anything this hook computes.
 *  - The MIGRATION cases seed `localStorage['theme']` with the literal strings
 *    the OLD two-state hook wrote (`'light'` / `'dark'` — see git history of
 *    this file: `localStorage.setItem('theme', theme)` with theme ∈ {light,
 *    dark}). Those fixtures are the state real users' browsers are in today;
 *    they are written by hand here, so no part of the new implementation
 *    produced them.
 *  - The LIVE OS-FOLLOW case drives `matchMedia`'s `change` event directly and
 *    reads `<html data-theme>` back. The event is the browser's contract, the
 *    attribute is what paints; neither is derived from the hook.
 *  - The language oracle is `translations.ts`.
 *
 * `data-theme` is asserted alongside the returned values on purpose: the
 * returned `resolvedTheme` and the attribute the DS provider writes are two
 * different things, and only the second one is visible to a user.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { ThemeProvider } from '@ki4jlu/design-system';
import { useThemeAndLanguage } from './useThemeAndLanguage';

/** A real in-memory Storage. `store` is also read directly, to assert absence. */
let store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = String(value); }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { store = {}; }),
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  get length() { return Object.keys(store).length; },
};

/**
 * A matchMedia whose `change` event can actually be fired.
 *
 * jsdom implements no matchMedia at all, and the DS provider both reads
 * `.matches` and subscribes to `change` — so a `{ matches }` stub (what this
 * file used before KI-779) cannot express "the OS theme changed while the app
 * was open", which is one of the card's acceptance criteria. One list object
 * per query string is returned every time, so add/remove pair up the way the
 * provider's effect cleanup expects.
 */
const DARK_QUERY = '(prefers-color-scheme: dark)';
let prefersDark = false;
const listeners = new Set<(e: MediaQueryListEvent) => void>();
const mediaQueryList = {
  get matches() { return prefersDark; },
  media: DARK_QUERY,
  onchange: null,
  addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => { listeners.add(cb); },
  removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => { listeners.delete(cb); },
  addListener: (cb: (e: MediaQueryListEvent) => void) => { listeners.add(cb); },
  removeListener: (cb: (e: MediaQueryListEvent) => void) => { listeners.delete(cb); },
  dispatchEvent: () => false,
};

/** Simulate the OS colour scheme flipping while the app is open. */
function osPrefersDark(next: boolean): void {
  prefersDark = next;
  for (const cb of [...listeners]) cb({ matches: next, media: DARK_QUERY } as MediaQueryListEvent);
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ThemeProvider, null, children);
}

function renderThemeHook() {
  return renderHook(() => useThemeAndLanguage(), { wrapper });
}

/** What the browser actually paints. */
function paintedTheme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

beforeEach(() => {
  store = {};
  listeners.clear();
  prefersDark = false;
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('matchMedia', (query: string) => {
    if (query !== DARK_QUERY) throw new Error(`unexpected media query: ${query}`);
    return mediaQueryList;
  });
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useThemeAndLanguage — tri-state theme (KI-779)', () => {
  it('defaults a first-time visitor to "system" and resolves it against the OS (dark)', () => {
    prefersDark = true;
    const { result } = renderThemeHook();
    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(paintedTheme()).toBe('dark');
  });

  it('defaults a first-time visitor to "system" and resolves it against the OS (light)', () => {
    prefersDark = false;
    const { result } = renderThemeHook();
    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('light');
    expect(paintedTheme()).toBe('light');
  });

  it.each(['light', 'dark'] as const)(
    'MIGRATION: a returning user whose old two-state toggle stored %s keeps that PIN, not "system"',
    (stored) => {
      // FIXTURE, not output: this is the exact value the pre-KI-779 hook wrote.
      store.theme = stored;
      // The OS says the opposite, so "kept the pin" and "fell back to system"
      // are distinguishable — with a matching OS they would look identical.
      prefersDark = stored === 'light';

      const { result } = renderThemeHook();

      expect(result.current.theme).toBe(stored);
      expect(result.current.resolvedTheme).toBe(stored);
      expect(paintedTheme()).toBe(stored);
    },
  );

  it('MIGRATION: mounting rewrites nothing, so no stored pin is silently reshaped', () => {
    store.theme = 'dark';
    renderThemeHook();
    expect(store.theme).toBe('dark');
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith('theme', expect.anything());
  });

  it('MIGRATION: a first-time visitor gets no stored value written on mount', () => {
    renderThemeHook();
    expect('theme' in store).toBe(false);
  });

  it.each(['light', 'dark', 'system'] as const)(
    'all three states are reachable via setTheme(%s) and persist under localStorage["theme"]',
    (choice) => {
      store.theme = choice === 'light' ? 'dark' : 'light';
      prefersDark = true;
      const { result } = renderThemeHook();

      act(() => { result.current.setTheme(choice); });

      expect(result.current.theme).toBe(choice);
      // `system` resolves against the OS, which this case has set to dark.
      expect(result.current.resolvedTheme).toBe(choice === 'light' ? 'light' : 'dark');
      expect(paintedTheme()).toBe(choice === 'light' ? 'light' : 'dark');
      // Persistence: the value survives a fresh mount reading the same storage.
      expect(store.theme).toBe(choice);
      const remounted = renderThemeHook();
      expect(remounted.result.current.theme).toBe(choice);
    },
  );

  it('"system" follows the OS live — no reload, no remount', () => {
    store.theme = 'system';
    prefersDark = false;
    const { result } = renderThemeHook();
    expect(result.current.resolvedTheme).toBe('light');
    expect(paintedTheme()).toBe('light');

    act(() => { osPrefersDark(true); });

    expect(result.current.resolvedTheme).toBe('dark');
    expect(paintedTheme()).toBe('dark');

    act(() => { osPrefersDark(false); });

    expect(result.current.resolvedTheme).toBe('light');
    expect(paintedTheme()).toBe('light');
  });

  it('a pinned choice does NOT follow the OS', () => {
    store.theme = 'light';
    prefersDark = false;
    const { result } = renderThemeHook();

    act(() => { osPrefersDark(true); });

    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
    expect(paintedTheme()).toBe('light');
  });
});

/* The i18n half is deliberately untouched by KI-779; these are the pre-existing
 * cases, unchanged apart from the DS provider the hook now needs above it. */
describe('useThemeAndLanguage — language', () => {
  it('defaults to "de" for language', () => {
    const { result } = renderThemeHook();
    expect(result.current.language).toBe('de');
  });

  it('restores language from localStorage', () => {
    store.language = 'en';
    const { result } = renderThemeHook();
    expect(result.current.language).toBe('en');
  });

  it('t("cancel") returns German by default', () => {
    const { result } = renderThemeHook();
    expect(result.current.t('cancel')).toBe('Abbrechen');
  });

  it('t("cancel") returns English after setLanguage("en")', () => {
    const { result } = renderThemeHook();
    act(() => { result.current.setLanguage('en'); });
    expect(result.current.t('cancel')).toBe('Cancel');
  });

  it('t() returns the key itself for missing translation keys', () => {
    const { result } = renderThemeHook();
    expect(result.current.t('nonexistentKey')).toBe('nonexistentKey');
  });

  it('persists language to localStorage on change', () => {
    const { result } = renderThemeHook();
    act(() => { result.current.setLanguage('en'); });
    expect(localStorageMock.setItem).toHaveBeenCalledWith('language', 'en');
  });
});
