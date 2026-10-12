import type { ComponentProps } from 'react';
import { stubViewport } from '../test/viewport';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LegalPage } from './LegalPage';
import { ToastProvider } from '../contexts/ToastContext';
import { ToastContainer } from './ToastContainer';
import { translations, type Language } from '../translations';

/* ---------------------------------------------------------------------------
 * There was no test on this file before card KI-693, which replaced its
 * hand-built page shell (five inline style objects, a raw <button> and a raw
 * <h1>) with the design system's `AuthLayout` template. Three things the
 * migration could have broken silently, and one it must keep guaranteeing:
 *
 *   1. the page heading — AuthLayout's `title` slot renders inside
 *      <CardTitle>, which is a <div>, so the <h1> now comes from the call
 *      site;
 *   2. the back control — a raw <button> became a DS <Button>, and it moved
 *      from above the heading into the card body;
 *   3. the loading state — a bare spinning <svg> became the DS <Spinner>;
 *   4. sanitisation — this file still injects fetched HTML through
 *      `dangerouslySetInnerHTML`, which the migration left untouched and
 *      which is worth pinning while there is a suite here at all.
 *
 * Oracles, all of them artifacts other than this component: the HTML Living
 * Standard through jsdom, WAI-ARIA, DOMPurify's documented default policy,
 * translations.ts, and a census of the PRE-migration source read out of git
 * at the card's claim base
 * (`git show 272a27d:web/src/components/LegalPage.tsx`).
 *
 * ToastContext is NOT mocked any more (card KI-740). It used to be replaced
 * wholesale — `vi.mock('../contexts/ToastContext', …)` — which meant the real
 * `useToast()` never ran here, and with it neither did its missing-provider
 * check. All six tests below passed while the page threw
 * `useToast must be used within ToastProvider` in the real app on every
 * unauthenticated visit, because production mounted `ToastProvider` on the
 * authenticated half of the tree only. The mock was not a shortcut, it was
 * the blind spot: every render below now goes through the REAL provider, the
 * REAL hook and the REAL container, so the wiring is part of what is asserted
 * rather than part of what is assumed. See `src/App.unauthenticated.test.tsx`
 * for the route-level guard.
 * ------------------------------------------------------------------------- */

// ThemeContext stays mocked, and hands back ONE stable object: `t` sits in the
// component's useEffect dependency list, so a fresh object per render would
// re-run the document fetch forever. (The real ToastProvider is safe in that
// respect — its `toast` API is a `useMemo` over `useCallback`s with no
// dependencies, so it is referentially stable across renders.)
const themeMock = {
  // Mutable on purpose, and reset to 'en' in beforeEach: the document-outline
  // suite at the bottom drives BOTH languages out of the asset tree, and the
  // object's IDENTITY has to stay stable (see above) while its `language`
  // changes, so this is a property write rather than a fresh object.
  language: 'en' as Language,
  t: (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
  },
};
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));

/**
 * The page under its real toast wiring — the provider plus the one container
 * that renders the queue — mirroring how App.tsx mounts both at the root.
 * Nothing here is a stand-in: a toast raised by the page is observable as
 * rendered text, which is what the failed-fetch test asserts.
 */
function renderLegalPage(props: ComponentProps<typeof LegalPage>) {
  return render(
    <ToastProvider>
      <LegalPage {...props} />
      <ToastContainer />
    </ToastProvider>,
  );
}

