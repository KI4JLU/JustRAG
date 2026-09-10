import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import App from './App';
import { translations, type Language } from './translations';

/* ---------------------------------------------------------------------------
 * The test that did not exist (card KI-740).
 *
 * `LegalPage` had six green unit tests and six green Storybook stories while
 * the terms, privacy and accessibility pages threw
 * `useToast must be used within ToastProvider` for every visitor who opened
 * them BEFORE logging in — the main path for reading them. Nothing caught it
 * because nothing rendered the unauthenticated ROUTE: the unit suite mocked
 * `ToastContext` away and `.storybook/preview.tsx` wraps every story in a
 * `ToastProvider` that production only mounted on the authenticated half of
 * the tree.
 *
 * So this file asserts the wiring rather than the page. It renders the real
 * `App` — the real `ErrorBoundary`/`ThemeProvider`/`MobileProvider`/
 * `Suspense`/`ToastProvider`/`ToastContainer` composition, the real lazy
 * `Login`, the real `Footer`, the real `LegalPage` and the real `useToast` —
 * and drives it the way a visitor does: click a footer link on the login
 * screen, expect the document. A required provider missing anywhere above
 * that route makes these tests red.
 *
 * ONLY the network is stubbed (axios and `fetch`), plus the two browser APIs
 * jsdom does not implement (`matchMedia`, and a real in-memory `localStorage`
 * so one test cannot decide the next one's theme, language or auth state).
 * No provider, no context and no hook is mocked — mocking them is precisely
 * what hid the bug.
 *
 * Oracles, all independent of App.tsx: translations.ts for every expected
 * string (and for the DE/EN pair, which is the acceptance criterion's "in
 * both languages"), WAI-ARIA for `role="heading"`/`role="button"` and for the
 * toast region's accessible name, and ErrorBoundary's own fallback copy
 * ("Something went wrong") as the negative check — a provider crash is caught
 * by App's outermost boundary, so the boundary's text is the observable
 * signature of the bug this card fixes.
 * ------------------------------------------------------------------------- */

// axios is replaced wholesale because App reaches for `defaults`,
// `interceptors` and `get` at mount, and Login for `get`. Shape mirrors
// exactly what those two files touch.
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

const mockedGet = axios.get as unknown as Mock;

/** A real in-memory Storage, installed fresh per test. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, v); },
  } as Storage;
}

/** Resolves every legal document with the same harmless body. */
function stubDocumentFetch() {
  const fetchMock = vi.fn(() => Promise.resolve({ text: () => Promise.resolve('<p>Document body</p>') }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal('localStorage', memoryStorage());
  window.history.replaceState(null, '', '/');

  // No `token`/`user` in storage — App renders the unauthenticated branch.
  mockedGet.mockImplementation((url: string) => {
    if (url.endsWith('/api/site-config')) return Promise.resolve({ data: {} });
    if (url.endsWith('/api/auth/providers')) {
      return Promise.resolve({ data: { providers: [], localAuthEnabled: true } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Footer link key -> page heading key, from Footer.tsx and LegalPage.tsx. */
const LEGAL_PAGES = [
  { name: 'terms', linkKey: 'termsOfUse', titleKey: 'termsOfUseTitle' },
  { name: 'privacy', linkKey: 'privacyPolicy', titleKey: 'privacyPolicyTitle' },
  { name: 'accessibility', linkKey: 'accessibility', titleKey: 'accessibilityTitle' },
] as const;

const LANGUAGES: Language[] = ['de', 'en'];

function tr(key: string, lang: Language) {
  return translations[key as keyof typeof translations][lang];
}

describe('App — legal pages on the unauthenticated route', () => {
  for (const lang of LANGUAGES) {
    for (const { name, linkKey, titleKey } of LEGAL_PAGES) {
      it(`opens the ${name} document from the login footer in ${lang}`, async () => {
        localStorage.setItem('language', lang);
        stubDocumentFetch();

        render(<App />);

        const link = await screen.findByRole('button', { name: tr(linkKey, lang) });
        await userEvent.click(link);

        // The page rendered at all — i.e. every provider `LegalPage` consumes
        // is mounted above the unauthenticated route.
        expect(await screen.findByRole('heading', { level: 1, name: tr(titleKey, lang) }))
          .toBeInTheDocument();
        expect(await screen.findByText('Document body')).toBeInTheDocument();
        // ...and App's outermost ErrorBoundary did not swallow a crash.
        expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
      });
    }
  }

  it('renders a toast raised on the unauthenticated route', async () => {
    // The provider alone is not enough: the container that renders the queue
    // has to be mounted on this route too. A failed document fetch is the one
    // toast the unauthenticated tree can raise, so it is the probe. (Where
    // exactly the container sits relative to the `Suspense` boundary is
    // App.tsx's decision and is argued there; this test asserts only that a
    // toast raised here becomes visible.)
    //
    // ORACLE: translations.ts for `pageLoadError`, and WAI-ARIA for the
    // container's accessible name ("Notifications", set by ToastContainer).
    localStorage.setItem('language', 'de');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));

    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: tr('termsOfUse', 'de') }));

    const message = await screen.findByText(tr('pageLoadError', 'de'));
    expect(screen.getByLabelText('Notifications')).toContainElement(message);
  });

  it('returns to the login screen from a legal page', async () => {
    // Guards the round trip: the footer link and the back control are the
    // only navigation the unauthenticated route has, and a provider mounted
    // per-branch would break the way back as readily as the way in.
    localStorage.setItem('language', 'de');
    stubDocumentFetch();

    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: tr('privacyPolicy', 'de') }));
    expect(await screen.findByRole('heading', { level: 1, name: tr('privacyPolicyTitle', 'de') }))
      .toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: new RegExp(tr('backToHome', 'de')) }));
    expect(await screen.findByRole('heading', { level: 1, name: tr('welcomeBack', 'de') }))
      .toBeInTheDocument();
  });
});
