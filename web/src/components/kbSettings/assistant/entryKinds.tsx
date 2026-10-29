import { MessageSquare, MessagesSquare, Upload, type LucideProps } from 'lucide-react';
import type { EntryKind } from './api';

/**
 * How a role card starts its chat, as an icon — the role card's avatar and
 * the editor's „Startet mit" chips: a chat bubble for the input field, two
 * for a start prompt (instruction), the upload icon for the file dropzone.
 */
export function KindIcon({ kind, ...props }: { kind: EntryKind } & LucideProps) {
    if (kind === 'file') return <Upload {...props} />;
    if (kind === 'task') return <MessagesSquare {...props} />;
    return <MessageSquare {...props} />;
}
