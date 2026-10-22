import { FileSpreadsheet, FileText, FileType, Presentation, type LucideIcon } from 'lucide-react';
import { Button, cn } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import type { MessageSource } from '../../types';
import { fillTemplate, sourceMeta, type CitedSource, type SourceKind } from '../../utils/sourceDisplay';
import { SourceExcerpt } from './SourceExcerpt';

const KIND_ICON: Record<SourceKind, LucideIcon> = {
    pdf: FileType,
    table: FileSpreadsheet,
    markdown: FileText,
    text: FileText,
    word: FileText,
    slides: Presentation,
    document: FileText,
};

/** The 36px type tile every document source shares (preview, panel, modal). */
export function SourceKindTile({ kind, className }: { kind: SourceKind; className?: string }) {
    const Icon = KIND_ICON[kind];
    return (
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg bg-primary-fixed text-on-primary-fixed-variant', className)}>
            <Icon className="size-[18px]" aria-hidden="true" />
        </span>
    );
}

/** The number of a cited source, as the chip in the text shows it (not interactive). */
export function SourceNumber({ n, active = false, className }: { n: number; active?: boolean; className?: string }) {
    return (
        <span
            className={cn(
                'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] leading-none font-semibold',
                active ? 'bg-primary text-on-primary' : 'bg-primary-fixed text-on-primary-fixed-variant',
                className,
            )}
            aria-hidden="true"
        >
            {n}
        </span>
    );
}

interface SourcePreviewProps {
    source: CitedSource;
    passage: MessageSource;
    span?: { start: number; end: number };
    /** How many sources the answer cites ("Alle N Quellen"). */
    totalSources: number;
    onShowAll?: () => void;
    onOpenSource?: () => void;
    /** `sheet`: label/value pairs stacked, half-width 48px actions. */
    variant?: 'popover' | 'sheet';
    titleId?: string;
    /** The citing statement, to pick the excerpt's lines. */
    focus?: string;
    /** Why the chip is amber: the validator could not back this citation up. */
    notice?: string;
}

/**
 * The content of a source preview — head, cited passage, actions — and only
 * that: the hover popover (desktop) and the bottom sheet (touch) put the same
 * component in their own container.
 */
export function SourcePreview({ source, passage, span, totalSources, onShowAll, onOpenSource, variant = 'popover', titleId, focus, notice }: SourcePreviewProps) {
    const { t } = useTheme();
    const sheet = variant === 'sheet';
    return (
        <div className={cn('flex flex-col', sheet ? 'gap-4' : 'gap-3')}>
            <div className="flex items-center gap-3">
                <SourceKindTile kind={source.kind} className={sheet ? undefined : 'size-8 [&_svg]:size-4'} />
                <div className="min-w-0 flex-1">
                    <div id={titleId} className={cn('truncate font-semibold text-on-surface', sheet ? 'text-[15px]' : 'text-sm')} title={source.title}>{source.title}</div>
                    <div className="truncate text-xs text-on-surface-variant">{sourceMeta(t, source, passage)}</div>
                </div>
            </div>
            {notice && (
                <p className="m-0 rounded-lg bg-warning-container px-3 py-2 text-xs text-on-warning-container">{notice}</p>
            )}
            {passage.content && (
                <div className={cn('rounded-xl bg-surface-container-low text-sm text-on-surface', sheet ? 'p-4' : 'px-3 py-2.5')}>
                    <SourceExcerpt content={passage.content} span={span} clamp focus={focus} layout={sheet ? 'stack' : 'grid'} />
                </div>
            )}
            {(onShowAll || onOpenSource) && (
                <div className={cn('flex gap-2', sheet ? 'grid grid-cols-2' : 'justify-end')}>
                    {onShowAll && (
                        <Button type="button" variant="outline" className={cn('py-0 text-sm', sheet ? 'h-12 px-4' : 'h-8 px-3')} onClick={onShowAll}>
                            {totalSources > 1 ? fillTemplate(t('sourcesShowAll'), { count: totalSources }) : t('sourcesShowList')}
                        </Button>
                    )}
                    {onOpenSource && (
                        <Button type="button" className={cn('py-0 text-sm', sheet ? 'h-12 px-4' : 'h-8 px-3')} onClick={onOpenSource}>
                            {t('openInSource')}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
