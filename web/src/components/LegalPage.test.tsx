import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LegalPage } from './LegalPage';
import { translations } from '../translations';

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
 * ------------------------------------------------------------------------- */

// Both mocks hand back ONE stable object: `t` and `toast` sit in the
// component's useEffect dependency list, so a fresh object per render would
// re-run the document fetch forever.
const themeMock = {
  language: 'en' as const,
  t: (key: string) => {
    const entry = translations[key as keyof typeof translations];
    return entry ? entry.en : key;
  },
};
const toastMock = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => themeMock }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toastMock }));

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
});

describe('LegalPage — page structure', () => {
  it('renders the translated title as the page\'s only <h1>', async () => {
    // ORACLE: translations.ts for the expected string, and a census of the
    // pre-migration source at the claim base, which had exactly one <h1>
    // (line 84 of `git show 272a27d:web/src/components/LegalPage.tsx`).
    // Both are artifacts independent of this component.
    stubFetch('<p>Body</p>');
    const { container } = render(<LegalPage page="privacy" onBack={vi.fn()} />);

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(translations.privacyPolicyTitle.en);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('fetches the document for the requested page and language', async () => {
    // ORACLE: the static file layout under web/public/legal/ — the four
    // documents per page exist as `<page>-<lang>.html`, so the path is
    // determined by the asset tree rather than by this component.
    const fetchMock = stubFetch('<p>Body</p>');
    render(<LegalPage page="accessibility" onBack={vi.fn()} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/legal/accessibility-en.html'));
  });

  it('keeps the back control a button with its translated accessible name', async () => {
    // ORACLE: translations.ts (`backToHome`) plus the component's own prop
    // contract, which the pre-migration source exercised through a raw
    // <button onClick={onBack}>. The DS <Button> must still be a real button
    // — the census of the pre-migration file counts exactly one.
    stubFetch('<p>Body</p>');
    const onBack = vi.fn();
    const { container } = render(<LegalPage page="terms" onBack={onBack} />);

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
    render(<LegalPage page="terms" onBack={vi.fn()} />);

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
    const { container } = render(<LegalPage page="terms" onBack={vi.fn()} />);

    expect(await screen.findByText('Visible paragraph')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect((globalThis as Record<string, unknown>).__legalPageXss).toBeUndefined();
  });

  it('reports a failed fetch through the toast API instead of an empty page', async () => {
    // ORACLE: ToastContext's published `ToastApi.error(message)` signature
    // (src/contexts/ToastContext.tsx) and translations.ts for the message.
    // Neither is derived from this component.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<LegalPage page="terms" onBack={vi.fn()} />);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(translations.pageLoadError.en));
  });
});