/** Resolves the document fetch with `html`; never touches the network. */
function stubFetch(html: string) {
  const fetchMock = vi.fn(() => Promise.resolve({ text: () => Promise.resolve(html) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A fetch that never settles, so the loading branch stays rendered. */
function stubPendingFetch() {
  const fetchMock = vi.fn(() => new Promise<{ text: () => Promise<string> }>(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  themeMock.language = 'en';
  // jsdom ships no matchMedia. The real ToastContainer's items call
  // useReducedMotion, which reads it, so rendering an actual toast needs it
  // stubbed (same pattern as HomeView.test.tsx / KbSettingsPanel.test.tsx).
  stubViewport();
});

describe('LegalPage — page structure', () => {
  it('renders the translated title as the page\'s only <h1>', async () => {
    // ORACLE: translations.ts for the expected string, and a census of the
    // pre-migration source at the claim base, which had exactly one <h1>
    // (line 84 of `git show 272a27d:web/src/components/LegalPage.tsx`).
    // Both are artifacts independent of this component.
    stubFetch('<p>Body</p>');
    const { container } = renderLegalPage({ page: 'privacy', onBack: vi.fn() });

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(translations.privacyPolicyTitle.en);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('fetches the document for the requested page and language', async () => {
    // ORACLE: the static file layout under web/public/legal/ — the four
    // documents per page exist as `<page>-<lang>.html`, so the path is
    // determined by the asset tree rather than by this component.
    const fetchMock = stubFetch('<p>Body</p>');
    renderLegalPage({ page: 'accessibility', onBack: vi.fn() });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/legal/accessibility-en.html'));
  });

  it('keeps the back control a button with its translated accessible name', async () => {
    // ORACLE: translations.ts (`backToHome`) plus the component's own prop
    // contract, which the pre-migration source exercised through a raw
    // <button onClick={onBack}>. The DS <Button> must still be a real button
    // — the census of the pre-migration file counts exactly one.
    stubFetch('<p>Body</p>');
    const onBack = vi.fn();
    const { container } = renderLegalPage({ page: 'terms', onBack });

    const back = await screen.findByRole('button', { name: new RegExp(translations.backToHome.en) });
    expect(back.tagName.toLowerCase()).toBe('button');
    expect(container.querySelectorAll('button')).toHaveLength(1);

    await userEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('announces the loading state as a live region', async () => {
    // ORACLE: WAI-ARIA 1.2 — `role="status"` is the live region for advisory
    // progress information, which the pre-migration spinning <svg> had no
    // way of exposing. The DS Spinner supplies it; this pins that the loading
    // branch actually renders one.
    stubPendingFetch();
    renderLegalPage({ page: 'terms', onBack: vi.fn() });

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});

describe('LegalPage — injected HTML', () => {
  it('strips scripts and event-handler attributes from the fetched document', async () => {
    // ORACLE: DOMPurify's documented default policy — <script> is not in the
    // default allow-list and `on*` attributes are always removed — plus the
    // HTML parser in jsdom. Both are third-party implementations, so this
    // asserts sanitisation against something other than the code that calls
    // it. The legal documents are static assets today, but they reach the DOM
    // through `dangerouslySetInnerHTML`, so the guarantee is worth pinning.
    stubFetch(
      '<p>Visible paragraph</p>'
      + '<script>globalThis.__legalPageXss = true;</script>'
      + '<img src="x" onerror="globalThis.__legalPageXss = true">'
      + '<a href="javascript:globalThis.__legalPageXss = true">link</a>',
    );
    const { container } = renderLegalPage({ page: 'terms', onBack: vi.fn() });

    expect(await screen.findByText('Visible paragraph')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect((globalThis as Record<string, unknown>).__legalPageXss).toBeUndefined();
  });

  it('reports a failed fetch through the toast API instead of an empty page', async () => {
    // ORACLE: ToastContext's published `ToastApi.error(message)` signature
    // (src/contexts/ToastContext.tsx) and translations.ts for the message.
    // Neither is derived from this component. The signature is now exercised
    // rather than asserted against a spy: the real provider stores what
    // `error(message)` was called with and the real ToastContainer renders it
    // verbatim, so the translated string showing up in the notification
    // region is the same claim the old `toHaveBeenCalledWith` made — plus the
    // proof that provider and container are actually wired to each other.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    renderLegalPage({ page: 'terms', onBack: vi.fn() });

    // ORACLE for the region: WAI-ARIA — `aria-label` is the container's
    // accessible name (ToastContainer sets "Notifications"), so the toast is
    // located the way an assistive technology would, not by CSS class.
    const message = await screen.findByText(translations.pageLoadError.en);
    expect(screen.getByLabelText('Notifications')).toContainElement(message);
  });

  it('throws instead of swallowing the failure when no ToastProvider is mounted', () => {
    /* ORACLE: the error message published by ToastContext's own `useToast`
     * (src/contexts/ToastContext.tsx) — a module other than this component.
     *
     * This pins the decision recorded on card KI-740: the throw is CORRECT
     * and must not be traded for a no-op hook. A `useToast` that returned
     * silent no-ops without a provider would stop this page from crashing and
     * start swallowing `toast.error(t('pageLoadError'))` above, so a legal
     * document that fails to load would show an empty page and say nothing.
     * The mounting is the thing that was wrong, and App.tsx is where it was
     * fixed; this test fails loudly if someone "fixes" it here instead.
     */
    stubFetch('<p>Body</p>');
    // React logs the render error through console.error before rethrowing.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<LegalPage page="terms" onBack={vi.fn()} />))
      .toThrow('useToast must be used within ToastProvider');

    consoleError.mockRestore();
  });
});

/* ---------------------------------------------------------------------------
 * The document outline, driven from the asset tree (cards KI-726 + KI-750).
 *
 * The defect: `document.querySelectorAll('h1').length` was **2** on every
 * legal route in the running app — the page's own title plus the `<h1>` each
 * document under public/legal/ carried. Two top-level headings give a
 * screen-reader user two competing "top of document" landmarks (WCAG 1.3.1),
 * on the very route where JustRAG publishes its accessibility statement.
 *
 * KI-750 made the page own the `<h1>` (the design system's `PageHeader`
 * renders a real heading) and demoted the documents to start at `<h2>`, which
 * is also what "make all three sites the same layout" asked for: `terms` and
 * `privacy` each carried an `<h1>`, `accessibility` started at `<h2>` — and
 * its first heading repeated `t('accessibilityTitle')` verbatim.
 *
 * ORACLES, none of them this component:
 *   - the six documents as they are actually SHIPPED, read off disk with
 *     `readdirSync` so a seventh document is covered the day it lands (this is
 *     the "drive it from the actual files rather than a hand-written list"
 *     that KI-726 asked for);
 *   - the WAI-ARIA heading role + level mapping, resolved by jsdom and queried
 *     through testing-library, which is where the COUNT comes from. A count
 *     fails in BOTH directions: a document that reinstates its `<h1>` gives 2,
 *     a page that loses its heading gives 0.
 *   - the loading state's `role="status"` (WAI-ARIA) as the signal that the
 *     document has actually been injected, so the count is never read off a
 *     page that is still showing the spinner.
 *
 * The fetch is stubbed with the file's REAL bytes and the requested URL is
 * asserted, so the content under test and the path the component asked for are
 * the same document — the stub cannot silently answer with the wrong file.
 * ------------------------------------------------------------------------- */
// Deliberately NOT `new URL('../../public/legal', import.meta.url)`: Vite
// recognises that exact pattern statically as an asset URL and rewrites it to
// a dev-server `http://localhost:…` URL, so `fileURLToPath` throws "The URL
// must be of scheme file". Same trap, same workaround as
// ChatView.composer.test.ts:9.
const LEGAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'legal');
const LEGAL_DOCUMENTS = readdirSync(LEGAL_DIR).filter(name => name.endsWith('.html')).sort();

describe('LegalPage — document outline', () => {
  it('covers every shipped legal document', () => {
    // Guards the driver itself: an empty or mis-resolved directory would make
    // every `it.each` below vacuous.
    expect(LEGAL_DOCUMENTS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(LEGAL_DOCUMENTS)('renders exactly one <h1> with %s injected', async file => {
    const [page, language] = file.replace('.html', '').split('-') as [
      ComponentProps<typeof LegalPage>['page'],
      Language,
    ];
    themeMock.language = language;
    const fetchMock = stubFetch(readFileSync(path.join(LEGAL_DIR, file), 'utf8'));

    renderLegalPage({ page, onBack: vi.fn() });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/legal/${file}`));
    // The spinner is the loading branch; its absence means the sanitised
    // document is in the DOM.
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // …and the document's own headings start one level below it, which is the
    // structural half of "the same layout" for all three routes.
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
  });
});
