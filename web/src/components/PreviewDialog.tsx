import React from 'react';
import { Dialog, DialogContent, cn } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { PreviewHeader, type PreviewHeaderProps } from './PreviewHeader';
import { previewDialogClass } from './tablePreview/layout';

export interface PreviewDialogProps extends PreviewHeaderProps {
    onClose: () => void;
    /** Default true; a caller that keeps the dialog mounted passes its open state. */
    open?: boolean;
    /**
     * `document` — a reading window (PDF, text), 900px wide and 85% high;
     * `wide` — the table window, nearly the whole viewport, with `fullscreen`.
     */
    size?: 'document' | 'wide';
    /** `wide` only: the whole viewport, no frame. */
    fullscreen?: boolean;
    /** Rows under the title that belong to the header band (sheet tabs, a search strip). */
    toolbar?: React.ReactNode;
    onEscapeKeyDown?: (e: KeyboardEvent) => void;
    /** The document or table, on the page colour below the header band. */
    children: React.ReactNode;
}

/**
 * The ONE frame of every source preview (PDF, text, spreadsheet, a chat
 * table): the dialog box, the header band — `PreviewHeader` plus the
 * preview's own toolbar rows, all on the chrome surface (`bg-surface`) — and
 * the body below it on the page colour. A preview never builds its own
 * DialogContent or header, so their look cannot drift apart. The DS viewers
 * (`PdfViewer`, `RichTextEditor`) bring their toolbar inside the body; it sits
 * on the same `surface`.
 */
export function PreviewDialog({
    onClose, open = true, size = 'document', fullscreen = false, toolbar, onEscapeKeyDown, children,
    ...header
}: PreviewDialogProps) {
    const { t } = useTheme();
    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
            <DialogContent
                closeLabel={t('close')}
                onEscapeKeyDown={onEscapeKeyDown}
                className={size === 'wide'
                    ? previewDialogClass(fullscreen)
                    : cn('flex h-[85vh] w-[min(900px,90vw)] max-w-none flex-col gap-0 overflow-hidden p-0')}
            >
                <div data-slot="preview-header-band" className="shrink-0 bg-surface">
                    <PreviewHeader {...header} />
                    {toolbar}
                </div>
                {children}
            </DialogContent>
        </Dialog>
    );
}
