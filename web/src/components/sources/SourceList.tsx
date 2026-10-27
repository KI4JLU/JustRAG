import { ChevronRight } from 'lucide-react';
import { cn } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { formatDate } from '../../utils/dates';
import { SOURCE_KIND_LABEL_KEY, fillTemplate, type CitedSource } from '../../utils/sourceDisplay';
import { SourceNumber } from './SourcePreview';

interface SourceListProps {
    sources: CitedSource[];
    /** Opens the source panel for a row; without it the rows are plain text. */
    onOpen?: (source: CitedSource) => void;
    /** The display number the source panel shows, if this answer's. */
    activeN?: number | null;
}

/**
 * The answer's expanded source list: one row per cited file, numbered like
 * the chips in the text, the whole row the control that opens it in the
 * source panel. Two columns from four sources on.
 */
export function SourceList({ sources, onOpen, activeN = null }: SourceListProps) {
    const { t, language } = useTheme();
    return (
        <ul className={cn('m-0 grid list-none gap-2 p-0', sources.length >= 4 && 'sm:grid-cols-2')}>
            {sources.map((s) => {
                const meta = [t(SOURCE_KIND_LABEL_KEY[s.kind])];
                if (s.dateIso) meta.push(formatDate(s.dateIso, language));
                if (s.passages.length > 1) meta.push(fillTemplate(t('sourcePassagesCited'), { count: s.passages.length }));
                const active = activeN === s.n;
                const body = (
                    <>
                        <SourceNumber n={s.n} active={active} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                            <span className="sr-only">{fillTemplate(t('sourceNumberLabel'), { n: s.n })}: </span>
                            <span className="block truncate text-sm font-medium text-on-surface" title={s.title}>{s.title}</span>
                            <span className="block truncate text-xs text-on-surface-variant">{meta.join(' · ')}</span>
                        </span>
                    </>
                );
                const rowClass = cn(
                    'flex min-h-14 w-full items-start gap-3 rounded-lg border bg-surface-container-lowest px-3 py-2.5 text-left',
                    active ? 'border-primary' : 'border-outline-variant',
                );
                return (
                    <li key={s.key} className="min-w-0">
                        {onOpen ? (
                            // eslint-disable-next-line design-system/no-raw-ui-elements -- the whole row is the control (brief §6); the DS has no list-row button
                            <button
                                type="button"
                                className={cn(rowClass, 'cursor-pointer transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring')}
                                onClick={() => onOpen(s)}
                            >
                                {body}
                                <ChevronRight className="mt-0.5 size-4 shrink-0 self-center text-on-surface-variant" aria-hidden="true" />
                            </button>
                        ) : (
                            <div className={rowClass}>{body}</div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
