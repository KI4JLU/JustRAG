import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translations } from '../i18n/translations';

/* ---------------------------------------------------------------------------
 * Guard for user-facing error messages (docs/user-error-messages.md).
 *
 * The web client never shows a backend's `error` text: every failed request
 * goes through userErrorMessage with a feature-specific fallbackKey. Two
 * invariants over the non-test sources under web/src:
 *   1. getApiErrorMessage — the helper that surfaced `response.data.error` —
 *      is gone and stays gone.
 *   2. Every `fallbackKey: '<key>'` literal names a translation with a German
 *      and an English text, so a refusal never shows a bare key.
 * The oracle for (2) is the translations table, not anything computed here.
 * Per-feature behaviour (uncoded 400/404 → the fallback, raw text absent) is
 * pinned by each feature's own *.errors.test / component test.
 * ------------------------------------------------------------------------- */

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = sources(SRC).map(p => ({ rel: path.relative(SRC, p), text: readFileSync(p, 'utf8') }));

describe('user error guard', () => {
  it('scans the sources (a green run must not mean an empty walk)', () => {
    expect(files.some(f => f.rel === path.join('utils', 'userErrors.ts'))).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no getApiErrorMessage left', () => {
    expect(files.filter(f => f.text.includes('getApiErrorMessage')).map(f => f.rel)).toEqual([]);
  });

  it('gives every fallbackKey a German and an English text', () => {
    const missing: string[] = [];
    let seen = 0;
    for (const f of files) {
      for (const m of f.text.matchAll(/fallbackKey: '(\w+)'/g)) {
        seen++;
        const entry = translations[m[1] as keyof typeof translations] as { de?: string; en?: string } | undefined;
        if (!entry?.de || !entry?.en) missing.push(`${f.rel}: ${m[1]}`);
      }
    }
    expect(seen).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });
});
