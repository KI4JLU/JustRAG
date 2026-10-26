import React, { useCallback, useEffect, useState } from 'react';
import { HoverCard, HoverCardTrigger, HoverCardContent, FilePreview } from '@ki4jlu/design-system';
import type { FileEntry } from '../../types';
import { preloadSourcePreview, useSourcePreview } from '../../hooks/sourcePreviews';
import { SOURCE_TYPE_CHIP, sourceDetailsTitle, type SourceDetailsTarget } from '../sources/sourceDetails';
import { useSourceFacts } from '../sources/sourceFacts';
import { SourceStatusDot } from '../sources/SourceStatusDot';

type Trigger = React.ReactElement<React.HTMLAttributes<HTMLElement>>;

/**
 * The hover card every source-list row shares: opens over the whole row after
 * a short delay, sits left of it, and closes on any scroll (it is anchored to
 * its row, and scrolling the list carried it out of the viewport). `onWarmUp`
 * runs on pointer-enter and focus, before the card opens.
 */
function SourceHoverCard({ children, onWarmUp, content }: { children: Trigger; onWarmUp?: () => void; content: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        // Capture: scroll events do not bubble, and the scroller is an ancestor.
        window.addEventListener('scroll', close, { capture: true, passive: true });
        return () => window.removeEventListener('scroll', close, { capture: true });
    }, [open]);

    const trigger = onWarmUp ? React.cloneElement(children, {
        onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
            onWarmUp();
            children.props.onPointerEnter?.(e);
        },
        onFocus: (e: React.FocusEvent<HTMLElement>) => {
            onWarmUp();
            children.props.onFocus?.(e);
        },
    }) : children;

    return (
        <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={100}>
            <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
            <HoverCardContent side="left" align="start" className="w-auto p-2">{content}</HoverCardContent>
        </HoverCard>
    );
}

interface SourceHoverPreviewProps {
    file: FileEntry;
    /** The card row; it becomes the hover trigger (`asChild`). */
    children: Trigger;
    /** Caption the preview with the file name (the rail shows no text). */
    showName?: boolean;
}

/**
 * The composer's attachment preview (DS `FilePreview`) on a sources-list row:
 * a picture, a PDF's first page or the first lines of a text source. The
 * preview comes from the list's cache (`useSourcePreviews`), so a picture is
 * normally in memory before the card opens; pointer-enter starts the build
 * for anything the preload has not reached (text sources always), and a
 * spinner covers that case.
 */
export function SourceHoverPreview({ file, children, showName = false }: SourceHoverPreviewProps) {
    const { image, pending } = useSourcePreview(file);
    const warmUp = useCallback(() => { void preloadSourcePreview(file); }, [file]);

    return (
        <SourceHoverCard onWarmUp={warmUp} content={<>
            <FilePreview
                filename={file.name}
                mediaType={image?.mediaType ?? file.type}
                url={image?.url}
                text={image?.text}
                loading={pending}
            />
            {showName && (
                <p className="mt-2 w-40 truncate text-sm text-on-surface" title={file.name}>{file.name}</p>
            )}
        </>}>
            {children}
        </SourceHoverCard>
    );
}

/**
 * A synced source's row (feed, Confluence space, repository) in the same
 * card: its title, size, state, schedule and last sync — the facts its
 * details dialog's header shows (`useSourceFacts`; the next run stays in the
 * dialog, the card has no room for it) — with its type chip.
 */
export function SyncedSourceHoverPreview({ target, children }: { target: SourceDetailsTarget; children: Trigger }) {
    const f = useSourceFacts(target);
    return (
        <SourceHoverCard content={(
            <FilePreview badge={SOURCE_TYPE_CHIP[target.kind]}>
                <p className="m-0 line-clamp-2 font-medium leading-snug break-words">{sourceDetailsTitle(target)}</p>
                <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-on-surface-variant">
                    <span>{f.count} {f.countLabel}</span>
                    <span className="inline-flex items-center gap-1.5"><SourceStatusDot tone={f.statusTone} />{f.progress ?? f.statusLabel}</span>
                </p>
                <p className="m-0 text-on-surface-variant">{f.schedule}</p>
                <p className="m-0 text-on-surface-variant">
                    {f.lastLabel}<br /><span className="text-on-surface">{f.dateTime(f.lastAt)}</span>
                </p>
            </FilePreview>
        )}>
            {children}
        </SourceHoverCard>
    );
}
