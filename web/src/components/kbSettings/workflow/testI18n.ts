import { translations } from '../../../i18n/translations';

// Test helpers for the workflow suites, which render German through a mocked
// useTheme(). Assertions read the expected text from the translations rather
// than repeating literals, so a wording change cannot silently drift from them.

type Key = keyof typeof translations;

/** The German value of `key` with its `{placeholders}` filled in. */
export function de(key: Key, vars: Record<string, string | number> = {}): string {
  return Object.entries(vars).reduce(
    (s, [name, value]) => s.replace(`{${name}}`, String(value)),
    translations[key].de as string,
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A regex matching the German value of `key` anywhere in a text, with the
 * given placeholders filled in and every other one matching any run of
 * characters.
 */
export function deMatch(key: Key, vars: Record<string, string | number>): RegExp {
  const filled = de(key, vars);
  return new RegExp(filled.split(/\{\w+\}/).map(escapeRe).join('.+?'));
}

/**
 * A regex matching the German value of `key` anywhere in a text, with every
 * unfilled `{placeholder}` matching any run of characters. Several keys match
 * any one of them.
 */
export function deRe(...keys: Key[]): RegExp {
  return new RegExp(
    keys
      .map((k) => (translations[k].de as string).split(/\{\w+\}/).map(escapeRe).join('.+?'))
      .join('|'),
  );
}
