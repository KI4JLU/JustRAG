import { describe, expect, it } from 'vitest';
import { addCitationRefs } from './citationRefs';
import { buildCitationModel } from './sourceDisplay';
import type { MessageSource } from '../types';

const sources = [
    { index: 1, fileName: 'a.pdf', fileId: 'f1', content: 'A', score: 1 },
    { index: 2, fileName: 'b.pdf', fileId: 'f2', content: 'B', score: 1 },
] as MessageSource[];

// Oracle: hand-written expected HTML for the documented rewrite.
describe('addCitationRefs line glue', () => {
    it('glues the word gap, the chips and the full stop into one no-wrap span', () => {
        const text = 'genutzt werden [1].';
        const out = addCitationRefs(text, buildCitationModel(text, sources));
        expect(out).toBe('genutzt werden<span class="cite-glue"> <sup class="source-ref" data-n="1" data-raw="1" data-occ="0"></sup>.</span>');
    });

    it('keeps a run of chips together and leaves text without punctuation as is', () => {
        const text = 'A [1][2] und weiter';
        const out = addCitationRefs(text, buildCitationModel(text, sources));
        expect(out).toBe('A<span class="cite-glue"> <sup class="source-ref" data-n="1" data-raw="1" data-occ="0"></sup><sup class="source-ref" data-n="2" data-raw="2" data-occ="1"></sup></span> und weiter');
    });

    it('keeps the punctuation of a marker that resolves to no source', () => {
        const text = 'Satz [9].';
        expect(addCitationRefs(text, buildCitationModel(text, sources))).toBe('Satz.');
    });
});
