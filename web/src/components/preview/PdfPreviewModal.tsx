import React, { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import axios from 'axios';
import {
    Alert, AlertDescription, Button, PdfViewer,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { PreviewDialog } from './PreviewDialog';
import { usePreviewBackLink, type PreviewBack } from './PreviewHeader';
import type { PdfHighlight } from '../../utils/passageMarks';
import { fillTemplate } from '../../utils/sourceDisplay';

interface PdfPreviewModalProps {
    show: boolean;
    onClose: () => void;
    fileId: string;
    fileName: string;
    page: number;
    /** Back to the list it was opened from (a synced source's entries). */
    back?: PreviewBack;
    /** Where the file is read from when it is not a KB file (a chat attachment). */
    downloadPath?: string;
    /** Whether the viewer offers the download (downloadSources, or the caller's own file). */
    canDownload: boolean;
    /** The cited passage, marked on its pages (opened from the source panel). */
    highlights?: PdfHighlight[];
    /** Only these pages (a citation's full view); default the whole document. */
    pages?: number[];
}

type PdfPreviewContentProps = Omit<PdfPreviewModalProps, 'show'>;

/**
 * Source PDF in the app's own viewer (DS `PdfViewer`): the browser's embedded
 * viewer ignored the app theme and drew its own dark chrome, and its bleed
 * through the modal's bottom corners is why the radius never closed there.
 * The file is fetched once through the authenticated client; the same blob
 * feeds the viewer and the download action.
 */
const PdfPreviewContent: React.FC<PdfPreviewContentProps> = ({ onClose, fileId, fileName, page, back, downloadPath, canDownload, highlights, pages }) => {
    const { t } = useTheme();
    const toast = useToast();
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pageCount, setPageCount] = useState<number | null>(null);
    const backLink = usePreviewBackLink(back);

    useEffect(() => {
        if (!fileId) return;
        let revoke: string | null = null;
        let cancelled = false;
        axios.get(`${API_BASE_URL}${downloadPath ?? `/api/files/${fileId}/preview`}`, { responseType: 'blob' })
            .then(res => {
                const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
                if (cancelled) { URL.revokeObjectURL(url); return; }
                revoke = url;
                setBlobUrl(url);
            })
            .catch(() => {
                if (cancelled) return;
                setError(t('pdfLoadError'));
                toast.error(t('pdfLoadError'));
            });
        return () => {
            cancelled = true;
            if (revoke) URL.revokeObjectURL(revoke);
        };
    }, [fileId, downloadPath, t, toast]);

    return (
        <PreviewDialog
            onClose={onClose}
            // Escape in the viewer's page field drops what was typed there; it
            // must not close the preview (the dialog sees the key first).
            onEscapeKeyDown={(e) => {
                if (e.target instanceof Element && e.target.closest('[data-slot="pdf-viewer-page-field"]')) e.preventDefault();
            }}
            kind="pdf"
            // While the viewer is not there (loading, failed) its toolbar
            // row is, so the way back stays.
            toolbar={backLink && (!blobUrl || error) ? <div className="flex h-12 shrink-0 items-center gap-1 border-b border-outline-variant pl-2 pr-[var(--dialog-close-inset,0.5rem)]">{backLink}</div> : undefined}
            title={fileName}
            subtitle={pageCount === null
                ? t('previewPdfSubtitle')
                : t('previewPdfSubtitlePages').replace('{pages}', pageCount === 1 ? t('previewPageOne') : t('previewPagesMany').replace('{count}', String(pageCount)))}
        >
                {error ? (
                    <div className="flex flex-1 items-center justify-center p-8">
                        <Alert tone="error" live="assertive" className="max-w-md">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    </div>
                ) : !blobUrl ? (
                    <div className="flex flex-1 items-center justify-center gap-2 text-on-surface-variant">
                        <Loader2 className="animate-spin" size={20} aria-hidden="true" />
                        {t('pdfLoading')}
                    </div>
                ) : (
                    <PdfViewer
                        plain
                        src={blobUrl}
                        initialPage={page}
                        highlights={highlights}
                        pages={pages}
                        onLoad={setPageCount}
                        toolbarStart={backLink}
                        className="min-h-0 flex-1"
                        labels={{
                            zoomIn: t('zoomIn'),
                            zoomOut: t('zoomOut'),
                            previousPage: t('previousPage'),
                            nextPage: t('nextPage'),
                            loadError: t('pdfLoadError'),
                            fullscreen: t('fullscreen'),
                            exitFullscreen: t('exitFullscreen'),
                            goToPage: t('previewPdfGoToPage'),
                            pageSingle: (n: number, total: number) => fillTemplate(t('previewPdfPageSingle'), { page: n, total }),
                        }}
                        toolbarEnd={canDownload && (
                            <Button variant="ghost" size="icon" asChild>
                                <a href={blobUrl} download={fileName} aria-label={`${t('download')} ${fileName}`} title={t('download')}>
                                    <Download size={16} aria-hidden="true" />
                                </a>
                            </Button>
                        )}
                    />
                )}
        </PreviewDialog>
    );
};

export const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({ show, ...rest }) => {
    if (!show) return null;
    // Remount on fileId change so blob/error state resets per document.
    return <PdfPreviewContent key={rest.fileId} {...rest} />;
};
