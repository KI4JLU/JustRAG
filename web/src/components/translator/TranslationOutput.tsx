import { AlertCircleIcon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { Badge, cn, fieldVariants, Spinner } from '@ki4jlu/design-system';
import { textErrorMessage } from './languages';
import type { TranslatorLanguage } from './types';

interface TranslationOutputProps {
  /** Accessible name; leave it out when a visible label points at the output. */
  label?: string;
  pending: boolean;
  error: unknown;
  text: string | undefined;
  /** Language of the text, for screenreader pronunciation. */
  language?: TranslatorLanguage | null;
  /** The source text field, which the result belongs to. */
  htmlFor: string;
  className?: string;
}

/**
 * The result of a quick translation, or why there is none, said as the page says it. A polite live region: screenreaders
 * read the result or the error once it arrives, not the spinner in between.
 */
export function TranslationOutput({
  label,
  pending,
  error,
  text,
  language,
  htmlFor,
  className,
}: TranslationOutputProps) {
  const { t } = useTheme();
  // The page's words for the same failure.
  const message = error ? textErrorMessage(error, 'translate', t) : null;
  return (
    <output
      htmlFor={htmlFor}
      aria-live="polite"
      aria-busy={pending}
      aria-label={label}
      // Framed like the text field it answers: the DS field look, read-only.
      className={cn(fieldVariants(), 'block overflow-y-auto', className)}
    >
      {pending ? (
        <span className="flex size-full items-center justify-center">
          <Spinner label={t('translatorTranslating')} />
        </span>
      ) : message ? (
        <Badge appearance="text" tone="error">
          <AlertCircleIcon aria-hidden="true" className="size-4" />
          <span>{message}</span>
        </Badge>
      ) : text !== undefined ? (
        <span lang={language ?? undefined} dir="auto" className="block whitespace-pre-wrap break-words">
          {text}
        </span>
      ) : (
        <Badge appearance="text" tone="neutral">
          {t('translatorEmpty')}
        </Badge>
      )}
    </output>
  );
}
