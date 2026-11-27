import { describe, expect, it } from 'vitest';

import { boardHtml, sourceBoardHtml } from './boardHtml';

describe('source board', () => {
  it('shows a lone "<" that starts no tag, escaped', () => {
    expect(sourceBoardHtml('Die Zahl 3 < 5 ist kleiner.', ['Die Zahl 3 < 5 ist kleiner.'], null, null)).toContain(
      '>Die Zahl 3 &lt; 5 ist kleiner.</span>',
    );
    expect(sourceBoardHtml('3 < 5 und 7 > 4.', ['3 < 5 und 7 > 4.'], null, null)).toContain('3 &lt; 5 und 7 &gt; 4.');
    expect(sourceBoardHtml('a <b und c', ['a <b und c'], null, null)).toContain('>a &lt;b und c</span>');
  });

  it('shows every character of the text, in any script', () => {
    const text = 'Un café – Привіт, 你好 <3';
    const html = sourceBoardHtml(text, [text], null, null);
    expect(html).toContain('Un café – Привіт, 你好 &lt;3');
  });
});

describe('result board', () => {
  it('keeps a lone "<" and the words after it, one span per word', () => {
    const html = boardHtml({ sentences: ['3 < 5 ok.'], mapping: null, highlightAgainst: null, loading: [] });
    expect(html).toContain('&lt;</span>');
    const text = html.replace(/<[^>]+>/g, '');
    expect(text.replace(/&lt;/g, '<')).toBe('3 < 5 ok.');
  });

  it('highlights the new words of a rewrite in the right place after a line break', () => {
    const html = boardHtml({
      sentences: ['eins\n', '    zwei neu'],
      mapping: null,
      highlightAgainst: 'eins\n    zwei',
      loading: [],
    });
    expect(html).toMatch(/word-item border-b-2 border-success" data-token-index="3">neu</);
    expect(html).not.toMatch(/border-success" data-token-index="1">zwei</);
  });
});
