import React, { useEffect, useRef } from 'react';
import {
    ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, ChevronUp, Hash, Link2, Loader2, Type, X,
} from 'lucide-react';
import { Button, cn } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { lookupKey } from '../../hooks/useSheetRows';
import { formatCell, type SortState } from '../../utils/tableFormat';
import { RowDetail } from './RowDetail';
import type { DetailMode, ViewColumn, ViewRow } from './types';

interface SheetTableProps {
    sheetName: string;
    /** Every column (for the row detail). */
    columns: ViewColumn[];
    /** Indexes into `columns` shown as table columns. */
    visibleCols: number[];
    rows: ViewRow[];
    /** Rows matching the current filter on the server (all pages). */
    matched: number;
    query: string;
    sort: SortState;
    onSort: (column: string) => void;
    detailMode: DetailMode;
    selectedId: number | null;
    onSelect: (id: number | null) => void;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    /** Opens a linked lookup table's tab. */
    onOpenTable: (table: string) => void;
    /** The row details' source line; default: the sheet and SQL row id. */
    rowSourceLabel?: (row: ViewRow) => string;
}

/** The first case-insensitive occurrence of `q` in `text`, marked. */
function Highlight({ text, q }: { text: string; q: string }) {
    const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (i < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, i)}
            <mark className="rounded-sm bg-primary-fixed px-0.5 text-on-primary-fixed">{text.slice(i, i + q.length)}</mark>
            {text.slice(i + q.length)}
        </>
    );
}

function NullValue({ label }: { label: string }) {
    return (
        <span className="text-on-surface-variant/50" title="NULL">
            <span aria-hidden="true">–</span>
            <span className="sr-only">{label}</span>
        </span>
    );
}

/**
 * One sheet as a read-only table: sticky header and `#` column, sortable
 * headers (asc → desc → off, NULL last, `aria-sort`), number columns
 * right-aligned and as narrow as their content, text clamped to two lines
 * with the full value in `title`. A click selects a row; its full record
 * opens under it (`inline`) or in a 22rem side panel (`panel`, an overlay on
 * small screens). ↑/↓ (also j/k) move the selection — not while typing in
 * the search field, which lives outside this component. More rows load as the
 * end scrolls into view, or with the button at the end.
 */
