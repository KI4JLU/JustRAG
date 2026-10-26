import React, { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import axios from 'axios';
import { Alert, AlertDescription, Button, ImageViewer } from '@ki4jlu/design-system';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { cachedSourceImage } from '../hooks/sourcePreviews';
import { loadUserFileUrl } from '../hooks/userFileUrls';
import { PreviewDialog } from './PreviewDialog';
import { usePreviewBackLink, type PreviewBack } from './PreviewHeader';

export type MediaKind = 'image' | 'audio' | 'video';

interface MediaPreviewModalProps {
    show: boolean;
    onClose: () => void;
    fileId: string;
    fileName: string;
    kind: MediaKind;
    back?: PreviewBack;
    /** A chat attachment: the caller's own user file, read from the library (and its session cache). */
    userFileId?: string;
}

const SUBTITLE_KEY: Record<MediaKind, string> = {
    image: 'previewImageSubtitle',
    audio: 'previewAudioSubtitle',
    video: 'previewVideoSubtitle',
};

/**
 * An image, recording or video source in the preview frame, in the browser's
 * own element. The file is fetched through the authenticated client (a
 * `src` URL could not carry the token); an image whose hover thumbnail was
 * already built reuses that download (`cachedSourceImage`).
 */
const MediaPreviewContent: React.FC<Omit<MediaPreviewModalProps, 'show'>> = ({ onClose, fileId, fileName, kind, back, userFileId }) => {
    const { t } = useTheme();
    const cached = kind === 'image' ? cachedSourceImage(fileId) : undefined;
    const [url, setUrl] = useState<string | null>(cached ?? null);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (cached) return;
        let revoke: string | null = null;
        let cancelled = false;
        if (userFileId) {
            // The session cache owns this URL (hooks/userFileUrls); it is not revoked here.
            void loadUserFileUrl(userFileId).then(u => {
                if (cancelled) return;
                if (u) setUrl(u); else setError(true);
            });
            return () => { cancelled = true; };
        }
        axios.get(`${API_BASE_URL}/api/files/${fileId}/download`, { responseType: 'blob' })
            .then(res => {
                const next = URL.createObjectURL(res.data as Blob);
                if (cancelled) { URL.revokeObjectURL(next); return; }
                revoke = next;
                setUrl(next);
            })
            .catch(() => { if (!cancelled) setError(true); });
        return () => {
            cancelled = true;
            // The cached image URL belongs to the thumbnail cache; only a URL
            // made here is revoked.
            if (revoke) URL.revokeObjectURL(revoke);
        };
    }, [cached, fileId, userFileId]);

    const backLink = usePreviewBackLink(back);
    const download = url && (
        <Button variant="ghost" size="icon" asChild>
            <a href={url} download={fileName} aria-label={`${t('download')} ${fileName}`} title={t('download')}>
                <Download size={16} aria-hidden="true" />
            </a>
        </Button>
    );

    return (
        <PreviewDialog
            onClose={onClose}
            kind={kind}
            title={fileName}
            subtitle={t(SUBTITLE_KEY[kind])}
            // Audio and video have no viewer toolbar of their own: the same
            // 48px row as the image, PDF and text viewers carries the back
            // link and the download.
            // An image's row is the ImageViewer's own, once it is there.
            toolbar={(kind !== 'image' || !url || error) && (
                <div className="flex h-12 shrink-0 items-center gap-1 border-b border-outline-variant pl-2 pr-[var(--dialog-close-inset,0.5rem)]">
                    {backLink}
                    <div className="ml-auto flex items-center gap-1">{download}</div>
                </div>
            )}
        >
            {kind === 'image' && url && !error ? (
                <ImageViewer
                    src={url}
                    alt={fileName}
                    className="min-h-0 flex-1"
                    onError={() => setError(true)}
                    labels={{
                        zoomIn: t('zoomIn'),
                        zoomOut: t('zoomOut'),
                        fit: t('previewFit'),
                        copy: t('previewCopyImage'),
                        copied: t('previewImageCopied'),
                        fullscreen: t('fullscreen'),
                        exitFullscreen: t('exitFullscreen'),
                        loadError: t('previewLoadError'),
                    }}
                    toolbarStart={backLink}
                    toolbarEnd={download}
                />
            ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
                {error ? (
                    <Alert tone="error" live="assertive" className="max-w-md">
                        <AlertDescription>{t('previewLoadError')}</AlertDescription>
                    </Alert>
                ) : !url ? (
                    <span className="inline-flex items-center gap-2 text-on-surface-variant">
                        <Loader2 className="animate-spin" size={20} aria-hidden="true" />
                        {t('previewLoading')}
                    </span>
                ) : kind === 'audio' ? (
                    // A user's own recording: there is no caption track to offer.
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <audio controls src={url} className="w-full max-w-xl" aria-label={fileName} />
                ) : (
                    // eslint-disable-next-line jsx-a11y/media-has-caption -- a user's own video: there is no caption track to offer
                    <video controls src={url} className="max-h-full max-w-full" aria-label={fileName} />
                )}
            </div>
            )}
        </PreviewDialog>
    );
};

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({ show, ...rest }) => {
    if (!show) return null;
    // Remount per file so the URL and error state reset.
    return <MediaPreviewContent key={rest.fileId} {...rest} />;
};
