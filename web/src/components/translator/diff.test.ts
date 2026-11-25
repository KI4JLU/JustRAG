import { describe, expect, it } from 'vitest';
import { changePieces, diffWords, insertedCharacters, type DiffPart } from './diff';

/** Joins the parts one side of the diff consists of. */
function side(parts: DiffPart[], type: 'insert' | 'delete'): string {
  return parts
    .filter((part) => part.type === 'equal' || part.type === type)
    .map((part) => part.text)
    .join('');
}

describe('diffWords', () => {
  it('keeps identical texts as one equal part', () => {
    expect(diffWords('Guten Tag', 'Guten Tag')).toEqual([{ type: 'equal', text: 'Guten Tag' }]);
  });

  it('marks a replaced word with its space as deleted, then inserted', () => {
    expect(diffWords('Ich habe gestern gearbeitet.', 'Ich habe heute gearbeitet.')).toEqual([
      { type: 'equal', text: 'Ich habe ' },
      { type: 'delete', text: 'gestern ' },
      { type: 'insert', text: 'heute ' },
      { type: 'equal', text: 'gearbeitet.' },
    ]);
  });

  it('handles empty texts', () => {
    expect(diffWords('', '')).toEqual([]);
    expect(diffWords('', 'neu')).toEqual([{ type: 'insert', text: 'neu' }]);
    expect(diffWords('alt', '')).toEqual([{ type: 'delete', text: 'alt' }]);
  });

  it('marks an added punctuation mark alone, not its word', () => {
    expect(diffWords('Hallo Welt', 'Hallo, Welt')).toEqual([
      { type: 'equal', text: 'Hallo' },
      { type: 'insert', text: ', ' },
      { type: 'equal', text: 'Welt' },
    ]);
  });

  it('rebuilds the new text, line breaks included', () => {
    const after = 'Erste Zeile\nZweite Zeile ohne Fehler\nEnde.';
    expect(side(diffWords('Erste Zeile\nzweite Zeile mit Fehlern\n\nEnde', after), 'insert')).toBe(after);
  });

  it('marks the whole middle as replaced when a word diff would be too costly', () => {
    const before = Array.from({ length: 1100 }, (_, index) => `a${index}`).join(' ');
    const after = Array.from({ length: 1100 }, (_, index) => `b${index}`).join(' ');
    const parts = diffWords(`Start ${before} Ende`, `Start ${after} Ende`);
    expect(parts.map((part) => part.type)).toEqual(['equal', 'delete', 'insert', 'equal']);
  });
});

describe('diffWords with text of any script', () => {
  it('replaces one word of a Ukrainian text, not the words around it', () => {
    expect(diffWords('Це дуже гарний день.', 'Це дуже теплий день.')).toEqual([
      { type: 'equal', text: 'Це дуже ' },
      { type: 'delete', text: 'гарний ' },
      { type: 'insert', text: 'теплий ' },
      { type: 'equal', text: 'день.' },
    ]);
  });

  it('keeps accented words whole', () => {
    expect(diffWords('Un café noir', 'Un café crème')).toEqual([
      { type: 'equal', text: 'Un café ' },
      { type: 'delete', text: 'noir' },
      { type: 'insert', text: 'crème' },
    ]);
    expect(diffWords('São Paulo', 'São Paulo')).toEqual([{ type: 'equal', text: 'São Paulo' }]);
  });

  it('compares CJK words as words', () => {
    const parts = diffWords('你好，世界。', '你好，朋友。');
    expect(side(parts, 'insert')).toBe('你好，朋友。');
    expect(side(parts, 'delete')).toBe('你好，世界。');
  });

  it('keeps a lone "<" and the space after a line break in the new text', () => {
    const after = 'Zahl 3 < 5\n  eingerückt <\r\nEnde';
    expect(side(diffWords('Zahl 3 5\n eingerückt\nEnde', after), 'insert')).toBe(after);
    expect(side(diffWords('', after), 'insert')).toBe(after);
    expect(side(diffWords(after, ''), 'delete')).toBe(after);
  });
});

describe('changePieces', () => {
  it('pairs each deletion with its replacement', () => {
    expect(changePieces(diffWords('das ergebniss ist gut', 'das Ergebnis ist gut'))).toEqual([
      { type: 'equal', text: 'das ' },
      { type: 'delete', text: 'ergebniss', trailing: ' ' },
      { type: 'arrow' },
      { type: 'insert', text: 'Ergebnis', trailing: ' ' },
      { type: 'equal', text: 'ist gut' },
    ]);
  });
});

describe('insertedCharacters', () => {
  it('marks as many characters as the new text has, line breaks and indentation included', () => {
    for (const [before, after] of [
      ['a\n b', 'a\n  b c'],
      ['3 5', '3 < 5\n   x'],
      ['  Start', ' Start\n\n  Ende < '],
      ['Це день', 'Це теплий день\n  сьогодні'],
    ] as const) {
      expect(insertedCharacters(before, after)).toHaveLength(after.length);
    }
  });

  it('puts the marks on the right characters after a line break with indentation', () => {
    const after = 'eins\n    zwei neu';
    const mask = insertedCharacters('eins\n    zwei', after);
    expect(mask.map((inserted) => (inserted ? 'x' : '.')).join('')).toBe('.'.repeat('eins\n    zwei '.length) + 'xxx');
  });

  it('marks the new words of a Ukrainian text, as rewriting shows them', () => {
    const after = 'Це дуже теплий день.';
    const mask = insertedCharacters('Це дуже гарний день.', after);
    expect(mask.map((inserted) => (inserted ? 'x' : '.')).join('')).toBe('........xxxxxxx.....'.slice(0, after.length));
  });

  it('marks the characters of new words', () => {
    const mask = insertedCharacters('ein Satz', 'ein neuer Satz');
    expect(mask.map((inserted) => (inserted ? 'x' : '.')).join('')).toBe('....xxxxxx....');
  });
});
