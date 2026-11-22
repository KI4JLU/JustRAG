import React from 'react';
import {
    PreviewDialog as DsPreviewDialog,
    PreviewHeaderBand as DsPreviewHeaderBand,
} from '@ki4jlu/design-system';
import { useDsHeaderProps, type PreviewHeaderProps } from './PreviewHeader';

export interface PreviewDialogProps extends PreviewHeaderProps {
    onClose: () => void;
    /** Default true; a caller that keeps the dialog mounted passes its open state. */
    open?: boolean;
    /** `document` — a reading window (PDF, text, image); `wide` — the table window, with `fullscreen`. */
    size?: 'document' | 'wide';
    /** `wide` only: the whole viewport, no frame. */
    fullscreen?: boolean;
    /** Rows under the title that belong to the header band (sheet tabs, a search strip). */
    toolbar?: React.ReactNode;
    onEscapeKeyDown?: (e: KeyboardEvent) => void;
    /** The document or table, on the page colour below the header band. */
    children: React.ReactNode;
    /** The dialog's actions (a `DialogFooter`), below the body — never in the header. */
    footer?: React.ReactNode;
}

/**
 * The header band alone, for a dialog with its own frame (a synced source's
 * entry list): DS `PreviewHeaderBand` with the app's kinds and labels.
 */
export function PreviewHeaderBand({ toolbar, ...header }: PreviewHeaderProps & { toolbar?: React.ReactNode }) {
    return <DsPreviewHeaderBand {...useDsHeaderProps(header)} toolbar={toolbar} />;
}

/**
 * The ONE frame of every source preview (PDF, text, image, audio, video,
 * spreadsheet, a chat table, „Text einfügen"): DS `PreviewDialog`, fed with
 * the app's preview kind, file-name title and translated labels.
 */
export function PreviewDialog({
    onClose, open, size, fullscreen, toolbar, onEscapeKeyDown, children, footer, ...header
}: PreviewDialogProps) {
    return (
        <DsPreviewDialog
            {...useDsHeaderProps(header)}
            onClose={onClose}
            open={open}
            size={size}
            fullscreen={fullscreen}
            toolbar={toolbar}
            onEscapeKeyDown={onEscapeKeyDown}
            footer={footer}
        >
            {children}
        </DsPreviewDialog>
    );
}
