import React from 'react';
import { FileSpreadsheet, FileText, FileType } from 'lucide-react';
import { DialogDescription, DialogTitle, cn } from '@ki4jlu/design-system';

export type PreviewKind = 'spreadsheet' | 'pdf' | 'text';

const KIND: Record<PreviewKind, { Icon: typeof FileText; tone: string }> = {
    spreadsheet: { Icon: FileSpreadsheet, tone: 'bg-success-container text-on-success-container' },
    pdf: { Icon: FileType, tone: 'bg-error-container text-on-error-container' },
    text: { Icon: FileText, tone: 'bg-info-container text-on-info-container' },
};

interface PreviewHeaderProps {
    kind: PreviewKind;
    title: string;
    /** One line under the title: format, size, "nur Lesen". */
    subtitle: string;
}

/**
 * The header every source preview shares (spreadsheet, PDF, text): a
 * file-type icon on its container tone, the file name as the dialog title and
 * a one-line description. No controls — those live in each preview's own
 * toolbar row below; the right edge leaves room for the dialog's close button.
 */
export const PreviewHeader: React.FC<PreviewHeaderProps> = ({ kind, title, subtitle }) => {
    const { Icon, tone } = KIND[kind];
    return (
        <div className="flex shrink-0 items-center gap-3 pt-4 pb-2 pr-14 pl-5">
            <div className={cn('grid size-10 shrink-0 place-items-center rounded-xl', tone)}>
                <Icon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-base font-semibold" title={title}>{title}</DialogTitle>
                <DialogDescription className="truncate text-xs">{subtitle}</DialogDescription>
            </div>
        </div>
    );
};
