import type { Language } from '../../translations';

interface LanguageFlagProps {
  language: Language;
}

/**
 * The flag that stands for a UI language: Germany for German, the United
 * Kingdom for English. Drawn as SVG, not as a flag emoji — Windows renders
 * those as the letters „DE"/„GB". A circle: the middle square of the flag,
 * rounded. Decorative: the control that shows it
 * carries the accessible name.
 */
export function LanguageFlag({ language }: LanguageFlagProps) {
  return (
    <svg
      viewBox="10 0 40 40"
      width={20}
      height={20}
      aria-hidden="true"
      focusable="false"
      className="rounded-full"
    >
      {language === 'de' ? (
        <>
          <rect width="60" height="40" fill="#000" />
          <rect y="13.33" width="60" height="13.34" fill="#d00" />
          <rect y="26.67" width="60" height="13.33" fill="#ffce00" />
        </>
      ) : (
        <>
          <rect width="60" height="40" fill="#012169" />
          <path d="M0 0 60 40M60 0 0 40" stroke="#fff" strokeWidth="8" />
          <path d="M0 0 60 40M60 0 0 40" stroke="#c8102e" strokeWidth="3" />
          <path d="M30 0v40M0 20h60" stroke="#fff" strokeWidth="13" />
          <path d="M30 0v40M0 20h60" stroke="#c8102e" strokeWidth="8" />
        </>
      )}
    </svg>
  );
}
