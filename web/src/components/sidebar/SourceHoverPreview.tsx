import React, { useCallback, useEffect, useState } from 'react';
import { HoverCard, HoverCardTrigger, HoverCardContent, FilePreview } from '@ki4jlu/design-system';
import type { FileEntry } from '../../types';
import { preloadSourcePreview, useSourcePreview } from '../../hooks/sourcePreviews';

interface SourceHoverPreviewProps {
    file: FileEntry;
    /** The card row; it becomes the hover trigger (`asChild`). */
    children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
    /** Caption the preview with the file name (the rail shows no text). */
    showName?: boolean;
}

/**
 * The composer's attachment preview (DS `FilePreview`) on a sources-list row,
 * opening on hover over the whole card. The bitmap comes from the list's
 * preview cache (`useSourcePreviews`), so it is normally in memory before the
 * card opens; pointer-enter starts the build for any row the preload has not
 * reached yet, and a spinner covers that case.
 */
export function SourceHoverPreview({ file, children, showName = false }: SourceHoverPreviewProps) {
    const { image, pending } = useSourcePreview(file);
    const warmUp = useCallback(() => { void preloadSourcePreview(file); }, [file]);

    // Controlled, so a scroll can close it: the card is anchored to its row,
    // and scrolling the list (or the rail) carried it out of the viewport.
    // Any scroll while open closes it; the next hover opens it again.
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        // Capture: scroll events do not bubble, and the scroller is an ancestor.
        window.addEventListener('scroll', close, { capture: true, passive: true });
        return () => window.removeEventListener('scroll', close, { capture: true });
    }, [open]);

    const trigger = React.cloneElement(children, {
        onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
            warmUp();
            children.props.onPointerEnter?.(e);
        },
        onFocus: (e: React.FocusEvent<HTMLElement>) => {
            warmUp();
            children.props.onFocus?.(e);
        },
    });

    return (
        <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={100}>
            <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
            <HoverCardContent side="left" align="start" className="w-auto p-2">
                <FilePreview
                    filename={file.name}
                    mediaType={image?.mediaType ?? file.type}
                    url={image?.url}
                    loading={pending}
                />
                {showName && (
                    <p className="mt-2 w-40 truncate text-sm text-on-surface" title={file.name}>{file.name}</p>
                )}
            </HoverCardContent>
        </HoverCard>
    );
}
