import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import { Button, Logo } from '@ki4jlu/design-system';
import Login from './Login';
import { API_BASE_URL } from './api';

/* ---------------------------------------------------------------------------
 * Card KI-719. Two things about the login page's presentation were wrong and
 * nothing pinned either of them:
 *
 *   1. the `logo` slot fell back to a generic lucide <BookOpen> instead of the
 *      design system's `Logo` wordmark, while the operator-uploaded image
 *      branch (`siteConfigs.logo_path`) is deliberately kept as an override;
 *   2. the OIDC button was `variant="outline"`, i.e. styled as a secondary
 *      alternative, even though on an SSO-only deployment it is the page's
 *      ONLY control (`showPasswordForm` is false when local auth and LDAP are
 *      both off and the route is not /admin).
 *
 * Every oracle here is the design-system package itself, rendered
 * independently in this file — never a class string or a text literal copied
 * out of Login.tsx. If the DS restyles `Logo` or `Button`, these tests
 * re-derive the expectation instead of going stale.
 *
 * `t` returns the translation KEY rather than a translated string (same
 * pattern as Login.test.tsx). That keeps the page's own copy out of the way:
 * a German or English sentence that happened to contain "RAG" would otherwise
 * make the wordmark assertion vacuous.
 * ------------------------------------------------------------------------- */

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

// Login pulls in useReducedMotion which calls window.matchMedia,
// not available in jsdom by default.
vi.mock('./hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
  getMotionProps: () => ({}),
}));

vi.mock('./contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light' as const,
    resolvedTheme: 'light' as const,
    setTheme: () => {},
    language: 'en' as const,
    setLanguage: () => {},
    t: (key: string) => key,
  }),
}));

const mockedGet = axios.get as unknown as Mock;

/**
 * Render a design-system component into a DETACHED container, so it is an
 * oracle and not a second match for `screen` queries.
 */
function renderReference(node: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  render(node, { container });
  return container;
}

function renderLogin(siteConfigs: Record<string, string> = {}) {
  return render(<Login onLogin={vi.fn()} siteConfigs={siteConfigs} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
  mockedGet.mockResolvedValue({ data: { providers: [], localAuthEnabled: true } });
});

describe('Login — the brand wordmark in AuthLayout\'s logo slot', () => {
  it('renders the design system Logo as readable text when no logo is uploaded', async () => {
    // ORACLE: the installed @ki4jlu/design-system's own `Logo`, rendered
    // standalone in this test. Its documented contract is that it renders the
    // lockup as REAL TEXT — prefix plus product, "screen readers read it
    // naturally, no aria needed" (dist/components/logo.d.ts) — which is the
    // entire advantage over an image, and the property a lucide <BookOpen>
    // (an aria-hidden <svg> with no text at all) does not have.
    //
    // The expected string is taken from that standalone render, so nothing
    // here restates a literal from Login.tsx and a DS wordmark change does
    // not silently break this test.
    const reference = renderReference(<Logo product="RAG" size="lg" />);
    const wordmark = reference.textContent ?? '';
    // Guard against a vacuous pass: the oracle must actually carry both parts.
    expect(wordmark).toContain('JLU');
    expect(wordmark).toContain('RAG');

    const { container } = renderLogin({});
    await screen.findByLabelText('username');

    // The product badge is addressable as text content, not as an image.
    const badge = await screen.findByText('RAG');
    expect(badge.tagName.toLowerCase()).not.toBe('img');
    // ...and the full lockup, prefix included, is on the page.
    expect(container.textContent).toContain(wordmark);

    // No uploaded image is rendered in this state.
    expect(screen.queryByAltText('Site Logo')).toBeNull();
  });

  it('lets an uploaded logo_path override the wordmark', async () => {
    // ORACLE: the site-config contract on the Go side — `logo_path` is an
    // operator-uploaded asset served under API_BASE_URL, and keeping it as an
    // override was an explicit developer decision on KI-719 rather than an
    // oversight. This test exists so the override cannot regress silently
    // when the fallback changes: it asserts the <img> and its src, and that
    // the DS wordmark is NOT additionally rendered.
    const { container } = renderLogin({ logo_path: '/uploads/site-logo-fixture.png' });
    await screen.findByLabelText('username');

    const img = screen.getByAltText('Site Logo');
    expect(img.tagName.toLowerCase()).toBe('img');
    expect(img).toHaveAttribute('src', `${API_BASE_URL}/uploads/site-logo-fixture.png`);

    // The two branches are exclusive: the wordmark must be absent here.
    const wordmark = renderReference(<Logo product="RAG" size="lg" />).textContent ?? '';
    expect(container.textContent).not.toContain(wordmark);
    expect(screen.queryByText('RAG')).toBeNull();
  });
});

describe('Login — the OIDC button is the primary action', () => {
  it('carries the DS Button `default` variant, not `outline`', async () => {
    // ORACLE: the design system's own `Button`, rendered standalone here in
    // both variants with the same layout className the call site uses. The
    // expected class set is therefore produced by the DS package (its
    // `buttonVariants` table plus its `cn`/tailwind-merge pass), not copied
    // out of Login.tsx, and a DS restyle re-derives it.
    //
    // WEAK-ORACLE CAVEAT, stated deliberately: a DS button variant has no
    // observable effect in jsdom other than the class list. jsdom applies no
    // Tailwind stylesheet, so `getComputedStyle` returns the same values for
    // every variant, and the variant is not reflected in any attribute, role
    // or accessible property. Comparing against a reference render is the
    // strongest form available here — it removes the hardcoded class string,
    // but it cannot escape being a class comparison. What this test genuinely
    // pins is "the same variant the DS calls `default`"; whether `default`
    // reads as the primary action is a visual judgement and stays the
    // developer's both-theme QA.
    mockedGet.mockResolvedValue({
      data: { providers: [{ id: 'p1', type: 'oidc', name: 'Azure AD' }], localAuthEnabled: false },
    });

    const refClass = (variant: 'default' | 'outline') =>
      renderReference(
        <Button asChild variant={variant} className="w-full">
          <a href="https://reference.invalid/">reference</a>
        </Button>,
      ).querySelector('a')!.className;

    const expected = refClass('default');
    const rejected = refClass('outline');
    // Guard against a vacuous pass: the two variants must be distinguishable
    // at all. If the DS ever collapsed them this assertion fails loudly
    // instead of the test passing either way.
    expect(expected).not.toBe(rejected);

    renderLogin({});
    const link = await screen.findByRole('link', { name: /Azure AD/ });

    expect(link.className).toBe(expected);
    expect(link.className).not.toBe(rejected);
  });
});
