import type React from 'react';
import { AttachmentChip } from '@ki4jlu/design-system';
import type { MessageAttachment } from '../types';
import { useUserFileUrl } from '../hooks/userFileUrls';
import { hasThumbnail, previewKindOf } from '../utils/previewKind';

/**
 * A sent message's attachment as the composer's chip (DS AttachmentChip),
 * read-only: an image shows its thumbnail and a PDF its first page in the
 * hover preview, loaded from the owner's library (`useUserFileUrl`); a click
 * opens it in the preview window.
 */
export function AttachmentChipItem({ attachment, onOpen }: { attachment: MessageAttachment; onOpen?: (a: MessageAttachment) => void }) {
    const kind = previewKindOf({ name: attachment.name, type: attachment.mime });
    const url = useUserFileUrl(attachment.userFileId, kind === 'image' || kind === 'pdf');
    return (
        <AttachmentChip
            filename={attachment.name}
            mediaType={attachment.mime}
            url={hasThumbnail(kind) ? url : undefined}
            title={attachment.name}
            className="max-w-72"
            // A click (or Enter / Space) opens the preview window.
            {...(onOpen ? {
                role: 'button',
                tabIndex: 0,
                onClick: () => onOpen(attachment),
                onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(attachment); }
                },
            } : {})}
        />
    );
}
