import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@ki4jlu/design-system';

interface ListPaginationProps {
    /** 0-based. */
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    /** „{from}–{to} von {total}". */
    rangeLabel: (range: { from: number; to: number; total: number }) => string;
    previousLabel: string;
    nextLabel: string;
}

/**
 * Range and previous/next under a list that is paged in the browser. Renders
 * nothing while everything fits on one page.
 */
export function ListPagination({ page, pageSize, total, onPageChange, rangeLabel, previousLabel, nextLabel }: ListPaginationProps) {
    if (total <= pageSize) return null;
    const pageCount = Math.ceil(total / pageSize);
    const from = page * pageSize + 1;
    const to = Math.min(total, (page + 1) * pageSize);
    return (
        <nav className="flex items-center justify-end gap-2" aria-label={rangeLabel({ from, to, total })}>
            <span className="text-sm text-on-surface-variant" aria-live="polite">{rangeLabel({ from, to, total })}</span>
            <Button type="button" variant="ghost" size="icon" onClick={() => onPageChange(page - 1)} disabled={page <= 0} aria-label={previousLabel} title={previousLabel}>
                <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount - 1} aria-label={nextLabel} title={nextLabel}>
                <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
        </nav>
    );
}
