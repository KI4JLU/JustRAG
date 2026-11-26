import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import baseline from './layoutGuard.baseline.json';
import { geometryKey, scanCss, scanStylesheets } from './layoutGuard';

/* The rules and their reason: ./layoutGuard.ts. Oracle for the fixtures: the
   rules as written there, applied by hand to stylesheets small enough to read
   in full. The last block runs them over the real stylesheets under src/. */

describe('scanCss', () => {
  it('finds a selector on a DS element, in any position', () => {
    const { dataSlot } = scanCss('.a [data-slot="chat-stage"] .b { color: red }\n.c { color: red }', 'x.css');
    expect(dataSlot.map((f) => f.selector)).toEqual(['.a [data-slot="chat-stage"] .b']);
  });

  it('finds it inside :is() and @scope, with spaces, and leaves data-slot-* attributes alone', () => {
    const { dataSlot } = scanCss(
      ':is([ data-slot="chat-stage"], .a) { color: red }\n@scope ([data-slot=composer]) { p { color: red } }\n[data-slot-helper] { color: red }',
      'x.css',
    );
    expect(dataSlot.map((f) => f.selector)).toEqual([':is([ data-slot="chat-stage"], .a)', '@scope ([data-slot=composer])']);
  });

  it('finds a DS layout variable as a property and as a value', () => {
    const { dsVariables } = scanCss(
      '.a { --chat-box: 1px }\n.b { left: var(--app-shell-bubble-inset) }\n.c { --my-own: 1px }',
      'x.css',
    );
    expect(dsVariables.map((f) => f.selector)).toEqual(['.a', '.b']);
  });

  it('lists geometry by selector and property, not colours or keyframe offsets', () => {
    const { geometry } = scanCss(
      '.a { max-width: 10rem; color: red }\n@media (max-width: 1px) { .a { left: 0 } }\n@keyframes k { from { left: 0 } }',
      'x.css',
    );
    expect(geometry.map(geometryKey)).toEqual(['x.css :: .a :: max-width', 'x.css :: @media (max-width: 1px) .a :: left']);
  });

  it('keys nested declarations by their context and counts logical and shorthand properties', () => {
    const { geometry, dsVariables } = scanCss(
      '.a { @media (width < 768px) { width: 10rem; left: var(--chat-box) } }\n.b { grid: auto / 1fr; inset-inline: 0; MIN-INLINE-SIZE: 0 }',
      'x.css',
    );
    expect(geometry.map(geometryKey)).toEqual([
      'x.css :: .a @media (width < 768px) :: width',
      'x.css :: .a @media (width < 768px) :: left',
      'x.css :: .b :: grid',
      'x.css :: .b :: inset-inline',
      'x.css :: .b :: min-inline-size',
    ]);
    expect(dsVariables.map((f) => f.prop)).toEqual(['left']);
  });
});

describe('the stylesheets under src/', () => {
  const found = scanStylesheets(resolve(__dirname, '..'));

  it('select no DS element: the DS owns its parts', () => {
    expect(found.dataSlot.map((f) => `${f.file}:${f.line} ${f.selector}`)).toEqual([]);
  });

  it('use no DS layout variable: that arithmetic belongs to the DS layouts', () => {
    expect(found.dsVariables.map((f) => `${f.file}:${f.line} ${f.selector} { ${f.prop} }`)).toEqual([]);
  });

  it('add no layout geometry: build it in the DS or with DS components', () => {
    const known = new Set<string>(baseline);
    const added = [...new Set(found.geometry.filter((f) => !known.has(geometryKey(f))).map((f) => `${geometryKey(f)}   (line ${f.line})`))];
    expect(added).toEqual([]);
  });

  it('keep the baseline exact: delete the lines of geometry that is gone', () => {
    const current = new Set(found.geometry.map(geometryKey));
    expect((baseline as string[]).filter((key) => !current.has(key))).toEqual([]);
  });
});
