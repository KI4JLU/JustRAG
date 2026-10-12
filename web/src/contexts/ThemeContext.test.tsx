/**
 * The app's `ThemeProvider` composition (card KI-779).
 *
 * WHY THIS FILE EXISTS, and why the hook suite next door is not enough.
 * `src/hooks/useThemeAndLanguage.test.ts` mounts the design system's
 * `ThemeProvider` itself, so it can prove the DS resolves tri-state correctly
 * while saying nothing about whether THIS APP mounts it. That gap is the
 * KI-740 failure mode verbatim: a provider a test supplies is not a provider
 * production supplies. It is also the exact defect that produced this card —
 * the app chrome rendered the DS `ThemeToggle`, and with no DS provider in the
 * tree it throws `useTheme must be used within a ThemeProvider`. DS 0.45.0
 * removed `ThemeToggle`; its successor `AppearanceSettings` (the colour-scheme
 * row of the settings window) reads the same DS context and throws the same
 * way, so it takes the toggle's place here.
 *
 * So this file renders the REAL `ThemeProvider` from `contexts/ThemeContext`
 * with the REAL DS `AppearanceSettings` inside it, and drives its colour-scheme
 * Select with the keyboard and real clicks.
 * Nothing here is mocked except the browser APIs jsdom does not implement
 * (`localStorage`, `matchMedia`).
 *
 * ORACLES, all independent of this repo's code:
 *  - The row name and the three option names come from the installed
 *    @ki4jlu/design-system's own `AppearanceSettings` defaults ("Farbschema";
 *    "Hell" / "System" / "Dunkel"), not from anything here.
 *  - A Select's combobox shows its selected option's text (WAI-ARIA combobox).
 *  - `localStorage['theme']` and `<html data-theme>` are the two observable
 *    outputs a returning visit and a stylesheet respectively depend on.
 *
 * THE ASSERTION THAT MATTERS MOST is `every option is actually selectable`. The
 * rejected alternative on this card — mounting the DS provider in controlled
 * mode over a two-state app model — renders perfectly and passes a smoke test,
 * and fails exactly here: its `system` option can never become selected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceSettings } from '@ki4jlu/design-system';
import { ThemeProvider, useTheme } from './ThemeContext';

/** DS AppearanceSettings' default labels: the row, then its three options. */
const ROW = 'Farbschema';
const LIGHT = 'Hell';
const SYSTEM = 'System';
const DARK = 'Dunkel';

let store: Record<string, string> = {};
const storageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { store = {}; },
  key: (i: number) => Object.keys(store)[i] ?? null,
  get length() { return Object.keys(store).length; },
};

const DARK_QUERY = '(prefers-color-scheme: dark)';
let prefersDark = false;
const listeners = new Set<(e: MediaQueryListEvent) => void>();
const mediaQueryList = {
  get matches() { return prefersDark; },
  media: DARK_QUERY,
  onchange: null,
  addEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) => { listeners.add(cb); },
  removeEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) => { listeners.delete(cb); },
  addListener: (cb: (e: MediaQueryListEvent) => void) => { listeners.add(cb); },
  removeListener: (cb: (e: MediaQueryListEvent) => void) => { listeners.delete(cb); },
  dispatchEvent: () => false,
};

function osPrefersDark(next: boolean): void {
  prefersDark = next;
  for (const cb of [...listeners]) cb({ matches: next, media: DARK_QUERY } as MediaQueryListEvent);
}

/**
 * Reports the APP context's own view of the theme, from inside the provider.
 *
 * It renders the pair into the DOM rather than writing it to a variable this
 * file reads back: a render that assigns to module scope is a side effect in
 * render, which the React compiler's lint rule rejects — and rightly, since it
 * would also make the value depend on how many times React chose to render.
 */
function Probe() {
  const { theme, resolvedTheme } = useTheme();
  return <div data-testid="app-theme">{`${theme}/${resolvedTheme}`}</div>;
}

