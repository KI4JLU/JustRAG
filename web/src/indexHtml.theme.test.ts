/**
 * The theme/language boot script in web/index.html.
 *
 * This suite reads the REAL shipped index.html and executes the real script it
 * contains. That is what makes the oracle independent: a test written against a
 * copy of the logic would stay green while the file that actually reaches the
 * browser said something else, which is precisely the bug class here — the file
 * had no script at all, and every gate was green.
 *
 * Three properties are pinned:
 *
 *  1. The script and src/hooks/useThemeAndLanguage.ts resolve the same theme and
 *     the same language for the same inputs. If they disagree the page flips
 *     again when React mounts — a flicker that is worse than the steady white
 *     flash the script exists to remove. The oracle for each case is the hook
 *     itself, rendered under the same stubs; neither side derives from the other.
 *  2. The two theme-color literals in the script equal the design system's
 *     --color-surface for light and dark. The oracle is the installed
 *     @ki4jlu/design-system package, so a token change turns into a red test
 *     instead of a silently stale mobile browser chrome.
 *  3. The script's sha256 is in DefaultCSP's script-src in
 *     go-backend/internal/middleware/security.go. Without it CSP-enforcing
 *     browsers drop the script with no server-side signal (and the Vite dev
 *     server sends no CSP, so nothing local would show it).
 *     go-backend/internal/middleware/security_test.go carries the authoritative
 *     version of this check; it is repeated here on purpose, because `npm test`
 *     and `go test ./...` are separate gates and a frontend-only change to
 *     index.html must go red in the frontend gate too.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { renderHook } from '@testing-library/react';
import { useThemeAndLanguage } from './hooks/useThemeAndLanguage';

/**
 * Repo root, found by walking up from the vitest root (`web/`). Not derived
 * from import.meta.url: vitest serves modules through Vite, so import.meta.url
 * is not a file: URL here.
 */
const REPO_ROOT = (() => {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, 'web/index.html')) && existsSync(resolve(dir, 'go-backend'))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`no repo root above ${process.cwd()} (expected web/index.html + go-backend/)`);
    dir = up;
  }
})();
const INDEX_HTML = resolve(REPO_ROOT, 'web/index.html');
const DIST_INDEX_HTML = resolve(REPO_ROOT, 'web/dist/index.html');
const SECURITY_GO = resolve(REPO_ROOT, 'go-backend/internal/middleware/security.go');

/** Text content of the single attribute-less <script> element, byte-exact. */
function inlineScriptOf(html: string): string {
  const found = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (found.length !== 1) {
    throw new Error(`expected exactly 1 inline <script>, found ${found.length}; every inline script needs its own CSP hash`);
  }
  return found[0][1];
}

const indexHtml = readFileSync(INDEX_HTML, 'utf8');
const bootScript = inlineScriptOf(indexHtml);

function runBootScript(): void {
  new Function(bootScript)();
}

/**
 * An explicit in-memory localStorage. The ambient one in this environment is
 * not jsdom's Storage (it has no clear(), and Storage.prototype is not its
 * prototype), so both the script and the hook get this one instead — which
 * also makes the "storage throws" case expressible.
 */
let storage: Record<string, string> = {};
const storageMock = {
  getItem: (key: string) => (key in storage ? storage[key] : null),
  setItem: (key: string, value: string) => { storage[key] = String(value); },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { storage = {}; },
  key: (i: number) => Object.keys(storage)[i] ?? null,
  get length() { return Object.keys(storage).length; },
};

/** Fresh document state: no theme, no lang, a default-white theme-color meta. */
function resetDocument(): void {
  storage = {};
  vi.stubGlobal('localStorage', storageMock);
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('lang');
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
}

