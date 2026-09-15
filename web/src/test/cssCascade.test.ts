import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findShadowedUtilities } from '../../scripts/check-css-cascade.mjs';

/* ---------------------------------------------------------------------------
 * Tests for the cascade-layer guard (card KI-780).
 *
 * THE ORACLE is the CSS Cascade Layers specification, applied by hand to
 * fixtures small enough to reason about in full. Every expectation below is a
 * statement about which rule a browser must apply — derived from the spec's
 * rule that layer precedence is resolved BEFORE specificity and before source
 * order, and that unlayered declarations sort above every named layer. Nothing
 * here compares the checker against output the checker produced.
 *
 * The first fixture is the real defect, reduced: it is the shape
 * `web/src/index.css` had at c9b7626, and a browser genuinely rendered
 * `display: flex` for `<div class="flex lg:hidden">` at 1280px because of it.
 *
 * The last test is the live one — it runs the checker over the actual
 * `src/index.css` SOURCE. That file carries no generated utilities, so it can
 * only ever find a collision against a hand-written `@layer utilities` block;
 * the authoritative check is the one `npm run build` runs over the emitted
 * bundle, where Tailwind's ~485 utility selectors are present. Keeping it here
 * is what makes `npm test` fail fast when someone re-adds an unlayered
 * duplicate right next to a layered one in the same file.
 * ------------------------------------------------------------------------- */

const THE_DEFECT = `
@layer theme, base, components, utilities;
@layer utilities {
  .flex { display: flex; }
  @media (min-width: 64rem) {
    .lg\\:hidden { display: none; }
  }
}
.flex { display: flex; }
`;

describe('findShadowedUtilities', () => {
  it('flags the KI-780 defect: an unlayered .flex beating @layer utilities', () => {
    // A browser applies the unlayered `.flex` over BOTH layered rules, so
    // `class="flex lg:hidden"` computes to display:flex at 1280px. That is the
    // bug, and it must be reported.
    expect(findShadowedUtilities(THE_DEFECT)).toEqual([
      { selector: '.flex', condition: '(unconditional)' },
    ]);
  });

  it('passes the same stylesheet once the unlayered duplicate is gone', () => {
    const fixed = THE_DEFECT.replace(/\n\.flex \{ display: flex; \}\n$/, '\n');
    expect(fixed).not.toBe(THE_DEFECT);
    expect(findShadowedUtilities(fixed)).toEqual([]);
  });

  it('flags a conditional shadow too — a media query does not escape layer order', () => {
    // `@media (prefers-reduced-motion: reduce) { .animate-spin { … } }` at the
    // top level still outranks every rule in `utilities`, including
    // `lg:animate-spin`. It is reported with its condition so the fix (wrap it
    // in `@layer utilities`) is obvious from the message.
    const css = `
@layer utilities { .animate-spin { animation: var(--animate-spin); } }
@media (prefers-reduced-motion: reduce) { .animate-spin { animation: none; } }
`;
    expect(findShadowedUtilities(css)).toEqual([
      { selector: '.animate-spin', condition: '@media (prefers-reduced-motion: reduce)' },
    ]);
  });

  it('accepts an override that is wrapped in the utilities layer', () => {
    // Inside one layer the later rule wins at equal specificity, and it does
    // NOT outrank the layer's variants. That is the sanctioned escape hatch,
    // so it must not be reported.
    const css = `
@layer utilities { .animate-spin { animation: var(--animate-spin); } }
@layer utilities {
  @media (prefers-reduced-motion: reduce) { .animate-spin { animation: none; } }
}
`;
    expect(findShadowedUtilities(css)).toEqual([]);
  });

  it('leaves application CSS alone — only NAME COLLISIONS are the defect', () => {
    // `.notebook-container` is unlayered on purpose and outranks utilities on
    // purpose. A checker that flagged every unlayered rule would be unusable
    // against a 2400-line application stylesheet.
    const css = `
@layer utilities { .flex { display: flex; } }
.notebook-container { display: flex; height: 100vh; }
body { margin: 0; }
`;
    expect(findShadowedUtilities(css)).toEqual([]);
  });

  it('does not mistake @keyframes steps for selectors', () => {
    // `0%` / `to` parse as rules. `to` is also a valid type selector, so a
    // naive walk could pair it with a `to` rule elsewhere.
    const css = `
@layer utilities { to { display: flex; } }
@keyframes spin { to { transform: rotate(360deg); } }
`;
    expect(findShadowedUtilities(css)).toEqual([]);
  });

  it('splits selector lists, so a shadow hiding in a group is still found', () => {
    const css = `
@layer utilities { .hidden { display: none; } }
.sidebar, .hidden { display: block; }
`;
    expect(findShadowedUtilities(css)).toEqual([
      { selector: '.hidden', condition: '(unconditional)' },
    ]);
  });

  it('reports each (selector, condition) pair once, not once per duplicate', () => {
    const css = `
@layer utilities { .flex { display: flex; } }
.flex { display: flex; }
.flex { display: flex; }
`;
    expect(findShadowedUtilities(css)).toHaveLength(1);
  });

  it('web/src/index.css declares no unlayered shadow of its own @layer blocks', () => {
    // Resolved from the cwd rather than from `import.meta.url`: under the
    // jsdom project that is an http:// URL, not a file one.
    const fromWeb = resolve('src/index.css');
    const fromRepoRoot = resolve('web/src/index.css');
    const path = existsSync(fromWeb) ? fromWeb : fromRepoRoot;
    const indexCss = readFileSync(path, 'utf8');
    expect(findShadowedUtilities(indexCss)).toEqual([]);
  });
});
