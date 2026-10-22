import { cn } from '@ki4jlu/design-system';

/**
 * The table preview dialog's box, shared by the spreadsheet preview and the
 * in-memory one. A fixed height, not content-sized: switching sheets,
 * searching or loading rows must not resize the dialog (Sten, 2026-10-15).
 */
export function previewDialogClass(fullscreen: boolean): string {
    return cn(
        'flex flex-col gap-0 overflow-hidden p-0',
        fullscreen
            ? 'top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0'
            : 'h-[calc(100dvh-3rem)] w-[calc(100vw-2rem)] max-w-[88rem] rounded-2xl',
    );
}