/** `${theme}/${resolvedTheme}` as the app context currently reports it. */
function appTheme(): string {
  return screen.getByTestId('app-theme').textContent ?? '';
}

function renderApp() {
  return render(
    <ThemeProvider>
      <AppearanceSettings />
      <Probe />
    </ThemeProvider>,
  );
}

function painted(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

const CONTRAST_QUERY = '(prefers-contrast: more), (forced-colors: active)';

/** The colour-scheme option the DS Select currently shows as selected. */
function selectedOption(): string | null {
  return screen.getByRole('combobox', { name: ROW }).textContent;
}

/** Open the colour-scheme Select with the keyboard (Radix Select's jsdom-safe path) and pick `name`. */
async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  screen.getByRole('combobox', { name: ROW }).focus();
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('option', { name }));
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

beforeEach(() => {
  // Radix Select scrolls its selected option into view and captures the
  // pointer; jsdom implements neither.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  store = {};
  listeners.clear();
  prefersDark = false;
  vi.stubGlobal('localStorage', storageMock);
  vi.stubGlobal('matchMedia', (q: string) => {
    // The appearance provider (mounted by ThemeProvider since 24.09.2026)
    // asks the OS about contrast; answered "not requested", inert. Any
    // OTHER unexpected query still fails loudly.
    if (q === CONTRAST_QUERY) {
      return { matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} };
    }
    if (q !== DARK_QUERY) throw new Error(`unexpected media query: ${q}`);
    return mediaQueryList;
  });
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeProvider — the design system appearance settings the app renders', () => {
  it('mounts a DS ThemeProvider, so the DS AppearanceSettings render instead of throwing', () => {
    expect(() => renderApp()).not.toThrow();
    // ORACLE: the DS component's own default row label; nothing stored yet, so `system`.
    expect(screen.getByRole('combobox', { name: ROW })).toBeInTheDocument();
    expect(selectedOption()).toBe(SYSTEM);
  });

  it('every option is actually selectable — including system', async () => {
    const user = userEvent.setup();
    prefersDark = true; // so `system` is distinguishable from a pinned light
    renderApp();

    for (const [name, choice, resolved] of [
      [LIGHT, 'light', 'light'],
      [DARK, 'dark', 'dark'],
      [SYSTEM, 'system', 'dark'],
    ] as const) {
      await choose(user, name);

      // ORACLE: the combobox shows the option that was picked.
      expect(selectedOption()).toBe(name);
      expect(appTheme()).toBe(`${choice}/${resolved}`);
      expect(painted()).toBe(resolved);
      // ORACLE: the storage key a returning visit reads.
      expect(store.theme).toBe(choice);
    }
  });

  it('never paints data-theme="system" — the attribute always carries a resolved value', async () => {
    const user = userEvent.setup();
    renderApp();
    await choose(user, DARK);
    await choose(user, SYSTEM);
    expect(appTheme()).toBe('system/light');
    expect(painted()).toBe('light');

    act(() => { osPrefersDark(true); });

    // Still not "system", and it followed the OS without a remount.
    expect(painted()).toBe('dark');
    expect(appTheme()).toBe('system/dark');
  });

  it('a pin made through the settings survives a reload', async () => {
    const user = userEvent.setup();
    const first = renderApp();
    await choose(user, DARK);
    first.unmount();

    // A "reload" is a fresh mount reading the same storage. Nothing else carries over.
    renderApp();
    expect(selectedOption()).toBe(DARK);
    expect(painted()).toBe('dark');
  });

  it('a value stored by the OLD two-state toggle selects that same option', () => {
    // FIXTURE: exactly what the pre-KI-779 hook wrote for a user who had
    // switched to dark. prefersDark stays false so a fallback to `system`
    // would resolve to light and be visible.
    store.theme = 'dark';
    renderApp();
    expect(selectedOption()).toBe(DARK);
    expect(appTheme()).toBe('dark/dark');
    expect(painted()).toBe('dark');
  });
});
