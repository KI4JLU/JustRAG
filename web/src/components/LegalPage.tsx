import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import DOMPurify from 'dompurify';
import { AuthLayout, Button, Spinner } from '@ki4jlu/design-system';
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
   * Shell: the design system's AuthLayout template (card KI-693). This and
   * Login are the app's only unauthenticated surfaces, so they share the
   * template's frame rather than two hand-built ones. The template's slot API
   * is documented at the top of ../Login.tsx.
   *
   * Everything this file used to build by hand — full-height page, page
   * background, horizontal centring, the content column, the page padding —
   * is the template's root and inner Stack, so all five inline style objects
   * are deleted. No inline style survives in this file.
   *
   * Two visual consequences only the developer's both-theme QA can accept:
   *   1. The content column narrows from a hand-set 720px to the template's
   *      `max-w-md` (448px), which is hardcoded on its inner Stack and is
   *      therefore NOT reachable through `className`. At 16px that is roughly
   *      55 characters per line, i.e. inside the 45-75 measure, where 720px
   *      was above it — but it is still a large change for a legal document,
   *      and the document now sits in a card.
   *      TODO: if 448px is too narrow here, the fix is a width prop on the
   *      template in the design system, not an override at this call site.
   *   2. The "back" control moves from above the heading to directly below
   *      it, because the heading is now the template's card header and the
   *      slot order is fixed.
   * ----------------------------------------------------------------------- */
  return (
    <main>
      <AuthLayout
        /* See ../Login.tsx: CardTitle is a <div>, so the <h1> comes from the
         * call site, and the two type classes neutralise index.css's
         * `@layer base` h1 revert rather than re-skinning the template. */
        title={<h1 className="m-0 text-headline-md font-semibold">{t(titleKeys[page])}</h1>}
      >
        <Button variant="link" size="sm" onClick={onBack} className="px-0">
          <ArrowLeft size={16} />
          {t('backToHome')}
        </Button>

        {loading ? (
          <div className="flex justify-center py-stack-lg">
            <Spinner size="lg" label={t('loading')} />
          </div>
        ) : (
          <div
            className="content-fade-in mt-stack-md text-body-base text-on-surface-variant"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
          />
        )}
      </AuthLayout>
    </main>
  );
}
