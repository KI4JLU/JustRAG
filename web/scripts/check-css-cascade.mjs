#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Cascade-layer guard for the shipped stylesheet (card KI-780).
 *
 * THE BUG THIS EXISTS FOR
 * `web/src/index.css` hand-declared `.flex { display: flex }` outside every
 * `@layer`. An unlayered rule outranks every rule in a named layer — the CSS
 * cascade settles layer precedence BEFORE specificity and before source order,
 * and a media query does not change that. So the unlayered `.flex` beat
 * `@layer utilities`'s `.lg\:hidden { display: none }` at every viewport
 * width, in the dev server and in the production bundle alike, and the design
 * system's `… flex items-center … lg:hidden` mobile bar never hid. Twelve
 * utilities were shadowed that way; every `lg:`/`md:`/`hover:` variant of each
 * one was dead.
 *
 * THE INVARIANT
 * No rule outside all `@layer`s may use a selector that the stylesheet also
 * emits inside `@layer utilities`. That is a pure structural fact about one
 * compiled file — no list of Tailwind class names to maintain, no heuristic,
 * nothing to keep in sync with a Tailwind upgrade. If Tailwind stops emitting
 * a utility, the collision stops existing on its own.
 *
 * It is deliberately narrower than "no unlayered rules": this stylesheet is
 * ~2400 lines of intentionally unlayered application CSS (`.notebook-container`,
 * `.btn`, `body`, …) that outranks utilities on purpose. Only NAME COLLISIONS
 * with the utility layer are the defect.
 *
 * WHERE IT RUNS
 * Last step of `npm run build --prefix web`, so CI's build job fails on a
 * reintroduction. It reads the emitted bundle, not the source, so it also
 * covers anything a plugin or a dependency's CSS injects.
 *
 * LIMIT, stated plainly: it compares within one file at a time. A shadow
 * split across two separate CSS bundles would not be seen. The app emits a
 * single stylesheet today, and a second one appearing is itself a change worth
 * noticing.
 * ------------------------------------------------------------------------- */
import postcss from 'postcss';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks up a node's ancestry and reports the at-rule context it sits in.
 * @param {import('postcss').Node} node
 * @returns {{ layers: string[], conditions: string[] }}
 */
function atRuleContext(node) {
  const layers = [];
  const conditions = [];
  for (let p = node.parent; p; p = p.parent) {
    if (p.type !== 'atrule') continue;
    // A conditional group rule can carry its own anonymous layer; `params`
    // being empty is exactly that case, and it is still a layer.
    if (p.name === 'layer') layers.unshift(p.params || '<anonymous>');
    else conditions.unshift(`@${p.name} ${p.params}`.trim());
  }
  return { layers, conditions };
}

/**
 * @param {string} css
 * @param {string} [layerName]
 * @returns {{ selector: string, condition: string }[]} one entry per
 *   unlayered rule whose selector is also emitted inside `layerName`.
 */
export function findShadowedUtilities(css, layerName = 'utilities') {
  const root = postcss.parse(css);

  /** @type {Set<string>} */
  const layered = new Set();
  /** @type {{ selector: string, condition: string }[]} */
  const unlayered = [];

  root.walkRules((rule) => {
    // `@keyframes` percentage steps parse as rules; they are not selectors.
    for (let p = rule.parent; p; p = p.parent) {
      if (p.type === 'atrule' && /keyframes$/.test(p.name)) return;
    }
    const { layers, conditions } = atRuleContext(rule);
    if (layers.includes(layerName)) {
      for (const sel of rule.selectors) layered.add(sel.trim());
    } else if (layers.length === 0) {
      for (const sel of rule.selectors) {
        unlayered.push({
          selector: sel.trim(),
          condition: conditions.join(' > ') || '(unconditional)',
        });
      }
    }
  });

  const seen = new Set();
  return unlayered.filter((u) => {
    if (!layered.has(u.selector)) return false;
    const key = `${u.selector}|${u.condition}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {string[]} files
 * @returns {number} process exit code
 */
export function checkFiles(files) {
  let failed = 0;
  for (const file of files) {
    const shadows = findShadowedUtilities(fs.readFileSync(file, 'utf8'));
    if (shadows.length === 0) {
      console.log(`ok  ${file} — no unlayered rule shadows @layer utilities`);
      continue;
    }
    failed += shadows.length;
    console.error(`\nFAIL  ${file}`);
    console.error(
      `  ${shadows.length} unlayered rule(s) shadow a selector that is also emitted inside @layer utilities.`
    );
    console.error(
      '  An unlayered rule outranks every layered one, so each of these silently'
    );
    console.error(
      '  disables EVERY variant (lg:, md:, hover:, …) of that utility:\n'
    );
    for (const s of shadows) {
      console.error(`    ${s.selector}   [${s.condition}]`);
    }
    console.error(
      '\n  Fix: delete the hand-written copy (Tailwind already emits it), or wrap'
    );
    console.error(
      '  the override in `@layer utilities { … }` so it wins by source order'
    );
    console.error('  instead of by layer precedence. See card KI-780.');
  }
  return failed === 0 ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const args = process.argv.slice(2);
  let files = args;
  if (files.length === 0) {
    const assets = path.resolve('dist/assets');
    if (!fs.existsSync(assets)) {
      console.error(
        `check-css-cascade: ${assets} does not exist — run this after \`vite build\`, ` +
          'or pass CSS file paths explicitly.'
      );
      process.exit(1);
    }
    files = fs
      .readdirSync(assets)
      .filter((f) => f.endsWith('.css'))
      .map((f) => path.join(assets, f));
  }
  if (files.length === 0) {
    console.error(
      'check-css-cascade: no .css file found in dist/assets — the build emitted ' +
        'no stylesheet, which is itself wrong. Refusing to pass vacuously.'
    );
    process.exit(1);
  }
  process.exit(checkFiles(files));
}
