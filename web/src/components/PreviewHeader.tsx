import React from 'react';
import { FileSpreadsheet, FileText, FileType } from 'lucide-react';
import { DialogDescription, DialogTitle, cn } from '@ki4jlu/design-system';
import { cleanSourceTitle } from '../utils/sourceDisplay';

export type PreviewKind = 'spreadsheet' | 'pdf' | 'text';

const KIND_ICON: Record<PreviewKind, typeof FileText> = {
    spreadsheet: FileSpreadsheet,
    pdf: FileType,
    text: FileText,
};

interface PreviewHeaderProps {
    kind: PreviewKind;
    title: string;
    /** One line under the title: format, size, "nur Lesen". */
    subtitle: string;
    /** Header actions left of the dialog's close button ("In Confluence öffnen"). */
    actions?: React.ReactNode;
}

/**
 * The header every source preview shares (spreadsheet, PDF, text): a
 * file-type icon on the shared primary-fixed tile, the cleaned file name as
 * the dialog title (the file name stays its tooltip) and
 * a one-line description. No controls — those live in each preview's own
 * toolbar row below; the right edge leaves room for the dialog's close button.
 */
export const PreviewHeader: React.FC<PreviewHeaderProps> = ({ kind, title, subtitle, actions }) => {
    const Icon = KIND_ICON[kind];
    return (
        <div className="flex shrink-0 items-center gap-3 pt-4 pb-2 pr-14 pl-5">
            {/* One tile tone for every document source, as in the source preview and list. */}
            <div className={cn('grid size-10 shrink-0 place-items-center rounded-xl', 'bg-primary-fixed text-on-primary-fixed-variant')}>
                <Icon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-base font-semibold" title={title}>{cleanSourceTitle(title)}</DialogTitle>
                <DialogDescription className="truncate text-xs">{subtitle}</DialogDescription>
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
    );
};