function stubPrefersDark(prefersDark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: prefersDark && query.includes('prefers-color-scheme: dark'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

type Resolved = { theme: string | null; lang: string | null };

function readDocument(): Resolved {
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    lang: document.documentElement.getAttribute('lang'),
  };
}

/** What the inline script resolves for the current stubs. */
function scriptResolves(storedTheme: string | null, storedLanguage: string | null, prefersDark: boolean): Resolved {
  resetDocument();
  stubPrefersDark(prefersDark);
  if (storedTheme !== null) localStorage.setItem('theme', storedTheme);
  if (storedLanguage !== null) localStorage.setItem('language', storedLanguage);
  runBootScript();
  return readDocument();
}

/** What the React hook resolves for the same stubs — the independent oracle. */
function hookResolves(storedTheme: string | null, storedLanguage: string | null, prefersDark: boolean): Resolved {
  resetDocument();
  stubPrefersDark(prefersDark);
  if (storedTheme !== null) localStorage.setItem('theme', storedTheme);
  if (storedLanguage !== null) localStorage.setItem('language', storedLanguage);
  const { unmount } = renderHook(() => useThemeAndLanguage());
  const resolved = readDocument();
  unmount();
  return resolved;
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('index.html boot script — agreement with useThemeAndLanguage', () => {
  const themeCases: Array<{ stored: string | null; prefersDark: boolean }> = [
    { stored: null, prefersDark: true },
    { stored: null, prefersDark: false },
    { stored: 'dark', prefersDark: false },
    { stored: 'light', prefersDark: true },
    { stored: 'DARK', prefersDark: false },
    { stored: 'nonsense', prefersDark: true },
    { stored: '', prefersDark: false },
  ];

  it.each(themeCases)('theme: stored=$stored prefersDark=$prefersDark', ({ stored, prefersDark }) => {
    const fromScript = scriptResolves(stored, null, prefersDark).theme;
    const fromHook = hookResolves(stored, null, prefersDark).theme;
    expect(fromScript).toMatch(/^(light|dark)$/);
    expect(fromScript).toBe(fromHook);
  });

  const languageCases: Array<string | null> = [null, 'de', 'en', 'fr', ''];

  it.each(languageCases)('language: stored=%s', (stored) => {
    const fromScript = scriptResolves(null, stored, false).lang;
    const fromHook = hookResolves(null, stored, false).lang;
    expect(fromScript).toMatch(/^(de|en)$/);
    expect(fromScript).toBe(fromHook);
  });

  it('leaves persistence to the hook — writes nothing to localStorage', () => {
    resetDocument();
    stubPrefersDark(true);
    runBootScript();
    expect(storage).toEqual({});
  });

  it('falls back to light/de when localStorage throws, without escaping the exception', () => {
    resetDocument();
    stubPrefersDark(true);
    vi.stubGlobal('localStorage', {
      ...storageMock,
      getItem: () => { throw new DOMException('storage is disabled', 'SecurityError'); },
    });
    expect(() => runBootScript()).not.toThrow();
    expect(readDocument()).toEqual({ theme: 'light', lang: 'de' });
  });
});

describe('index.html boot script — theme-color meta', () => {
  // The design system is the oracle for both literals: src/index.css maps
  // --bg-primary (the body background) onto --color-surface, and the script
  // hardcodes that colour because a pre-paint script cannot read a CSS variable
  // from a stylesheet that has not loaded yet.
  const tokensCss = (() => {
    const require = createRequire(import.meta.url);
    return readFileSync(require.resolve('@ki4jlu/design-system/tokens.css'), 'utf8');
  })();

  /** Resolves --color-surface for one theme through its one var() indirection. */
  function designSystemSurface(theme: 'light' | 'dark'): string {
    // Anchored to the start of a line so the selector's own doc comments
    // (which quote it) are not mistaken for the rule.
    const darkBlockAt = tokensCss.search(/^\[data-theme="dark"\]\s*\{/m);
    if (darkBlockAt < 0) {
      throw new Error('design-system tokens.css has no [data-theme="dark"] rule; its layout changed — re-verify the theme-color literals in web/index.html by hand');
    }
    const scope = theme === 'dark' ? tokensCss.slice(darkBlockAt) : tokensCss.slice(0, darkBlockAt);
    const surface = scope.match(/--color-surface:\s*var\((--[\w-]+)\)/);
    if (!surface) {
      throw new Error(`design-system tokens.css has no --color-surface in the ${theme} scope; its layout changed — re-verify the theme-color literals in web/index.html by hand`);
    }
    const primitive = tokensCss.match(new RegExp(`${surface[1]}:\\s*(#[0-9a-fA-F]{3,8})`));
    if (!primitive) {
      throw new Error(`design-system primitive ${surface[1]} is not a hex literal; re-verify the theme-color literals in web/index.html by hand`);
    }
    return primitive[1].toLowerCase();
  }

  function themeColorAfterBoot(prefersDark: boolean): string | null {
    resetDocument();
    stubPrefersDark(prefersDark);
    runBootScript();
    return document.querySelector('meta[name="theme-color"]')?.getAttribute('content')?.toLowerCase() ?? null;
  }

  it('tracks the design system surface in dark mode', () => {
    expect(themeColorAfterBoot(true)).toBe(designSystemSurface('dark'));
  });

  it('tracks the design system surface in light mode', () => {
    expect(themeColorAfterBoot(false)).toBe(designSystemSurface('light'));
  });
});

describe('index.html boot script — placement and CSP', () => {
  it('sits inside <head>', () => {
    const scriptAt = indexHtml.indexOf('<script>');
    const headEndsAt = indexHtml.indexOf('</head>');
    expect(scriptAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(headEndsAt);
  });

  it('is covered by a script-src hash in go-backend/internal/middleware/security.go', () => {
    const digest = createHash('sha256').update(bootScript, 'utf8').digest('base64');
    const csp = readFileSync(SECURITY_GO, 'utf8').match(/const DefaultCSP = "(.*)"/)?.[1];
    expect(csp, 'DefaultCSP not found in security.go').toBeTruthy();
    expect(
      csp,
      `script-src must contain 'sha256-${digest}' — regenerate per the comment on DefaultCSP`,
    ).toContain(`'sha256-${digest}'`);
  });

  // Skipped without a build: web/dist is gitignored. When it IS present these
  // two assertions are what justify hashing the source file above — the browser
  // hashes the built bytes, and the stylesheet must not paint before the script.
  it.skipIf(!existsSync(DIST_INDEX_HTML))('survives the build byte-for-byte and stays ahead of the stylesheet', () => {
    const dist = readFileSync(DIST_INDEX_HTML, 'utf8');
    expect(inlineScriptOf(dist)).toBe(bootScript);
    const scriptAt = dist.indexOf('<script>');
    const stylesheetAt = dist.indexOf('<link rel="stylesheet"');
    expect(stylesheetAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(stylesheetAt);
  });
});
