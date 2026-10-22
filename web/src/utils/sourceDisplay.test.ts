import { describe, it, expect } from 'vitest';
import { buildCitationModel, cleanSourceTitle, originUrlOf, parseTableChunk, recordForSpan, sourceKind, withoutOriginLine } from './sourceDisplay';

const src = (index: number, fileName: string, fileId = fileName, pages?: number[]) => ({ index, fileName, fileId, content: '', score: 0.5, pages });

describe('cleanSourceTitle', () => {
  it('drops the extension and turns underscores into spaces', () => {
    expect(cleanSourceTitle('Anforderungen_JLU_RAG.xlsx')).toBe('Anforderungen JLU RAG');
    expect(cleanSourceTitle('Protokoll KI im Dezernat C.md')).toBe('Protokoll KI im Dezernat C');
    expect(cleanSourceTitle('README')).toBe('README');
  });
});

describe('sourceKind', () => {
  it('reads the kind off the extension', () => {
    expect(sourceKind('a.PDF')).toBe('pdf');
    expect(sourceKind('a.xlsx')).toBe('table');
    expect(sourceKind('a.md')).toBe('markdown');
    expect(sourceKind('a.docx')).toBe('word');
    expect(sourceKind('a')).toBe('document');
  });
});

describe('buildCitationModel', () => {
  it('numbers files 1…N by first citation, merging chunks of one file', () => {
    const m = buildCitationModel('X [4]. Y [2, 1]. Z [3].', [src(1, 'a.pdf', 'fa', [2]), src(2, 'b.pdf'), src(3, 'a.pdf', 'fa', [9]), src(4, 'c.pdf')]);
    expect(m.cited.map(c => [c.n, c.fileName, c.rawNumbers])).toEqual([
      [1, 'c.pdf', [4]], [2, 'b.pdf', [2]], [3, 'a.pdf', [1, 3]],
    ]);
    expect(m.cited[2].pages).toEqual([2, 9]);
    expect(Object.fromEntries(m.displayOf)).toEqual({ 4: 1, 2: 2, 1: 3, 3: 3 });
    expect(m.noSources).toBe(false);
  });

  it('ignores markers in code and out-of-range markers', () => {
    const m = buildCitationModel('`a[1]` and [7]', [src(1, 'a.pdf')]);
    expect(m.cited).toHaveLength(0);
    expect(m.noSources).toBe(true);
  });

  it('has no sources when the answer cites none of them', () => {
    expect(buildCitationModel('No markers.', [src(1, 'a.pdf')]).noSources).toBe(true);
    expect(buildCitationModel('No sources [1].', undefined).noSources).toBe(true);
  });
});

describe('parseTableChunk', () => {
  const chunk = '### f.xlsx › S\n[tabular.t rows 3–4]\nID: A | Wert: 1\nID: B | Wert: 2\n';
  it('reads rows as label/value pairs with rune offsets', () => {
    const rows = parseTableChunk(chunk)!;
    expect(rows.map(r => r.ordinal)).toEqual([3, 4]);
    expect(rows[1].fields.map(f => [f.label, f.value])).toEqual([['ID', 'B'], ['Wert', '2']]);
    const f = rows[1].fields[1];
    expect(Array.from(chunk).slice(f.start, f.end).join('')).toBe('2');
  });
  it('picks the row a span falls in', () => {
    const rows = parseTableChunk(chunk)!;
    const f = rows[1].fields[0];
    expect(recordForSpan(rows, { start: f.start, end: f.end }).ordinal).toBe(4);
    expect(recordForSpan(rows).ordinal).toBe(3);
  });
  it('is null for prose', () => {
    expect(parseTableChunk('Just: some text')).toBeNull();
  });
});

describe('origin line', () => {
  it('finds and strips the "Source: <url>" header line', () => {
    const text = '# Title\n\nSource: https://wiki.example/x\n\nBody';
    expect(originUrlOf(text)).toBe('https://wiki.example/x');
    expect(withoutOriginLine(text)).toBe('# Title\n\nBody');
  });
});
