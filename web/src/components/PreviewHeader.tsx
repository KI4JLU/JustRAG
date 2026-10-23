import React from 'react';
import { FileSpreadsheet, FileText, FileType } from 'lucide-react';
import { BreadcrumbBack, DialogDescription, DialogTitle, cn } from '@ki4jlu/design-system';
import { useTheme } from '../contexts/ThemeContext';
import { cleanSourceTitle } from '../utils/sourceDisplay';

export type PreviewKind = 'spreadsheet' | 'pdf' | 'text';

const KIND_ICON: Record<PreviewKind, typeof FileText> = {
    spreadsheet: FileSpreadsheet,
    pdf: FileType,
    text: FileText,
};

export interface PreviewHeaderProps {
    kind: PreviewKind;
    title: string;
    /** One line under the title: format, size, "nur Lesen". */
    subtitle: string;
    /** Header actions left of the dialog's close button ("In Confluence öffnen"). */
    actions?: React.ReactNode;
    /** The way back to the list this preview was opened from ("‹ Aktuelles (HRZ)"), above the title. */
    back?: PreviewBack;
}

/** The parent level of a preview opened from a list (a synced source's entries). */
export interface PreviewBack {
    trail: string[];
    onBack: () => void;
}

/**
 * The header every source preview shares (spreadsheet, PDF, text): a
 * file-type icon on the shared primary-fixed tile, the cleaned file name as
 * the dialog title (the file name stays its tooltip) and
 * a one-line description. No controls — those live in each preview's own
 * toolbar row below; the right edge leaves room for the dialog's close button.
 */
export const PreviewHeader: React.FC<PreviewHeaderProps> = ({ kind, title, subtitle, actions, back }) => {
    const { t } = useTheme();
    const Icon = KIND_ICON[kind];
    return (
        // The right edge keeps the dialog's close button clear, through its custom
        // property (DS Dialog `--dialog-close-reserve`), plus an 8px gap.
        <div className="flex shrink-0 items-center gap-3 pt-4 pb-2 pr-[calc(var(--dialog-close-reserve,3.5rem)_+_0.5rem)] pl-5">
            {/* One tile tone for every document source, as in the source preview and list. */}
            <div className={cn('grid size-10 shrink-0 place-items-center rounded-xl', 'bg-primary-fixed text-on-primary-fixed-variant')}>
                <Icon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
                {back && (
                    <BreadcrumbBack
                        className="mb-0.5"
                        trail={back.trail}
                        labels={{ nav: t('breadcrumbNav'), back: t('backTo') }}
                        onClick={back.onBack}
                    />
                )}
                <DialogTitle className="truncate text-base font-semibold" title={title}>{cleanSourceTitle(title)}</DialogTitle>
                <DialogDescription className="truncate text-xs">{subtitle}</DialogDescription>
            </div>
            {/* On the close button's line: a box as tall as the ✕, at its top
                inset (DS Dialog `--dialog-close-*`), whatever the title column's
                height (a back link above it makes the row taller). */}
            {actions && (
                <div className="flex h-[var(--dialog-close-size,2.25rem)] shrink-0 items-center gap-2 self-start mt-[calc(var(--dialog-close-inset,18px)_-_1rem)]">
                    {actions}
                </div>
            )}
        </div>
    );
};
