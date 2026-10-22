import React, { useMemo, useState } from 'react';
import { Download, Maximize2, Minimize2, Search } from 'lucide-react';
import { Button, Dialog, DialogContent, Input, Kbd } from '@ki4jlu/design-system';
import { useTheme } from '../../contexts/ThemeContext';
import { nextSort, type SortState } from '../../utils/tableFormat';
import { searchRows, sortRows, toLocalTable } from '../../utils/localTable';
import { PreviewHeader } from '../PreviewHeader';
import { previewDialogClass } from './layout';
import { SheetTable } from './SheetTable';
import { ViewMenu } from './ViewMenu';
import type { DetailMode, ViewRow } from './types';

interface LocalTablePreviewDialogProps {
    /** The table's cells, row-major (MarkdownTable's extractRows). */
    cells: string[][];
    /** The first row is the header; otherwise every row is data and the columns are numbered. */
    hasHeader: boolean;
    /** Exports the table as the answer shows it (the footer's .xlsx download). */
    onDownload: () => void;
    onClose: () => void;
}

/**
 * The table preview for a table the browser already holds — a Markdown table
 * in an AI answer, opened from its footer's "Maximize" button. The same
 * dialog, toolbar and SheetTable as the spreadsheet preview
 * (TablePreviewDialog), without a server behind it: every row is in memory,
 * so search and sort run here and nothing pages. No sheet tabs (one table)
 * and no empty-row / empty-column filters (an answer's table has none worth
 * hiding); the view menu keeps the row-details layout.
 */
export const LocalTablePreviewDialog: React.FC<LocalTablePreviewDialogProps> = ({ cells, hasHeader, onDownload, onClose }) => {
    const { t, language } = useTheme();
    const locale = language === 'de' ? 'de-DE' : 'en-US';

    const table = useMemo(() => toLocalTable(cells, t('ltpColumn'), hasHeader), [cells, hasHeader, t]);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortState>(null);
    const [detailMode, setDetailMode] = useState<DetailMode>('inline');
    const [fullscreen, setFullscreen] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const visibleCols = useMemo(() => table.columns.map((_, ci) => ci), [table]);
    const rows = useMemo(
        () => sortRows(table, searchRows(table, visibleCols, search, locale), sort, locale),
        [table, visibleCols, search, sort, locale],
    );

    const plural = (one: string, many: string, n: number) => (n === 1 ? t(one) : t(many).replace('{count}', n.toLocaleString(locale)));
    const rowCount = table.rows.length;
    const colCount = table.columns.length;
    const sheetName = t('ltpSheetName');
    const rowSourceLabel = (row: ViewRow) => t('ltpSource').replace('{row}', String(row.id));

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                closeLabel={t('close')}
                onEscapeKeyDown={(e) => {
                    // Esc closes the row details first, the dialog second.
                    if (selectedId !== null) { e.preventDefault(); setSelectedId(null); }
                }}
                className={previewDialogClass(fullscreen)}
            >
                <PreviewHeader
                    kind="spreadsheet"
                    title={t('ltpTitle')}
                    subtitle={t('ltpSubtitle')
                        .replace('{rows}', plural('mdTableRowsOne', 'mdTableRowsMany', rowCount))
                        .replace('{cols}', plural('mdTableColsOne', 'mdTableColsMany', colCount))}
                />

                <div className="flex h-12 shrink-0 items-center gap-1 border-y border-outline-variant bg-surface-container-lowest px-2">
                    {/* Borderless DS field so the strip stays 48px; the wrapper
                        carries the focus ring the inline variant leaves out. */}
                    <div className="relative min-w-0 max-w-sm flex-1 rounded-action focus-within:ring-2 focus-within:ring-focus-ring">
                        <Input
                            variant="inline"
                            leadingIcon={<Search />}
                            placeholder={t('tpSearchPlaceholder').replace('{count}', rowCount.toLocaleString(locale))}
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); setSelectedId(null); }}
                            aria-label={t('tpSearchLabel')}
                        />
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                        <ViewMenu
                            emptyRows={0}
                            showEmptyRows={false}
                            onShowEmptyRows={() => {}}
                            emptyColumns={0}
                            showEmptyCols={false}
                            onShowEmptyCols={() => {}}
                            detailMode={detailMode}
                            onDetailMode={setDetailMode}
                        />
                        <Button variant="ghost" size="icon" className="size-8" aria-label={t('mdTableDownloadXlsx')} title={t('mdTableDownloadXlsx')} onClick={onDownload}>
                            <Download className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={fullscreen ? t('exitFullscreen') : t('fullscreen')}
                            aria-pressed={fullscreen}
                            onClick={() => setFullscreen(f => !f)}
                        >
                            {fullscreen ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
                        </Button>
                    </div>
                </div>

                <div className="relative flex min-h-0 flex-1 flex-col">
                    <SheetTable
                        sheetName={sheetName}
                        columns={table.columns}
                        visibleCols={visibleCols}
                        rows={rows}
                        matched={rows.length}
                        query={search.trim()}
                        sort={sort}
                        onSort={(column) => { setSort(s => nextSort(s, column)); setSelectedId(null); }}
                        detailMode={detailMode}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        hasMore={false}
                        loadingMore={false}
                        onLoadMore={() => {}}
                        onOpenTable={() => {}}
                        rowSourceLabel={rowSourceLabel}
                    />
                </div>

                <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-outline-variant bg-surface-container-low px-4 py-2 text-xs text-on-surface-variant sm:px-6">
                    <span className="tabular-nums">
                        {t('ltpFooterCounts')
                            .replace('{shown}', rows.length.toLocaleString(locale))
                            .replace('{total}', rowCount.toLocaleString(locale))
                            .replace('{cols}', String(colCount))}
                    </span>
                    <span className="ml-auto hidden items-center gap-1.5 md:flex">
                        <Kbd>↑</Kbd><Kbd>↓</Kbd> {t('tpKeysSelect')} · <Kbd>Esc</Kbd> {t('tpKeysClose')} · {t('tpKeysSort')}
                    </span>
                </footer>
            </DialogContent>
        </Dialog>
    );
};
