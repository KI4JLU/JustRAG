import { describe, expect, it } from 'vitest';
import { missingCardFields } from './globalKbCard';

// Oracle: what the „Entdecken" card (KbCatalogPanel) draws — category pill,
// description (header text as fallback, as GET /api/kb/catalog does),
// „n Dokumente" and „Stand".
describe('missingCardFields', () => {
    const full = { description: 'Text', fileCount: 3, lastIngestedAt: '2026-10-27T00:00:00Z' };

    it('names nothing for a complete card', () => {
        expect(missingCardFields(full, ['c1'])).toEqual([]);
    });

    it('takes the header text as the description', () => {
        expect(missingCardFields({ ...full, description: ' ', headerText: 'Blurb' }, ['c1'])).toEqual([]);
    });

    it('names category, description and documents of an empty KB', () => {
        expect(missingCardFields({ fileCount: 0 }, [])).toEqual(['globalKbMissingCategory', 'globalKbMissingDescription', 'globalKbMissingDocuments']);
    });

    it('names the date while files exist but none was ingested', () => {
        expect(missingCardFields({ ...full, lastIngestedAt: null }, ['c1'])).toEqual(['globalKbMissingAsOf']);
    });

    it('claims nothing about categories that failed to load', () => {
        expect(missingCardFields(full, null)).toEqual([]);
    });
});
