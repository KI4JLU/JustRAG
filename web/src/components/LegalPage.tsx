import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Button, Container, PageHeader, Spinner } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import type { Language } from '../translations';

type LegalPageType = 'terms' | 'privacy' | 'accessibility';

interface LegalPageProps {
  page: LegalPageType;
  onBack: () => void;
}

const titleKeys: Record<LegalPageType, string> = {
  terms: 'termsOfUseTitle',
  privacy: 'privacyPolicyTitle',
  accessibility: 'accessibilityTitle',
};

const htmlFiles: Record<LegalPageType, Record<Language, string>> = {
  terms: { de: '/legal/terms-de.html', en: '/legal/terms-en.html' },
  privacy: { de: '/legal/privacy-de.html', en: '/legal/privacy-en.html' },
  accessibility: { de: '/legal/accessibility-de.html', en: '/legal/accessibility-en.html' },
};

export function LegalPage({ page, onBack }: LegalPageProps) {
  const { t, language } = useTheme();
  const toast = useToast();
  // Loaded content is keyed by page+language; `loading` is derived during
  // render (no synchronous setState in the effect — state only changes in the
  // fetch continuations).
  const [loaded, setLoaded] = useState<{ key: string; html: string } | null>(null);
  const contentKey = `${page}:${language}`;
  const loading = loaded?.key !== contentKey;
  const html = loaded?.key === contentKey ? loaded.html : '';

  useEffect(() => {
    let cancelled = false;
    const key = `${page}:${language}`;
    fetch(htmlFiles[page][language])
      .then(res => res.text())
      .then(text => { if (!cancelled) setLoaded({ key, html: text }); })
      .catch(() => {
        if (cancelled) return;
        setLoaded({ key, html: '' });
        toast.error(t('pageLoadError'));
      });
    return () => { cancelled = true; };
  }, [page, language, t, toast]);

  /* -------------------------------------------------------------------------
   * Shell: `Container` + `PageHeader` — the design system's PAGE shape (card
   * KI-750). This replaces `AuthLayout`, which Stage 4a (KI-693) had picked
   * and which the developer rejected five times running.
   *
   * WHY THE TEMPLATE WAS WRONG, measured on the running dev server at a
   * 1600px viewport (walking getComputedStyle up from the <h1>, full chain on
   * KI-750): `AuthLayout` produced
   *
   *   div  flex flex-col gap-1.5 p-6 text-center                      670px
   *   div  rounded-xl border … bg-surface-container-lowest            672px
   *   div  flex flex-col gap-stack-lg w-full max-w-2xl   max-width:   672px
   *   div  flex min-h-dvh … items-center justify-center              1600px
   *
   * i.e. three credential-entry shapes, none of them reachable by changing a
   * width: the document sat INSIDE a Card, its title was `text-center`, and
   * the whole thing was vertically centred in the viewport. That is what
   * "a small mobile-styled container instead of a full page view" described,
   * and it is why KI-743's correct 448 -> 672px widening did not fix it.
   * Widening a card cannot make it a page.
   *
   * THE WIDTH. `size="content"` is 1000px
   * (`--max-width-container-content`) — the same 1000px as
   * `.home-view__grid--main` (HomeView.css:246), which is the width the
   * developer asked these pages to match. It is a NAMED size, shipped by the
   * design system in v0.25.0 (card KI-751) precisely so this call site does
   * not need `className="max-w-[1000px]"`: KI-711 records that
   * `layout-only-classname` structurally cannot see arbitrary values on
   * composition components like `Container`, so an override here would have
   * passed lint silently. The size scale names a ROLE, not a step —
   * `page` (1440px) / `content` (1000px) / `reading` (672px).
   *
   * THE HEADING. `PageHeader` renders a real heading element (level 1 by
   * default), so the hand-rolled `<h1 className="m-0 text-headline-md …">`
   * that `AuthLayout`'s `div`-based `CardTitle` forced on every call site is
   * gone, and so is the `m-0` that neutralised index.css's
   * `@layer base { h1 { margin: revert } }` — v0.24.0 put that inside the
   * component. This page therefore owns THE page's only `<h1>`, and the six
   * documents under public/legal/ start at `<h2>` (card KI-726, done in the
   * same change: with a real PageHeader the two headings would sit adjacent
   * and the page would ship visibly broken).
   *
   * THE BACK CONTROL sits in `PageHeader`'s `actions` slot — the header row's
   * right-hand side — as an `outline` Button rather than the previous
   * `variant="link" className="px-0"`. A link-styled control was right when
   * it sat inside the card body above the prose; in the header's action area
   * it would read as a stray piece of body text next to the page title, and
   * `outline` is the quiet-but-real control the DS offers for a secondary
   * page action.
   *
   * `<main>` stays the landmark and now carries the page ground
   * (`min-h-dvh bg-surface text-on-surface`) that `AuthLayout`'s root used to
   * supply; `Container` brings the horizontal page margins
   * (`px-gutter md:px-margin-page`) and the call site adds the matching
   * vertical ones — the same combination `DashboardLayout` uses internally,
   * so the legal routes are laid out like every other page of this app.
   * ----------------------------------------------------------------------- */
  return (
    <main className="min-h-dvh bg-surface text-on-surface">
      <Container size="content" className="flex flex-col gap-stack-lg py-gutter md:py-margin-page">
        <PageHeader
          title={t(titleKeys[page])}
          actions={
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft size={16} />
              {t('backToHome')}
            </Button>
          }
        />

        {loading ? (
          <div className="flex justify-center py-stack-lg">
            <Spinner size="lg" label={t('loading')} />
          </div>
        ) : (
          <div
            className="content-fade-in text-body-base text-on-surface-variant"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
          />
        )}
      </Container>
    </main>
  );
}
