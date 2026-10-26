import { describe, expect, it } from 'vitest';
import { hasThumbnail, previewKindOf } from './previewKind';

// Oracle: the source inventory (docs/api-contracts/source-file-types.md) —
// every ingestable format maps to the viewer that can show it, and formats a
// browser cannot display get no preview.
describe('previewKindOf', () => {
    it.each([
        // MIME type wins over the name.
        [{ name: 'Seite', type: 'application/pdf' }, 'pdf'],
        [{ name: 'Protokoll', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, 'document'],
        [{ name: 'Lageplan', type: 'image/png' }, 'image'],
        [{ name: 'feed-item_ab12.md', type: 'text/markdown' }, 'markdown'],
        [{ name: 'index.html', type: 'text/html' }, 'text'],
        [{ name: 'daten.csv', type: 'text/csv' }, 'spreadsheet'],
        [{ name: 'paper.tex', type: 'text/x-tex' }, 'document'],
        [{ name: 'config.json', type: 'application/json' }, 'text'],
        [{ name: 'aufnahme.webm', type: 'audio/webm' }, 'audio'],
        [{ name: 'clip.webm', type: 'video/webm' }, 'video'],
        // Name only (a search hit before the file list loaded).
        [{ name: 'a.PDF' }, 'pdf'],
        [{ name: 'b.xlsx' }, 'spreadsheet'],
        [{ name: 'c.tsv' }, 'spreadsheet'],
        [{ name: 'Folien.pptx' }, 'document'],
        [{ name: 'buch.epub' }, 'document'],
        [{ name: 'notes.mdx' }, 'markdown'],
        [{ name: 'src/main.go' }, 'text'],
        [{ name: 'values.yaml' }, 'text'],
        [{ name: 'README' }, 'text'],
        [{ name: 'Dockerfile', type: 'application/octet-stream' }, 'text'],
        [{ name: 'foto.jpeg' }, 'image'],
        [{ name: 'memo.m4a' }, 'audio'],
        [{ name: 'film.mp4' }, 'video'],
    ] as const)('%o → %s', (subject, kind) => {
        expect(previewKindOf(subject)).toBe(kind);
    });

    it.each([
        // Ingested, but no browser shows them.
        { name: 'scan.tif', type: 'image/tiff' },
        { name: 'scan.pnm' },
        { name: 'alt.mpeg', type: 'video/mpeg' },
        // Not ingestable at all.
        { name: 'makro.xlsm' },
        { name: 'alt.doc', type: 'application/msword' },
        { name: 'blob.bin', type: 'application/octet-stream' },
    ])('%o → no preview', (subject) => {
        expect(previewKindOf(subject)).toBeNull();
    });

    it('gives a thumbnail to PDFs, images and text kinds', () => {
        for (const kind of ['pdf', 'image', 'markdown', 'text', 'document'] as const) {
            expect(hasThumbnail(kind)).toBe(true);
        }
        for (const kind of ['spreadsheet', 'audio', 'video', null] as const) {
            expect(hasThumbnail(kind)).toBe(false);
        }
    });
});
