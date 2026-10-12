import { useState, useEffect, useCallback } from 'react';
import { useTheme as useDesignSystemTheme, type Theme, type ResolvedTheme } from '@ki4jlu/design-system';
import { translations, type Language } from '../translations';

/**
 * The app's theme + language hook.
 *
 * THEME IS NOT OWNED HERE ANY MORE (card KI-779). It is read straight from the
 * design system's `ThemeProvider`, mounted in uncontrolled mode by
 * `src/contexts/ThemeContext.tsx`. That provider documents itself as the sole
 * writer of `<html data-theme>`, and it already implements the tri-state
 * `light | dark | system` model the DS `ThemeToggle` renders — so a second
 * implementation here would be a second source of truth for the same attribute
 * and the same localStorage key. It also keeps the OS-follow subscription
 * (`matchMedia('(prefers-color-scheme: dark)')` change events) in one place.
 *
 * Consequence for callers: this hook now REQUIRES a DS `ThemeProvider` above
 * it — `useDesignSystemTheme()` throws "useTheme must be used within a
 * ThemeProvider" otherwise. In the app that is guaranteed by
 * `contexts/ThemeContext.tsx`; in a test, render it under that provider.
 *
 * `theme` is the user's CHOICE (`light | dark | system`); `resolvedTheme` is
 * what is actually applied (`light | dark`). Anything that paints — an icon,
 * a nested `data-theme`, a chart palette — must read `resolvedTheme`. `theme`
 * is only for a control that shows which of the three options is selected.
 *
 * STORAGE MIGRATION (decided on KI-779, asserted in useThemeAndLanguage.test.ts):
 * `localStorage['theme']` keeps its key and its existing values. The DS
 * provider accepts `'light'` and `'dark'` verbatim and only falls back to
 * `'system'` for anything it does not recognise — so a returning user who ever
 * pressed the old two-state toggle KEEPS their pinned choice, and only users
 * with no stored value (or a junk one) land on `system`. Nothing rewrites the
 * key on mount; it changes only when the user picks a theme. There is
 * therefore no migration step and no window in which a user's pin is lost.
 *
 * The LANGUAGE half is unchanged and still owned here.
 */
export function useThemeAndLanguage() {
  const { theme, resolvedTheme, setTheme } = useDesignSystemTheme();

  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('language');
    return (saved === 'en' || saved === 'de') ? saved : 'de';
  });

  useEffect(() => {
    document.documentElement.lang = language; // screen-reader pronunciation tracks DE/EN toggle
    localStorage.setItem('language', language);
  }, [language]);

  const t = useCallback((key: string) => {
    return translations[key as keyof typeof translations]?.[language] || key;
  }, [language]);

  return { theme, resolvedTheme, setTheme, language, setLanguage, t };
}

export type { Theme, ResolvedTheme };
