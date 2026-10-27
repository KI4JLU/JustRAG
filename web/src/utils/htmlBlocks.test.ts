import { describe, expect, it } from 'vitest';
import { renderHtmlBlocks } from './htmlBlocks';

// Oracle: hand-written Markdown for each hand-written HTML block.
describe('renderHtmlBlocks', () => {
    it('renders an indented feed-item block (code in Markdown) to its content', () => {
        const md = [
            '# Titel',
            '',
            '    <section id="x">',
            '      <div><p><picture><source srcset="a.jpg 600w"/><img alt="Release 32" src="https://x/a.jpg"/></picture></p></div>',
            '',
            'Weiter im Text.',
        ].join('\n');
        expect(renderHtmlBlocks(md)).toBe('# Titel\n\n*Release 32*\n\nWeiter im Text.');
    });

    it('keeps text, links, emphasis, headings and list items', () => {
        const md = '<div><h3>Neu</h3><p>Siehe <a href="https://jlu.de">JLU</a> und <strong>fett</strong>.</p><ul><li>eins</li><li>zwei</li></ul></div>';
        expect(renderHtmlBlocks(md)).toBe('### Neu\n\nSiehe [JLU](https://jlu.de) und **fett**.\n\n- eins\n\n- zwei');
    });

    it('keeps a table\'s rows and cells as a Markdown table', () => {
        const md = '<table><tr><th>Name</th><th>Wert</th></tr><tr><td>A</td><td>10</td></tr></table>';
        expect(renderHtmlBlocks(md)).toBe('| Name | Wert |\n| --- | --- |\n| A | 10 |');
    });

    it('keeps preformatted code as written and escapes literal Markdown characters', () => {
        expect(renderHtmlBlocks('<pre><code>if ready:\n    run()\nfinish()</code></pre>')).toBe('```\nif ready:\n    run()\nfinish()\n```');
        expect(renderHtmlBlocks('<pre><code>first()\n\n    second()\n</code></pre>\n\nText')).toBe('```\nfirst()\n\n    second()\n```\n\nText');
        expect(renderHtmlBlocks('<table><tr><th>K</th></tr><tr><td>a | b</td></tr></table>')).toBe('| K |\n| --- |\n| a \\| b |');
        expect(renderHtmlBlocks('<p>a*b*c</p>')).toBe('a\\*b\\*c');
        expect(renderHtmlBlocks('<p># kein Titel</p>')).toBe('\\# kein Titel');
    });

    it('closes a fence only on the same marker, at least as long', () => {
        const md = '````md\n```html\n<div>bleibt</div>\n```\n````\n\n<p>weg</p>';
        expect(renderHtmlBlocks(md)).toBe('````md\n```html\n<div>bleibt</div>\n```\n````\n\nweg');
    });

    it('drops a block with nothing readable and leaves code fences alone', () => {
        const md = 'A\n\n<div><img src="x.png"/></div>\n\n```html\n<div>bleibt</div>\n```';
        expect(renderHtmlBlocks(md)).toBe('A\n\n\n```html\n<div>bleibt</div>\n```');
    });
});
