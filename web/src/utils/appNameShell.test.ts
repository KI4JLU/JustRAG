import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renameDefaultAppName, renderAppShell } from './appNameShell';
import { siteConfigSeedFromDocument } from './appName';

/* Oracle: the shipped web/index.html, and the strings the Go renderer's test
   (go-backend/internal/app/app_shell_test.go) asserts for the same input —
   the dev server and production must hand the frontend the same shell. */

const INDEX_HTML = (() => {
  let dir = process.cwd();
  for (;;) {
    const candidate = resolve(dir, 'web/index.html');
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    const up = dirname(dir);
    if (up === dir) throw new Error(`no web/index.html above ${process.cwd()}`);
    dir = up;
  }
})();

const inlineScript = (html: string) => /<script>[\s\S]*?<\/script>/.exec(html)?.[0];

describe('renderAppShell', () => {
  it('names the app in the real index.html', () => {
    // The rename swaps the default name; without it the rename does nothing.
    expect(INDEX_HTML).toContain('<title>JLU RAG</title>');
    expect(INDEX_HTML).toContain('<meta name="description" content="JLU RAG - ');

    const out = renderAppShell(INDEX_HTML, 'THM', 'Docs', 'KI-Assistent');

    expect(out).toContain('<title>KI-Assistent</title>');
    expect(out).toContain('<meta name="description" content="KI-Assistent - Advanced Knowledge Retrieval System"');
    expect(out).toContain('<meta name="app-name-prefix" content="THM" />');
    expect(out).toContain('<meta name="app-name-product" content="Docs" />');
    expect(out).toContain('<meta name="system-name" content="KI-Assistent" />');
    expect(out).not.toContain('JLU RAG');
    expect(out.indexOf('system-name')).toBeLessThan(out.indexOf('</head>'));
    // The theme boot script is hashed into the CSP; the rename leaves it alone.
    expect(inlineScript(out)).toBe(inlineScript(INDEX_HTML));
  });

  it('escapes the name and keeps replacement patterns literal', () => {
    const shell = '<head><meta name="description" content="JLU RAG - x" /><title>JLU RAG</title></head>';
    const out = renderAppShell(shell, 'A&B', '<i>"x"$&', 'A&B <i>"x"$&');

    expect(out).toContain('<title>A&amp;B &lt;i&gt;&#34;x&#34;$&amp;</title>');
    expect(out).toContain('<meta name="app-name-prefix" content="A&amp;B" />');
    expect(out).toContain('<meta name="system-name" content="A&amp;B &lt;i&gt;&#34;x&#34;$&amp;" />');
    expect(out).not.toContain('<i>');
  });

  it('hands the frontend exactly the name it was given', () => {
    const out = renderAppShell(INDEX_HTML, 'THM', 'Docs & more', 'THM Docs & more');
    const doc = new DOMParser().parseFromString(out, 'text/html');

    expect(siteConfigSeedFromDocument(doc))
      .toEqual({ app_name_prefix: 'THM', app_name_product: 'Docs & more', system_name: 'THM Docs & more' });
    expect(doc.title).toBe('THM Docs & more');
  });
});

describe('renameDefaultAppName', () => {
  it('replaces every mention, escaped', () => {
    expect(renameDefaultAppName('<p>JLU RAG und „JLU RAG“, JLU</p>', 'A&B $&'))
      .toBe('<p>A&amp;B $&amp; und „A&amp;B $&amp;“, JLU</p>');
  });
});
