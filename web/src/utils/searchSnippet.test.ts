import { describe, it, expect } from 'vitest';
import { splitSnippet } from './searchSnippet';

/*
 * ORACLE: API.md `### Search` — U+E000 opens a highlight, U+E001 closes it,
 * every other character is literal text. The expected runs below are written
 * out by hand from that rule, not produced by the function.
 */
describe('splitSnippet', () => {
  it('turns each marked word into a highlighted run and drops the markers', () => {
    expect(splitSnippet('Laut der Prüfungsordnung von 2024 …')).toEqual([
      { text: 'Laut der ', highlight: false },
      { text: 'Prüfungsordnung', highlight: true },
      { text: ' von ', highlight: false },
      { text: '2024', highlight: true },
      { text: ' …', highlight: false },
    ]);
  });

  it('keeps markup-looking text literal', () => {
    expect(splitSnippet('a <b>&amp; x')).toEqual([
      { text: 'a <b>&amp; ', highlight: false },
      { text: 'x', highlight: true },
    ]);
  });

  it('tolerates unbalanced markers without leaking them', () => {
    expect(splitSnippet('ab')).toEqual([
      { text: 'a', highlight: false },
      { text: 'b', highlight: true },
    ]);
    expect(splitSnippet('')).toEqual([]);
  });
});
