import React, { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import axios from 'axios';
import {
    Button, Dialog, DialogContent, DialogTitle, PdfViewer,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';

interface PdfPreviewModalProps {
    show: boolean;
    onClose: () => void;
    fileId: string;
    fileName: string;
    page: number;
}

type PdfPreviewContentProps = Omit<PdfPreviewModalProps, 'show'>;

/**
 * Source PDF in the app's own viewer (DS `PdfViewer`): the browser's embedded
 * viewer ignored the app theme and drew its own dark chrome, and its bleed
 * through the modal's bottom corners is why the radius never closed there.
 * The file is fetched once through the authenticated client; the same blob
 * feeds the viewer and the download action.
 */
const PdfPreviewContent: React.FC<PdfPreviewContentProps> = ({ onClose, fileId, fileName, page }) => {
    const { t } = useTheme();
    const toast = useToast();
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!fileId) return;
        let revoke: string | null = null;
        let cancelled = false;
        axios.get(`${API_BASE_URL}/api/files/${fileId}/download`, { responseType: 'blob' })
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
    }, [fileId, t, toast]);

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                closeLabel={t('close')}
                className="flex h-[85vh] w-[min(900px,90vw)] max-w-none flex-col gap-0 overflow-hidden p-0"
                aria-describedby={undefined}
            >
                <div className="flex h-14 shrink-0 items-center gap-3 border-b border-outline-variant pr-14 pl-5">
                    <DialogTitle className="min-w-0 flex-1 truncate text-base font-semibold" title={fileName}>
                        {fileName}
                    </DialogTitle>
                </div>
                {error ? (
                    <div className="flex flex-1 items-center justify-center p-8 text-error">{error}</div>
                ) : !blobUrl ? (
                    <div className="flex flex-1 items-center justify-center gap-2 text-on-surface-variant">
                        <Loader2 className="animate-spin" size={20} aria-hidden="true" />
                        {t('pdfLoading')}
                    </div>
                ) : (
                    <PdfViewer
                        src={blobUrl}
                        initialPage={page}
                        className="min-h-0 flex-1"
                        labels={{
                            zoomIn: t('zoomIn'),
                            zoomOut: t('zoomOut'),
                            previousPage: t('previousPage'),
                            nextPage: t('nextPage'),
                            loadError: t('pdfLoadError'),
                            fullscreen: t('fullscreen'),
                            exitFullscreen: t('exitFullscreen'),
                        }}
                        toolbarEnd={(
                            <Button variant="ghost" size="icon" asChild>
                                <a href={blobUrl} download={fileName} aria-label={`${t('download')} ${fileName}`} title={t('download')}>
                                    <Download size={16} aria-hidden="true" />
                                </a>
                            </Button>
                        )}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
};

export const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({ show, ...rest }) => {
    if (!show) return null;
    // Remount on fileId change so blob/error state resets per document.
    return <PdfPreviewContent key={rest.fileId} {...rest} />;
};