export const SheetTable: React.FC<SheetTableProps> = ({
    sheetName, columns, visibleCols, rows, matched, query, sort, onSort,
    detailMode, selectedId, onSelect, hasMore, loadingMore, onLoadMore, onOpenTable, rowSourceLabel,
}) => {
    const { t, language } = useTheme();
    const locale = language === 'de' ? 'de-DE' : 'en-US';
    const scrollRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLTableRowElement>(null);

    const selIndex = rows.findIndex(r => r.id === selectedId);
    const selRow = selIndex >= 0 ? rows[selIndex] : null;

    // Load the next page as the end of the table scrolls into view.
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(
            entries => { if (entries.some(e => e.isIntersecting)) onLoadMore(); },
            { root: scrollRef.current, rootMargin: '200px' },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [hasMore, onLoadMore, rows.length]);

    const move = (delta: number) => {
        if (!rows.length) return;
        const next = selIndex < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, selIndex + delta));
        if (delta > 0 && selIndex === rows.length - 1 && hasMore) onLoadMore();
        const id = rows[next].id;
        onSelect(id);
        requestAnimationFrame(() =>
            scrollRef.current?.querySelector(`[data-row-id="${id}"]`)?.scrollIntoView?.({ block: 'nearest' }),
        );
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
    };

    const cellText = (row: ViewRow, ci: number) => {
        const col = columns[ci];
        const v = row.cells[ci] ?? null;
        return v === null ? '' : formatCell(v, col.kind, col.decimals, locale);
    };

    return (
        <div className="relative flex min-h-0 flex-1">
            {/* The scrollable region is focusable so keyboard users can scroll it
                (axe scrollable-region-focusable); ↑/↓/j/k move the row selection
                from here. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- focusable scroll region (WCAG 2.1.1), see above */}
            <div role="region" tabIndex={0} onKeyDown={onKeyDown}
                ref={scrollRef}
                aria-label={t('tpTableLabel').replace('{sheet}', sheetName)}
                className="min-h-0 min-w-0 flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
            >
                <table className="w-full border-separate border-spacing-0 text-sm text-on-surface">
                    <thead>
                        <tr>
                            <th scope="col" className="sticky top-0 left-0 z-30 w-12 border-b border-outline-variant bg-surface-container-low px-3 text-right text-xs font-medium text-on-surface-variant">
                                <span className="sr-only">{t('tpRowNumber')}</span>#
                            </th>
                            {visibleCols.map(ci => {
                                const col = columns[ci];
                                const active = sort?.column === col.name;
                                const SortIcon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
                                const code = col.lookup?.kind === 'code';
                                const num = col.kind === 'number' && !code;
                                const TypeIcon = col.kind === 'number' ? Hash : Type;
                                return (
                                    <th
                                        key={col.name}
                                        scope="col"
                                        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                                        className={cn(
                                            'sticky top-0 z-20 border-b border-outline-variant bg-surface-container-low p-0 align-bottom font-medium',
                                            num || col.name === 'nr' ? 'w-px' : 'min-w-[14rem]',
                                        )}
                                    >
                                        <div className="flex items-end">
                                        {/* eslint-disable-next-line design-system/no-raw-ui-elements -- full-cell, two-line sort control (label + SQL name); DS Button sizes are single-line */}
                                        <button
                                            type="button"
                                            onClick={() => onSort(col.name)}
                                            className={cn(
                                                'group flex w-full flex-col px-3 py-2 text-left hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring',
                                                num && 'items-end text-right',
                                            )}
                                            title={t('tpSortHint')
                                                .replace('{name}', col.name)
                                                .replace('{type}', num ? t('tpTypeNumber') : t('tpTypeText'))}
                                        >
                                            <span className={cn('flex items-center gap-1.5 whitespace-nowrap text-on-surface', num && 'flex-row-reverse')}>
                                                <TypeIcon className="size-3.5 text-on-surface-variant" aria-hidden="true" />
                                                {col.label}
                                                {col.empty && <span className="font-normal text-on-surface-variant">({t('tpColumnEmpty')})</span>}
                                                <SortIcon
                                                    className={cn('size-3.5', active ? 'text-primary' : 'text-on-surface-variant opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')}
                                                    aria-hidden="true"
                                                />
                                            </span>
                                        </button>
                                        {col.lookup && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="mb-1 size-7 shrink-0 text-primary"
                                                aria-label={t(col.lookup.inferred ? 'tpOpenLookupInferred' : 'tpOpenLookup').replace('{sheet}', col.lookup.sheet)}
                                                title={t(col.lookup.inferred ? 'tpOpenLookupInferred' : 'tpOpenLookup').replace('{sheet}', col.lookup.sheet)}
                                                onClick={() => onOpenTable(col.lookup!.table)}
                                            >
                                                <Link2 className="size-3.5" aria-hidden="true" />
                                            </Button>
                                        )}
                                        </div>
                                    </th>
                                );
                            })}
                            {detailMode === 'inline' && (
                                <th scope="col" className="sticky top-0 z-20 w-10 border-b border-outline-variant bg-surface-container-low">
                                    <span className="sr-only">{t('tpDetails')}</span>
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, ri) => {
                            const isSel = row.id === selectedId;
                            return (
                                <React.Fragment key={row.id}>
                                    <tr
                                        data-row-id={row.id}
                                        data-state={isSel ? 'selected' : undefined}
                                        aria-selected={isSel}
                                        onClick={() => onSelect(isSel ? null : row.id)}
                                        className={cn(
                                            // No colour transition: the sticky # cell needs its own opaque
                                            // background and switches instantly, so a fading row would
                                            // split the highlight for a moment while the pointer moves.
                                            'group/row cursor-pointer hover:bg-surface-container-high',
                                            isSel && 'bg-secondary-container hover:bg-secondary-container',
                                            row.empty && 'text-on-surface-variant/60',
                                        )}
                                    >
                                        <td className={cn(
                                            'sticky left-0 z-10 border-b border-outline-variant px-3 py-2 align-top text-right text-xs leading-5 tabular-nums text-on-surface-variant',
                                            isSel ? 'bg-secondary-container shadow-[inset_3px_0_0_var(--color-primary)]' : 'bg-surface-container-lowest group-hover/row:bg-surface-container-high',
                                        )}>
                                            {ri + 1}
                                        </td>
                                        {visibleCols.map(ci => {
                                            const col = columns[ci];
                                            const v = row.cells[ci] ?? null;
                                            const code = col.lookup?.kind === 'code';
                                            const num = col.kind === 'number' && !code;
                                            const text = cellText(row, ci);
                                            const name = code && v !== null ? col.lookup!.labels?.get(lookupKey(v)) : undefined;
                                            return (
                                                <td
                                                    key={col.name}
                                                    className={cn('border-b border-outline-variant px-3 py-2 align-top', num && 'text-right tabular-nums whitespace-nowrap')}
                                                >
                                                    {v === null ? <NullValue label={t('tpNull')} /> : name !== undefined ? (
                                                        <span className="line-clamp-2" title={`${text} · ${name}`}>
                                                            <span className="tabular-nums text-on-surface-variant"><Highlight text={text} q={query} /></span>
                                                            {' · '}{name}
                                                        </span>
                                                    ) : (
                                                        <span className={cn(!num && 'line-clamp-2')} title={!num ? text : undefined}>
                                                            <Highlight text={text} q={query} />
                                                        </span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                        {detailMode === 'inline' && (
                                            <td className="border-b border-outline-variant pr-3 text-right text-on-surface-variant">
                                                {isSel
                                                    ? <ChevronDown className="ml-auto size-4" aria-hidden="true" />
                                                    : <ChevronRight className="ml-auto size-4 opacity-0 group-hover/row:opacity-100" aria-hidden="true" />}
                                            </td>
                                        )}
                                    </tr>
                                    {detailMode === 'inline' && isSel && (
                                        <tr className="bg-surface-container-low">
                                            <td className="sticky left-0 border-b border-outline-variant bg-surface-container-low shadow-[inset_3px_0_0_var(--color-primary)]" />
                                            <td colSpan={visibleCols.length + 1} className="border-b border-outline-variant px-3 py-4">
                                                <div className="sticky left-15 max-w-[min(100%,72rem)]">
                                                    <RowDetail columns={columns} row={row} sheetName={sheetName} layout="grid" onOpenTable={onOpenTable} sourceLabel={rowSourceLabel} />
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        {rows.length === 0 && !loadingMore && (
                            <tr>
                                <td colSpan={visibleCols.length + 2} className="px-3 py-12 text-center text-on-surface-variant">
                                    {query ? t('tpNoRowsFor').replace('{q}', query) : t('tpNoRows')}
                                </td>
                            </tr>
                        )}
                        {(hasMore || loadingMore) && (
                            <tr ref={sentinelRef}>
                                <td colSpan={visibleCols.length + 2} className="px-3 py-3 text-center">
                                    {loadingMore ? (
                                        <Loader2 className="mx-auto size-4 animate-spin text-on-surface-variant" aria-hidden="true" />
                                    ) : (
                                        <Button variant="ghost" size="sm" onClick={onLoadMore}>
                                            {t('tpLoadMore').replace('{shown}', String(rows.length)).replace('{total}', String(matched))}
                                        </Button>
                                    )}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {detailMode === 'panel' && selRow && (
                <aside
                    aria-label={t('tpDetails')}
                    className="flex w-[22rem] shrink-0 flex-col border-l border-outline-variant bg-surface-container-low max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-[min(22rem,90%)] max-md:shadow-overlay"
                >
                    <div className="flex items-center gap-1 border-b border-outline-variant px-4 py-2">
                        <h3 className="mr-auto text-sm font-semibold text-on-surface">
                            {t('tpRowOf').replace('{n}', String(selIndex + 1)).replace('{total}', String(matched))}
                        </h3>
                        <Button variant="ghost" size="icon" aria-label={t('tpPrevRow')} onClick={() => move(-1)} disabled={selIndex <= 0}>
                            <ChevronUp className="size-4" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={t('tpNextRow')} onClick={() => move(1)} disabled={selIndex >= rows.length - 1 && !hasMore}>
                            <ChevronDown className="size-4" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={t('tpCloseDetails')} onClick={() => onSelect(null)}>
                            <X className="size-4" aria-hidden="true" />
                        </Button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-4">
                        <RowDetail columns={columns} row={selRow} sheetName={sheetName} layout="list" onOpenTable={onOpenTable} sourceLabel={rowSourceLabel} />
                    </div>
                </aside>
            )}
        </div>
    );
};
