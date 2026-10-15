import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
    Download, Eye, EyeOff, Loader2, Maximize2, Minimize2, Search,
} from 'lucide-react';
import {
    Button, Dialog, DialogContent, Input, Kbd,
    Tabs, TabsContent, cn,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useLookupLabels, useSheetCounts, useSheetRows } from '../../hooks/useSheetRows';
import type { FileEntry, TabularFileDetail, TabularTable } from '../../types';
import {
    columnDecimals, columnKind, columnLabel, nextSort, parseCell, type SortState,
} from '../../utils/tableFormat';
import { PreviewHeader } from '../PreviewHeader';
import { SheetTable } from './SheetTable';
import { SheetTabs } from './SheetTabs';
import { ViewMenu } from './ViewMenu';
import type { DetailMode, ViewColumn, ViewRow } from './types';

interface TablePreviewDialogProps {
    show: boolean;
    kbId: string;
    fileId: string;
    fileName: string;
    /** The file's ingest status; undefined (unknown) is treated as done. */
    status?: FileEntry['status'];
    onClose: () => void;
}

type ContentProps = Omit<TablePreviewDialogProps, 'show'>;

/** Tab label: the sheet name, plus the region number when a sheet holds several tables. */
function tabLabel(table: TabularTable, tables: TabularTable[]): string {
    const regions = tables.filter(tbl => tbl.sheet_index === table.sheet_index).length;
    return regions > 1 ? `${table.sheet_name} · ${table.region_index + 1}` : table.sheet_name;
}

