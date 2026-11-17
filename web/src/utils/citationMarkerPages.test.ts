import { describe, expect, it } from 'vitest';
import { parseMarkerBody } from './citationMarkerBody';
import { extractCitedSourceIndices, normalizeCitationMarkers, stripCitationMarkers } from './citations';
import { addCitationRefs } from './citationRefs';
import { buildCitationModel, citationOrder } from './sourceDisplay';
import { normalizeMathDelimiters } from './markdownMath';
import { buildAnswerMarkdown } from './exportAnswer';
import type { Message, MessageSource } from '../types';

// Oracle: the same table as TestParseMarkerBody in
// go-backend/internal/chat/citation_marker_test.go — the two parsers must agree.
describe('parseMarkerBody', () => {
    it.each<[string, number[] | null]>([
        ['3', [3]],
        ['1, 2, 5', [1, 2, 5]],
        ['5, S. 584', [5]],
        ['5, S. 584; 8, S. 583', [5, 8]],
        ['9, S. 554; 23, S. 570', [9, 23]],
        ['5, S. 584, 8, S. 583', [5, 8]],
        ['5, S. 584, 586', [5]],
        ['5, S. 584-586, 590', [5]],
        ['5, S. 12 ff.', [5]],
        ['1, 2, S. 7', [1, 2]],
        ['5 S. 584', [5]],
        ['5: S. 584', [5]],
        ['3, p. 12', [3]],
        ['3, pp. 12–14; 4, page 2', [3, 4]],
        ['2, Seite 4 und 5', [2]],
        ['2, Abschnitt 3.2', [2]],
        ['1; 2, S. 3', [1, 2]],
        ['999999999', [999999999]],
        ['1000000000', []],
        ['9223372036854775808', []],
        ['1; 2', null],
        ['1, 2; 3, 4', null],
        ['5, S.\u00a0584', [5]],
        ['5, S. 12A', [5]],
        ['5, S. 12 FF.', [5]],
        ['1,\u00a02, S. 3', [1, 2]],
        ['1,\u00a02', null],
        ['0', []],
        ['0, S. 2', []],
        ['12345, S. 2', null],
        ['5, S.\u3000584', null],
        ['5, SEITE 3', null],
        ['2024 war ein gutes Jahr', null],
        ['S. 584', null],
        ['5, siehe oben', null],
        ['1, 2; S. 3', null],
        ['5, S.', null],
    ])('%s', (body, want) => {
        expect(parseMarkerBody(body)).toEqual(want);
    });
});

describe('normalizeCitationMarkers', () => {
    it('rewrites markers with page text to the plain form', () => {
        expect(normalizeCitationMarkers('Leser [5, S. 584]. Siehe [5, S. 584; 8, S. 583] und [2].'))
            .toBe('Leser [5]. Siehe [5, 8] und [2].');
    });

    it('leaves plain markers, other brackets, links, code and math alone', () => {
        const text = 'A [1, 2] B [2024 war gut] C [5, S. 3](http://x) D `a[5, S. 3]` E $v[5, S. 3]$ F \\[1\\]';
        expect(normalizeCitationMarkers(text)).toBe(text);
    });

    // Oracle: the bounds of the backend's citationMarkerRe (TestCitationMarker_BodyBound).
    it('reads a body up to the length bound and none beyond it', () => {
        const atBound = `Text [5, S. 584${' '.repeat(151)}].`;
        expect(normalizeCitationMarkers(atBound)).toBe('Text [5].');
        const over = `Text [5, S. 584${' '.repeat(152)}].`;
        expect(normalizeCitationMarkers(over)).toBe(over);
        const zero = 'Text [0, S. 2].';
        expect(normalizeCitationMarkers(zero)).toBe(zero);
    });

    it('leaves a matrix alone', () => {
        const text = 'Die Matrix ist $[1, 2; 3, 4]$ bzw. [1, 2; 3, 4].';
        expect(normalizeCitationMarkers(text)).toBe(text);
    });

    it('stays fast on many unclosed escaped brackets', () => {
        const text = '\\[5, S. 584 '.repeat(60_000);
        const start = performance.now();
        expect(normalizeCitationMarkers(text)).toBe(text);
        expect(performance.now() - start).toBeLessThan(500);
    });

    it('stays fast on a long bracket that is no marker', () => {
        const text = `\\[1${' '.repeat(200_000)}X\\]`;
        const start = performance.now();
        expect(normalizeCitationMarkers(text)).toBe(text);
        normalizeMathDelimiters(text);
        expect(performance.now() - start).toBeLessThan(500);
    });

    it('unescapes an escaped marker with page text', () => {
        expect(normalizeCitationMarkers('Satz \\[5, S. 584\\].')).toBe('Satz [5].');
    });
});

const sources = [
    { index: 5, fileName: 'a.pdf', fileId: 'f1', content: 'A', score: 1 },
    { index: 8, fileName: 'b.pdf', fileId: 'f2', content: 'B', score: 1 },
] as MessageSource[];

// Oracle: each reader gives for the page-text form what it gives for the
// plain form of the same citations.
describe('marker readers on markers with page text', () => {
    const annotated = 'Leser [5, S. 584]. Siehe [5, S. 584; 8, S. 583].';
    const plain = 'Leser [5]. Siehe [5, 8].';

    it('renders the same chips', () => {
        const out = addCitationRefs(annotated, buildCitationModel(annotated, sources));
        expect(out).toBe(addCitationRefs(plain, buildCitationModel(plain, sources)));
        expect(out).toContain('data-raw="8"');
    });

    it('reads the same citation order and cited set', () => {
        expect(citationOrder(annotated)).toEqual([5, 5, 8]);
        expect(extractCitedSourceIndices(annotated, 8)).toEqual(new Set([5, 8]));
    });

    it('strips them for a reader without citations', () => {
        expect(stripCitationMarkers(annotated)).toBe('Leser. Siehe.');
        expect(stripCitationMarkers(annotated, new Set([8]))).toBe('Leser. Siehe [8].');
    });

    it('keeps an escaped one out of display math', () => {
        const text = 'Satz \\[5, S. 584\\].';
        const out = addCitationRefs(normalizeMathDelimiters(text), buildCitationModel(text, sources));
        expect(out).toContain('data-raw="5"');
        expect(out).not.toContain('$$');
    });

    it('copies and exports the plain form, pages in the source list', () => {
        const message = { content: annotated, sources: [{ ...sources[0], pages: [584] }, sources[1]] } as Message;
        expect(buildAnswerMarkdown(message, { sourcesHeading: 'Quellen' }))
            .toBe('Leser [5]. Siehe [5, 8].\n\n## Quellen\n[5] a.pdf (p. 584)\n[8] b.pdf');
    });
});
