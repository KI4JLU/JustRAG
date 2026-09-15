import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ThemeProvider as DesignSystemThemeProvider, type Theme, type ResolvedTheme } from '@ki4jlu/design-system';
import { useThemeAndLanguage } from '../hooks/useThemeAndLanguage';
import type { Language } from '../translations';

/**
 * Theme + language for the whole app.
 *
 * TRI-STATE SINCE KI-779. `theme` is the user's choice out of
 * `light | dark | system`; `resolvedTheme` is what is actually painted
 * (`light | dark`). The old `toggleTheme()` is gone — there is a real
 * `setTheme(t)` now, because the design system's `ThemeToggle` is a
 * three-option group and a two-state model would leave its middle option
 * permanently unpressable. (Until design-system 0.25.0 that toggle was
 * rendered by `AppShellLayout` itself; since 0.26.0 the consumer mounts it —
 * `AppChrome`'s sidebar footer, card KI-788 — which changes who renders it,
 * not what it needs from this provider.)
 *
 * WHY THE DS PROVIDER IS MOUNTED HERE RATHER THAN REIMPLEMENTED.
 * `@ki4jlu/design-system`'s `ThemeProvider` documents itself as the sole
 * writer of `<html data-theme>`. Resolving `system` a second time in this file
 * would put two writers on one attribute and two readers on one localStorage
 * key, and they could disagree. So it is mounted in UNCONTROLLED mode — no
 * `theme` prop, no `onThemeChange` — which makes it own both the choice and
 * its persistence, under its default `storageKey` of `"theme"`. That default
 * is already the key this app has always used, so no key migration exists and
 * no stored value is rewritten on mount (see the migration note in
 * hooks/useThemeAndLanguage.ts).
 *
 * Controlled mode was considered and rejected on the card: it would have kept
 * the app's state as the source of truth, which is exactly the second
 * implementation this avoids.
 *
 * WHY TWO COMPONENTS. `useThemeAndLanguage` calls the DS `useTheme()`, which
 * throws unless a DS `ThemeProvider` is an ANCESTOR — so it cannot run in the
 * same component that renders the provider. `ThemeAndLanguageBridge` is that
 * one level of nesting and nothing else.
 *
 * The i18n half (`language` / `setLanguage` / `t`) is untouched by KI-779 and
 * still lives in `useThemeAndLanguage`.
 */
interface ThemeContextValue {
  /** The user's choice: light, dark, or follow the OS. */
  theme: Theme;
  /** What is painted right now — `system` already resolved. Use this for anything visual. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function ThemeAndLanguageBridge({ children }: { children: ReactNode }) {
  const { theme, resolvedTheme, setTheme, language, setLanguage, t } = useThemeAndLanguage();

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, language, setLanguage, t }),
    [theme, resolvedTheme, setTheme, language, setLanguage, t]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <DesignSystemThemeProvider>
      <ThemeAndLanguageBridge>{children}</ThemeAndLanguageBridge>
    </DesignSystemThemeProvider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