function fileKind(name: string): string {
    const ext = name.toLowerCase().split('.').pop() ?? '';
    return ext === 'csv' || ext === 'tsv' || ext === 'ods' ? ext.toUpperCase() : 'Excel';
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Spreadsheet source preview: the file's ingested SQL tables, read-only.
 * Sheet tabs with non-empty row counts, a toolbar (search, empty rows /
 * columns toggles, row-detail mode), the table, and a footer with counts,
 * the SQL table name and key hints. Search, sort and the empty-row filter run
 * on the server (GET …/tabular/rows); rows load page by page as the table
 * scrolls. Opens like every other source preview (row click,
 * `useWebTools.handlePreviewSource`).
 */
const TablePreviewContent: React.FC<ContentProps> = ({ kbId, fileId, fileName, status: fileStatus, onClose }) => {
    const { t, language } = useTheme();
    const toast = useToast();
    const locale = language === 'de' ? 'de-DE' : 'en-US';

    const [tables, setTables] = useState<TabularTable[] | null>(null);
    // A flag, not a translated string: the fetch effect must not depend on `t`.
    const [tablesError, setTablesError] = useState(false);
    const [active, setActive] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortState>(null);
    const [showEmptyRows, setShowEmptyRows] = useState(false);
    const [showEmptyCols, setShowEmptyCols] = useState(false);
    // Sheets hidden in the workbook (lookup lists, chart sources) are left out
    // by default, as Excel does; the catalog carries the flag per table.
    const [showHiddenSheets, setShowHiddenSheets] = useState(false);
    const [detailMode, setDetailMode] = useState<DetailMode>('inline');
    const [fullscreen, setFullscreen] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    // The SQL tables are complete only after the ingest; until then the
    // preview says so instead of showing a half-built or empty catalog.
    const ingesting = fileStatus === 'pending' || fileStatus === 'processing';
    const failed = fileStatus === 'error';

    useEffect(() => {
        if (ingesting || failed) return;
        let cancelled = false;
        axios.get<TabularFileDetail>(`${API_BASE_URL}/api/kb/${kbId}/files/${fileId}/tabular`)
            .then(res => {
                if (cancelled) return;
                const list = res.data.tables ?? [];
                setTables(list);
                setActive((list.find(tbl => !tbl.hidden) ?? list[0])?.table_name ?? '');
            })
            .catch(() => { if (!cancelled) setTablesError(true); });
        return () => { cancelled = true; };
    }, [kbId, fileId, ingesting, failed]);

    useEffect(() => {
        const id = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(id);
    }, [searchInput]);

    const tableNames = useMemo(() => (tables ?? []).map(tbl => tbl.table_name), [tables]);
    const hiddenSheetCount = (tables ?? []).filter(tbl => tbl.hidden).length;
    // A workbook of only hidden sheets shows them all, without a toggle.
    const hidingSheets = hiddenSheetCount > 0 && hiddenSheetCount < (tables?.length ?? 0);
    const shownTables = (tables ?? []).filter(tbl => !hidingSheets || showHiddenSheets || !tbl.hidden);
    const counts = useSheetCounts(kbId, fileId, tableNames);
    const sheet = useSheetRows(kbId, fileId, active, { search, sort, showEmpty: showEmptyRows });
    const table = tables?.find(tbl => tbl.table_name === active);

    // Code columns resolve their names from the linked lookup table; columns
    // whose value is already readable (a VLOOKUP result, a dropdown value)
    // only get the link.
    const codeRefs = useMemo(
        () => (table?.columns ?? [])
            .map(col => col.lookup)
            .filter((l): l is NonNullable<typeof l> => !!l && !l.via && l.key !== l.label),
        [table],
    );
    const lookupLabels = useLookupLabels(kbId, fileId, codeRefs);

    const columns: ViewColumn[] = useMemo(() => {
        const empty = new Set(sheet.emptyColumns ?? []);
        return (table?.columns ?? []).map((col, ci) => {
            const kind = columnKind(col.type);
            const l = col.lookup;
            const target = l && tables?.find(tbl => tbl.table_name === l.table);
            const isCode = !!l && !l.via && l.key !== l.label;
            return {
                name: col.name,
                label: columnLabel(col.name, col.original),
                kind,
                empty: empty.has(col.name),
                decimals: kind === 'number' ? columnDecimals(sheet.rows.map(r => parseCell(r.cells[ci] ?? null, kind))) : 0,
                lookup: l && target ? {
                    table: l.table,
                    sheet: tabLabel(target, tables ?? []),
                    kind: isCode ? 'code' : 'derived',
                    inferred: l.source === 'heuristic',
                    labels: isCode ? lookupLabels[`${l.table}.${l.key}.${l.label}`] : undefined,
                } : undefined,
            };
        });
    }, [table, tables, sheet.emptyColumns, sheet.rows, lookupLabels]);

    const rows: ViewRow[] = useMemo(
        () => sheet.rows.map(r => ({ id: r.id, empty: r.empty, cells: r.cells.map((c, ci) => parseCell(c, columns[ci]?.kind ?? 'text')) })),
        [sheet.rows, columns],
    );

    const visibleCols = columns.map((_, ci) => ci).filter(ci => showEmptyCols || !columns[ci].empty);
    const emptyColCount = columns.filter(c => c.empty).length;
    const emptyRows = sheet.emptyRows ?? 0;
    const searchable = (table?.row_count ?? 0) - emptyRows;

    // Jump to a linked lookup table, revealing it when it is a hidden sheet.
    const openTable = (tableName: string) => {
        if (tables?.find(tbl => tbl.table_name === tableName)?.hidden) setShowHiddenSheets(true);
        selectSheet(tableName);
    };

    const toggleHiddenSheets = () => {
        const next = !showHiddenSheets;
        setShowHiddenSheets(next);
        if (!next && table?.hidden) selectSheet((tables ?? []).find(tbl => !tbl.hidden)?.table_name ?? '');
    };

    function selectSheet(value: string) {
        setActive(value);
        setSearchInput('');
        setSearch('');
        setSort(null);
        setSelectedId(null);
    }

    const download = () => {
        axios.get(`${API_BASE_URL}/api/files/${fileId}/download`, { responseType: 'blob' })
            .then(res => {
                const url = URL.createObjectURL(res.data as Blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
            })
            .catch(() => toast.error(t('downloadFailed')));
    };

    const plural = (one: string, many: string, n: number) => (n === 1 ? t(one) : t(many).replace('{count}', String(n)));

    const status = (content: React.ReactNode, tone = 'text-on-surface-variant') => (
        <div className="flex min-h-48 flex-1 items-center justify-center p-8">
            <div className={cn('flex max-w-md items-center gap-2 text-center text-sm', tone)}>{content}</div>
        </div>
    );

    // Download and fullscreen sit at the end of the sheet-tab row (or alone in
    // that row while there are no tabs yet).
    const actions = (
        <>
            <Button variant="ghost" size="icon" className="size-8" aria-label={`${t('download')} ${fileName}`} title={t('tpDownloadOriginal')} onClick={download}>
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
        </>
    );

    let body: React.ReactNode;
    if (ingesting) body = status(<><Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />{t('tabularIngesting')}</>);
    else if (failed) body = status(t('tabularIngestFailed'));
    else if (tablesError) body = status(t('tabularLoadError'), 'text-error');
    else if (tables === null) body = status(<Loader2 className="size-5 animate-spin" aria-hidden="true" />);
    else if (tables.length === 0) body = status(t('tabularNoPreview'));

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                closeLabel={t('close')}
                onEscapeKeyDown={(e) => {
                    // Esc closes the row details first, the dialog second.
                    if (selectedId !== null) { e.preventDefault(); setSelectedId(null); }
                }}
                className={cn(
                    'flex flex-col gap-0 overflow-hidden p-0',
                    fullscreen
                        ? 'top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0'
                        // A fixed height, not content-sized: switching sheets, searching
                        // or loading rows must not resize the dialog (Sten, 2026-10-15).
                        : 'h-[calc(100dvh-3rem)] w-[calc(100vw-2rem)] max-w-[88rem] rounded-2xl',
                )}
            >
                {/* The shared preview header (icon, title, subtitle; no controls);
                    below it ONE row with the sheet tabs, download and fullscreen;
                    then the search / view strip and the table. */}
                <PreviewHeader
                    kind="spreadsheet"
                    title={fileName}
                    subtitle={t('tpSubtitle')
                        .replace('{kind}', fileKind(fileName))
                        .replace('{sheets}', plural('tpSheetsOne', 'tpSheetsMany', tables?.length ?? 0))}
                />

                {body && (
                    <div className="flex h-12 shrink-0 items-center justify-end gap-1 border-b border-outline-variant px-2">{actions}</div>
                )}

                {body ?? (
                    <Tabs value={active} onValueChange={selectSheet} className="flex min-h-0 flex-1 flex-col gap-0">
                        <SheetTabs
                            active={active}
                            tabs={shownTables.map(tbl => ({
                                value: tbl.table_name,
                                label: tabLabel(tbl, tables ?? []),
                                count: counts[tbl.table_name],
                                hidden: hidingSheets && tbl.hidden,
                            }))}
                            end={hidingSheets && (() => {
                                // Icon + count only; the full sentence is the tooltip and the
                                // accessible name.
                                const label = showHiddenSheets
                                    ? plural('tpHiddenSheetShown', 'tpHiddenSheetsShown', hiddenSheetCount)
                                    : plural('tpHiddenSheetHidden', 'tpHiddenSheetsHidden', hiddenSheetCount);
                                return (
                                    <Button variant="ghost" size="sm" aria-pressed={showHiddenSheets} aria-label={label} title={label} onClick={toggleHiddenSheets}>
                                        {showHiddenSheets ? <Eye className="size-3.5" aria-hidden="true" /> : <EyeOff className="size-3.5" aria-hidden="true" />}
                                        <span aria-hidden="true" className="tabular-nums">{hiddenSheetCount}</span>
                                    </Button>
                                );
                            })()}
                            actions={actions}
                        />

                        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-outline-variant bg-surface-container-lowest px-2">
                            {/* Borderless DS field so the strip stays 48px; the wrapper
                                carries the focus ring the inline variant leaves out. */}
                            <div className="relative min-w-0 max-w-sm flex-1 rounded-action focus-within:ring-2 focus-within:ring-focus-ring">
                                <Input
                                    variant="inline"
                                    leadingIcon={<Search />}
                                    placeholder={t('tpSearchPlaceholder').replace('{count}', searchable.toLocaleString(locale))}
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    aria-label={t('tpSearchLabel')}
                                />
                            </div>
                            <div className="ml-auto">
                                <ViewMenu
                                emptyRows={emptyRows}
                                showEmptyRows={showEmptyRows}
                                onShowEmptyRows={setShowEmptyRows}
                                emptyColumns={emptyColCount}
                                showEmptyCols={showEmptyCols}
                                onShowEmptyCols={setShowEmptyCols}
                                detailMode={detailMode}
                                onDetailMode={setDetailMode}
                                />
                            </div>
                        </div>

                        <TabsContent value={active} className="relative mt-0 flex min-h-0 flex-1 flex-col focus-visible:outline-none" tabIndex={-1}>
                            {sheet.error ? status(t('tabularLoadError'), 'text-error') : !table || (sheet.loading && rows.length === 0) ? (
                                status(<Loader2 className="size-5 animate-spin" aria-hidden="true" />)
                            ) : (
                                <SheetTable
                                    sheetName={table.sheet_name}
                                    columns={columns}
                                    visibleCols={visibleCols}
                                    rows={rows}
                                    matched={sheet.matched}
                                    query={search}
                                    sort={sort}
                                    onSort={(column) => { setSort(s => nextSort(s, column)); setSelectedId(null); }}
                                    detailMode={detailMode}
                                    selectedId={selectedId}
                                    onSelect={setSelectedId}
                                    hasMore={sheet.hasMore}
                                    loadingMore={sheet.loading && rows.length > 0}
                                    onLoadMore={sheet.loadMore}
                                    onOpenTable={openTable}
                                />
                            )}
                        </TabsContent>

                        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-outline-variant bg-surface-container-low px-4 py-2 text-xs text-on-surface-variant sm:px-6">
                            <span className="tabular-nums">
                                {t('tpFooterCounts')
                                    .replace('{shown}', sheet.matched.toLocaleString(locale))
                                    .replace('{total}', (table?.row_count ?? 0).toLocaleString(locale))
                                    .replace('{cols}', String(visibleCols.length))
                                    .replace('{allCols}', String(columns.length))}
                            </span>
                            <span className="hidden sm:inline">
                                SQL: <code className="font-mono text-on-surface">{active}</code>
                            </span>
                            <span className="ml-auto hidden items-center gap-1.5 md:flex">
                                <Kbd>↑</Kbd><Kbd>↓</Kbd> {t('tpKeysSelect')} · <Kbd>Esc</Kbd> {t('tpKeysClose')} · {t('tpKeysSort')}
                            </span>
                        </footer>
                    </Tabs>
                )}
            </DialogContent>
        </Dialog>
    );
};

export const TablePreviewDialog: React.FC<TablePreviewDialogProps> = ({ show, ...rest }) => {
    if (!show) return null;
    // Remount per file so every bit of state starts fresh (PdfPreviewModal pattern).
    return <TablePreviewContent key={rest.fileId} {...rest} />;
};
