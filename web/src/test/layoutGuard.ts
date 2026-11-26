import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import postcss from 'postcss';

/* ---------------------------------------------------------------------------
 * Layout lives in the design system (DS docs, "Page templates").
 *
 * JustRAG composes its views from the DS layouts (AppShellLayout, ChatStage,
 * GridLayout, …) and does not build layout of its own in CSS. Hand-built
 * geometry drifted from the DS before: the chat column's keep-clear offset was
 * copied per element in index.css, two elements were missed, and the chat lost
 * its centre axis when the sources card opened.
 *
 * Three rules over every stylesheet under src/:
 *   1. No selector on a DS element (`[data-slot…]`): the DS owns its parts.
 *   2. No DS layout variable (`--chat-*`, `--app-shell-*`): those are the DS
 *      layouts' own arithmetic.
 *   3. Layout geometry (sizes, offsets, positioning, grid tracks) only where it
 *      already was: layoutGuard.baseline.json lists each remaining declaration. A new
 *      one fails — build it in the DS, or with the DS components. A removed
 *      one fails too, until its line leaves the baseline. The test cannot see
 *      the base branch: adding a line here is the one way to add geometry,
 *      and a PR that does so needs a reason in its description.
 * ------------------------------------------------------------------------- */

export const GEOMETRY_PROPS = new Set([
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'inline-size', 'min-inline-size', 'max-inline-size', 'block-size', 'min-block-size', 'max-block-size',
  'position', 'inset', 'top', 'right', 'bottom', 'left',
  'inset-inline', 'inset-inline-start', 'inset-inline-end', 'inset-block', 'inset-block-start', 'inset-block-end',
  'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
]);

/** An attribute selector on `data-slot` itself (not `data-slot-helper`). */
const DATA_SLOT = /\[\s*data-slot\s*(?:[~|^$*]?=|\])/;

const DS_VARIABLE = /--(chat|app-shell)-[\w-]+/;

export interface CssFinding {
  file: string;
  selector: string;
  prop?: string;
  line: number;
}

export function listStylesheets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listStylesheets(path));
    else if (entry.name.endsWith('.css')) out.push(path);
  }
  return out.sort();
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Where a node sits: its enclosing at-rules and rules, outermost first, so a
 * declaration nested in `@media` or a nested rule keys apart from the same
 * property at the top level (`@media (width < 768px) .a`).
 */
function context(node: postcss.Node): { path: string; inKeyframes: boolean } {
  const parts: string[] = [];
  let inKeyframes = false;
  for (let p = node.parent; p && p.type !== 'root'; p = p.parent) {
    if (p.type === 'rule') parts.unshift(oneLine((p as postcss.Rule).selector));
    else if (p.type === 'atrule') {
      const at = p as postcss.AtRule;
      if (/keyframes$/.test(at.name)) inKeyframes = true;
      parts.unshift(oneLine(`@${at.name} ${at.params}`));
    }
  }
  return { path: parts.join(' '), inKeyframes };
}

export function scanCss(css: string, file: string) {
  const dataSlot: CssFinding[] = [];
  const dsVariables: CssFinding[] = [];
  const geometry: CssFinding[] = [];
  const root = postcss.parse(css, { from: file });
  // Selectors, and at-rule preludes that carry one (`@scope ([data-slot=…])`).
  root.walkRules((rule) => {
    if (context(rule).inKeyframes) return;
    if (DATA_SLOT.test(rule.selector)) dataSlot.push({ file, selector: oneLine(rule.selector), line: rule.source?.start?.line ?? 0 });
  });
  root.walkAtRules((at) => {
    if (DATA_SLOT.test(at.params)) dataSlot.push({ file, selector: oneLine(`@${at.name} ${at.params}`), line: at.source?.start?.line ?? 0 });
  });
  root.walkDecls((decl) => {
    const { path, inKeyframes } = context(decl);
    if (inKeyframes) return;
    const finding = { file, selector: path, prop: decl.prop.toLowerCase(), line: decl.source?.start?.line ?? 0 };
    if (DS_VARIABLE.test(decl.prop) || DS_VARIABLE.test(decl.value)) dsVariables.push(finding);
    if (GEOMETRY_PROPS.has(finding.prop)) geometry.push(finding);
  });
  return { dataSlot, dsVariables, geometry };
}

export function scanStylesheets(srcDir: string) {
  const all = { dataSlot: [] as CssFinding[], dsVariables: [] as CssFinding[], geometry: [] as CssFinding[] };
  for (const path of listStylesheets(srcDir)) {
    const found = scanCss(readFileSync(path, 'utf8'), relative(srcDir, path));
    all.dataSlot.push(...found.dataSlot);
    all.dsVariables.push(...found.dsVariables);
    all.geometry.push(...found.geometry);
  }
  return all;
}

/** One baseline line: `file :: at-rules and selectors :: prop`. */
export const geometryKey = (f: CssFinding) => `${f.file} :: ${f.selector} :: ${f.prop}`;
