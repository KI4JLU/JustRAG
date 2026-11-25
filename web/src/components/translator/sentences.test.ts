import { describe, expect, it } from 'vitest';
import {
  completeSentenceCount,
  MAPPING_CELLS_MAX,
  sentenceMapping,
  sentenceTokens,
  splitIntoSentences,
  withTrailingWhitespace,
} from './sentences';

describe('splitIntoSentences', () => {
  it('keeps punctuation and the whitespace after each sentence', () => {
    const text = 'Guten Morgen. Bitte melden Sie sich an!\nZweite Zeile?';
    const sentences = splitIntoSentences(text);
    expect(sentences).toEqual(['Guten Morgen. ', 'Bitte melden Sie sich an!\n', 'Zweite Zeile?']);
    expect(sentences.join('')).toBe(text);
  });

  it('does not end a sentence at abbreviations, titles or ordinals', () => {
    expect(splitIntoSentences('Das gilt z.B. für Prof. Müller am 3. Oktober. Ende.')).toEqual([
      'Das gilt z.B. für Prof. Müller am 3. Oktober. ',
      'Ende.',
    ]);
  });

  it('ends a sentence at a line break, so a heading or list item without a full stop stays a line of its own', () => {
    const text = '## 1. Überschrift\n\nErster Absatz. Zweiter Satz.\n- Punkt eins\n- Punkt zwei';
    const sentences = splitIntoSentences(text);
    expect(sentences).toEqual([
      '## 1. Überschrift\n\n',
      'Erster Absatz. ',
      'Zweiter Satz.\n',
      '- Punkt eins\n',
      '- Punkt zwei',
    ]);
    expect(sentences.join('')).toBe(text);
  });

  it('never makes a sentence of whitespace alone and still joins back to the text', () => {
    for (const text of ['\n\nAnfang. Ende.', 'Eins.\n   \nZwei.', 'Eins.\n\n\n', '  \n  ', 'Eins.\r\nZwei.\r\n']) {
      const sentences = splitIntoSentences(text);
      expect(sentences.join('')).toBe(text.trim() ? text : text.trim());
      if (text.trim()) expect(sentences.every((sentence) => sentence.trim() !== '')).toBe(true);
    }
  });

  it('splits markup after closing block tags', () => {
    expect(splitIntoSentences('<p>Eins. Zwei.</p>\n<p>Drei.</p>')).toEqual(['<p>Eins. Zwei.</p>\n', '<p>Drei.</p>']);
  });
});

describe('sentenceTokens', () => {
  it('separates words, punctuation and spaces', () => {
    expect(sentenceTokens('Hallo, Welt!')).toEqual(['Hallo', ',', ' ', 'Welt', '!']);
  });

  it('keeps words of any script in one piece', () => {
    expect(sentenceTokens('Un café à Málaga, niño')).toEqual([
      'Un', ' ', 'café', ' ', 'à', ' ', 'Málaga', ',', ' ', 'niño',
    ]);
    expect(sentenceTokens('Zażółć gęślą jaźń, São Paulo')).toEqual([
      'Zażółć', ' ', 'gęślą', ' ', 'jaźń', ',', ' ', 'São', ' ', 'Paulo',
    ]);
    expect(sentenceTokens('Привіт, світе! Це Київ.')).toEqual([
      'Привіт', ',', ' ', 'світе', '!', ' ', 'Це', ' ', 'Київ', '.',
    ]);
    expect(sentenceTokens('你好，世界。')).toEqual(['你好', '，', '世界', '。']);
  });

  it('keeps a tag, a comment and a link as one token each', () => {
    expect(sentenceTokens('<p>Siehe <a href="x">https://a.b/c?d=1</a><!-- n --></p>')).toEqual([
      '<p>', 'Siehe', ' ', '<a href="x">', 'https://a.b/c?d=1', '</a>', '<!-- n -->', '</p>',
    ]);
  });

  it('loses nothing: the tokens joined give the sentence back', () => {
    const sentences = [
      '3 < 5 und 7 > 4.',
      'a<b und c<d',
      '<',
      '<<>>',
      'x < ',
      '< 5',
      'Preis: 5 € <b>fett</b>',
      '  eingerückt\r\n\tTab\u00a0nbsp',
      'Emoji 😀 und 👍🏽 dabei',
      'Zeile eins\n\n  Zeile zwei',
      '<unfinished tag',
      '<!-- offen',
      'e\u0301 (e plus Akzent)',
    ];
    for (const sentence of sentences) expect(sentenceTokens(sentence).join('')).toBe(sentence);
  });

  it('gives a "<" that starts no tag a token of its own, and keeps the words around it', () => {
    expect(sentenceTokens('3 < 5')).toEqual(['3', ' ', '<', ' ', '5']);
    expect(sentenceTokens('a <b')).toEqual(['a', ' ', '<', 'b']);
  });
});

