import { describe, it, expect } from 'vitest';
import { extractCitedSourceIndices, stripCitationMarkers, withoutCitations } from './citations';
import type { Message } from '../types';

describe('extractCitedSourceIndices', () => {
  it('extracts a single citation marker', () => {
    const result = extractCitedSourceIndices('Antwort wie in [3] beschrieben.', 10);
    expect(Array.from(result).sort((a, b) => a - b)).toEqual([3]);
  });

  it('extracts multi-cite markers', () => {
    const result = extractCitedSourceIndices('Siehe [1, 2, 5] für Details.', 10);
    expect(Array.from(result).sort((a, b) => a - b)).toEqual([1, 2, 5]);
  });

  it('deduplicates repeated markers', () => {
    const result = extractCitedSourceIndices('Erst [3], dann nochmal [3].', 10);
    expect(Array.from(result).sort((a, b) => a - b)).toEqual([3]);
  });

  it('returns empty set when no markers exist', () => {
    const result = extractCitedSourceIndices('Reiner Text ohne Zitate.', 10);
    expect(result.size).toBe(0);
  });

  it('drops out-of-range indices', () => {
    const result = extractCitedSourceIndices('Hier [99] und [3].', 5);
    expect(Array.from(result).sort((a, b) => a - b)).toEqual([3]);
  });

  it('drops zero and negative indices defensively', () => {
    // [-1] never matches the \d+-only regex; [0] is dropped by the n >= 1 guard
    const result = extractCitedSourceIndices('Hier [0], [-1] und [2].', 5);
    expect(Array.from(result).sort((a, b) => a - b)).toEqual([2]);
  });

  it('tolerates whitespace inside multi-cite', () => {
    const result = extractCitedSourceIndices('Siehe [ 1 ,  2 ].', 10);
    expect(Array.from(result).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('tolerates whitespace around a single index', () => {
    const result = extractCitedSourceIndices('Siehe [ 3 ].', 10);
    expect(Array.from(result)).toEqual([3]);
  });

  it('ignores non-numeric content', () => {
    const result = extractCitedSourceIndices('Kein Treffer: [abc].', 10);
    expect(result.size).toBe(0);
  });

  it('handles mixed valid and out-of-range in one query', () => {
    const result = extractCitedSourceIndices('A [2], B [99], C [4].', 5);
    expect(Array.from(result).sort((a, b) => a - b)).toEqual([2, 4]);
  });

  it('returns empty set when sourceCount is 0', () => {
    const result = extractCitedSourceIndices('Antwort mit [1] aber ohne Quellen.', 0);
    expect(result.size).toBe(0);
  });

  it('returns empty set when sourceCount is negative', () => {
    const result = extractCitedSourceIndices('Antwort mit [1].', -1);
    expect(result.size).toBe(0);
  });

  it('tolerates markdown-escaped brackets emitted by some LLMs', () => {
    const result = extractCitedSourceIndices('Wie in \\[1\\] und \\[2, 3\\] beschrieben.', 10);
    expect(Array.from(result).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});

// Oracle: the marker shapes MessageContent renders as citation pills
// (addCitationRefs: [n], [n, m], escaped \[n\], up to three digits, not a
// markdown link) — those and only those disappear, with the blank before
// them; code and math spans keep their brackets.
describe('stripCitationMarkers', () => {
  it.each([
    ['Text [1].', 'Text.'],
    ['Text [1, 2] und mehr [3]', 'Text und mehr'],
    ['Escaped \\[4\\] marker', 'Escaped marker'],
    ['Spaced [ 1 , 2 ] marker', 'Spaced marker'],
    ['Link [1](https://x) stays', 'Link [1](https://x) stays'],
    ['Code `arr[1]` stays [2]', 'Code `arr[1]` stays'],
    ['Math $a[1]$ stays', 'Math $a[1]$ stays'],
    ['Not a citation [abc] or [1234]', 'Not a citation [abc] or [1234]'],
  ])('%s', (input, expected) => {
    expect(stripCitationMarkers(input)).toBe(expected);
  });
});

// Oracle: a caller without seeCitations sees nothing that names or quotes the
// KB's sources (backend contract 2026-10-16); the rest of the answer stays.
describe('withoutCitations', () => {
  const message: Message = {
    id: 'ai1', role: 'ai', content: 'A [1].',
    sources: [{ fileName: 'a.pdf', content: 'x', score: 1 }],
    conflicts: [{ claim: 'c', sourceA: 1, sourceB: 2, kind: 'contradiction', newer: 'a', fileA: 'a.pdf', fileB: 'b.pdf' }],
    verification: { verified: true, score: 80, issues: ['i'], citations: [{ index: 1, verified: true } as never] },
    trajectory: [{ stage: 'hop', chunks: [{ idx: 1, file_name: 'a.pdf', score: 1 }], findings: 2 }],
    comparisonFindings: [{ mode: 'formal', severity: 'low', sectionIdx: 0, uploadQuote: 'u', issue: 'i', citedFileIds: ['f1'], citedQuote: 'q' }],
  };

  it('drops markers, sources, conflicts, citation results, retrieved files and KB quotes', () => {
    const out = withoutCitations(message);
    expect(out.content).toBe('A.');
    expect(out.sources).toBeUndefined();
    expect(out.conflicts).toBeUndefined();
    expect(out.verification?.citations).toBeUndefined();
    expect(out.trajectory?.[0].chunks).toBeUndefined();
    expect(out.comparisonFindings?.[0]).toMatchObject({ citedQuote: '', citedFileIds: [], uploadQuote: 'u', issue: 'i' });
  });

  it('keeps the fact-check verdict and the rest of the trajectory', () => {
    const out = withoutCitations(message);
    expect(out.verification).toMatchObject({ verified: true, score: 80, issues: ['i'] });
    expect(out.trajectory?.[0]).toMatchObject({ stage: 'hop', findings: 2 });
  });
});
