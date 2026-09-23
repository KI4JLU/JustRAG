import React, { useCallback } from 'react';
import { HoverCard, HoverCardTrigger, HoverCardContent, FilePreview } from '@ki4jlu/design-system';
import type { FileEntry } from '../../types';
import { preloadSourcePreview, useSourcePreview } from '../../hooks/sourcePreviews';

interface SourceHoverPreviewProps {
    file: FileEntry;
    /** The card row; it becomes the hover trigger (`asChild`). */
    children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}

/**
 * The composer's attachment preview (DS `FilePreview`) on a sources-list row,
 * opening on hover over the whole card. The bitmap comes from the list's
 * preview cache (`useSourcePreviews`), so it is normally in memory before the
 * card opens; pointer-enter starts the build for any row the preload has not
 * reached yet, and a spinner covers that case.
 */
export function SourceHoverPreview({ file, children }: SourceHoverPreviewProps) {
    const { image, pending } = useSourcePreview(file);
    const warmUp = useCallback(() => { void preloadSourcePreview(file); }, [file]);

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
        <HoverCard openDelay={250} closeDelay={100}>
            <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
            <HoverCardContent side="left" align="start" className="w-auto p-2">
                <FilePreview
                    filename={file.name}
                    mediaType={image?.mediaType ?? file.type}
                    url={image?.url}
                    loading={pending}
                />
            </HoverCardContent>
        </HoverCard>
    );
}
