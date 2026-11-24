import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicModals } from './TopicModals';

// The preview dialogs themselves are stubbed: this test only reads which
// `canDownload` TopicModals hands them.
vi.mock('../preview/PdfPreviewModal', () => ({
    PdfPreviewModal: ({ fileId, canDownload }: { fileId: string; canDownload: boolean }) => (
        <div data-testid="pdf" data-file={fileId} data-can-download={String(canDownload)} />
    ),
}));

let downloadSources = true;
let files: { id: string }[] = [];
let pdfPreview: { fileId: string; fileName: string; page: number; downloadPath?: string } | null = null;

vi.mock('../../hooks/useKbSourceRights', () => ({
    useKbSourceRights: () => ({ seeSources: true, addSources: false, previewSources: true, downloadSources, seeCitations: true, manageSources: false }),
}));
vi.mock('../../contexts/KbCoreContext', () => ({ useKbCore: () => ({ currentKb: { id: 'kb-2' } }) }));
vi.mock('../../contexts/KbDataContext', () => ({
    useKbData: () => ({
        fileMgmt: { files },
        webTools: {
            showPreviewModal: false, previewPage: null, showWebResults: false,
            showPdfPreview: pdfPreview != null, pdfPreview, setShowPdfPreview: vi.fn(),
            mediaPreview: null, showTabularModal: false,
        },
    }),
}));

// Oracle (Sten, 2026-11-24): a preview's download needs downloadSources of the
// file's OWN topic. A preview stays open across a topic switch, so the open
// topic's right may only count for a file in that topic's list; the caller's
// own library file is always downloadable.
describe('TopicModals — the preview download follows the file\'s topic', () => {
    beforeEach(() => {
        downloadSources = true;
        files = [{ id: 'f-here' }];
        pdfPreview = null;
    });

    it('offers the download for a file of the open topic with downloadSources', async () => {
        pdfPreview = { fileId: 'f-here', fileName: 'a.pdf', page: 1 };
        render(<TopicModals />);
        expect(await screen.findByTestId('pdf')).toHaveAttribute('data-can-download', 'true');
    });

    it('offers none for a preview left over from another topic', async () => {
        pdfPreview = { fileId: 'f-elsewhere', fileName: 'a.pdf', page: 1 };
        render(<TopicModals />);
        expect(await screen.findByTestId('pdf')).toHaveAttribute('data-can-download', 'false');
    });

    it('offers none without downloadSources (preview only)', async () => {
        downloadSources = false;
        pdfPreview = { fileId: 'f-here', fileName: 'a.pdf', page: 1 };
        render(<TopicModals />);
        expect(await screen.findByTestId('pdf')).toHaveAttribute('data-can-download', 'false');
    });

    it('always offers it for the caller\'s own library file', async () => {
        downloadSources = false;
        pdfPreview = { fileId: 'u-1', fileName: 'mine.pdf', page: 1, downloadPath: '/api/library/files/u-1/download' };
        render(<TopicModals />);
        expect(await screen.findByTestId('pdf')).toHaveAttribute('data-can-download', 'true');
    });
});