describe('sentenceMapping', () => {
  it('links sentences to their originals and marks added ones', () => {
    expect(
      sentenceMapping(['Guten Morgen. ', 'Ganz neu hier. ', 'Bitte anmelden.'], ['Guten Morgen. ', 'Bitte anmelden.']),
    ).toEqual([0, -1, 1]);
  });
});

describe('sentenceMapping at the page’s limit', () => {
  const count = 2500;
  const sentences = Array.from({ length: count }, (_, i) => `Das ist der Satz Nummer ${i} im Text. `);

  it('pairs an unchanged result without comparing any words', () => {
    const stats = { comparisons: 0 };
    expect(sentenceMapping(sentences, sentences, stats)).toEqual(sentences.map((_, i) => i));
    expect(stats.comparisons).toBe(0);
  });

  it('aligns only what lies between the unchanged start and end', () => {
    const edited = [...sentences];
    edited[1200] = 'Ein ganz neuer Satz. ';
    edited.splice(1800, 0, 'Noch ein eingefügter Satz. ');
    const stats = { comparisons: 0 };
    const mapping = sentenceMapping(edited, sentences, stats);
    expect(mapping[0]).toBe(0);
    expect(mapping[1799]).toBe(1799);
    expect(mapping[1800]).toBe(-1);
    expect(mapping[1801]).toBe(1800);
    expect(mapping[count]).toBe(count - 1);
    // The middle spans 600 sentences; the rest costs nothing.
    expect(stats.comparisons).toBeLessThanOrEqual(601 * 601);
  });

  it('bounds the work for an edit that touches everything', () => {
    const other = sentences.map((_, i) => `Völlig anderer Text, Zeile ${i}. `);
    const stats = { comparisons: 0 };
    const mapping = sentenceMapping(other, sentences, stats);
    expect(count * count).toBeGreaterThan(MAPPING_CELLS_MAX);
    expect(stats.comparisons).toBeLessThanOrEqual(count);
    expect(mapping).toHaveLength(count);
    // Equal lengths still fall back on pairing by position.
    expect(mapping.every((from, i) => from === i)).toBe(true);
  });

  it('still tells an added sentence from the ones around it in a long text', () => {
    const added = [...sentences.slice(0, 10), 'Eigener Satz. ', ...sentences.slice(10)];
    expect(sentenceMapping(added, sentences)[10]).toBe(-1);
    expect(sentenceMapping(added, sentences)[11]).toBe(10);
  });
});

describe('completeSentenceCount', () => {
  it('counts sentences that end with their punctuation', () => {
    expect(completeSentenceCount('Eins. Zwei! Drei')).toBe(2);
    expect(completeSentenceCount('Er sagte: "Ja."')).toBe(1);
  });
});

describe('withTrailingWhitespace', () => {
  it('gives a result the whitespace its source ended with', () => {
    expect(withTrailingWhitespace('Hello.', 'Hallo.\n')).toBe('Hello.\n');
    expect(withTrailingWhitespace('Hello. ', 'Hallo. ')).toBe('Hello. ');
  });
});
