import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Download, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import {
    Badge, Button, Dialog, DialogContent, DialogTitle,
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@ki4jlu/design-system';
import { API_BASE_URL } from '../api';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import type { TabularFileDetail, TabularTable } from '../types';

interface TabularDetailModalProps {
    show: boolean;
    kbId: string;
    fileId: string;
    fileName: string;
    onClose: () => void;
}

type TabularDetailContentProps = Omit<TabularDetailModalProps, 'show'>;

/**
 * Spreadsheet source preview: the ingest report of GET
 * /api/kb/{kbId}/files/{fileId}/tabular (tabular.FileTabularDTO) — one page
 * per sheet with its counts and the materialized column structure. It opens
 * like every other source preview (row click, `useWebTools.handlePreviewSource`)
 * in the PDF preview's frame (`PdfPreviewModal`): the same dialog size, 56px
 * title row, and a PdfViewer-style 48px toolbar ending in download and
 * fullscreen above the pages.
 */
const TabularDetailContent: React.FC<TabularDetailContentProps> = ({ kbId, fileId, fileName, onClose }) => {
    const { t, language } = useTheme();
    const toast = useToast();
    const [detail, setDetail] = useState<TabularFileDetail | null>(null);
    // Content remounts per fileId (see the default export below), so this
    // effect fetches exactly once per mounted instance — the loading/error
    // state's initial values below are that fetch's starting state, not a
    // reset performed from inside the effect.
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const viewerRef = useRef<HTMLDivElement>(null);
    const [fullscreen, setFullscreen] = useState(false);
    const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;

    useEffect(() => {
        let cancelled = false;

        axios.get<TabularFileDetail>(`${API_BASE_URL}/api/kb/${kbId}/files/${fileId}/tabular`)
            .then(res => {
                if (cancelled) return;
                setDetail(res.data);
            })
            .catch(() => {
                if (cancelled) return;
                setError(t('tabularLoadError'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [kbId, fileId, t]);

    useEffect(() => {
        const onChange = () => setFullscreen(document.fullscreenElement === viewerRef.current);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const toggleFullscreen = () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void viewerRef.current?.requestFullscreen();
    };

    // The original file, through the authenticated client. The object URL is
    // made on click and revoked right after, so none outlives the download.
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

    const formatNum = (n: number): string =>
        language === 'de' ? n.toLocaleString('de-DE') : n.toLocaleString('en-US');

    // The report's Sheets array is appended in sheet-index order (one entry
    // per SheetInfo.Index, ingester.go) — the array position IS the
    // sheet_index tables[] entries reference, since ingest never skips or
    // reorders sheets (a failed sheet still gets a placeholder SheetReport).
    const tablesForSheet = (sheetIndex: number): TabularTable[] =>
        (detail?.tables ?? []).filter(tbl => tbl.sheet_index === sheetIndex);

    const status = (content: React.ReactNode, className = 'text-on-surface-variant') => (
        <div className={`flex h-full items-center justify-center gap-2 p-8 text-sm ${className}`}>{content}</div>
    );

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                closeLabel={t('close')}
                className="flex h-[85vh] w-[min(900px,90vw)] max-w-none flex-col gap-0 overflow-hidden p-0"
                aria-describedby={undefined}
            >
                <div className="flex h-14 shrink-0 items-center gap-3 border-b border-outline-variant pr-14 pl-5">
                    <DialogTitle className="min-w-0 flex-1 truncate text-base font-semibold" title={fileName}>
                        {fileName}
                    </DialogTitle>
                </div>

                <div ref={viewerRef} className="flex min-h-0 flex-1 flex-col bg-surface-container-low text-on-surface">
                    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-outline-variant bg-surface-container-lowest px-2">
                        {detail?.report && (
                            <span className="px-2 text-sm tabular-nums text-on-surface-variant">
                                {detail.report.sheets.length === 1
                                    ? t('tabularSheetCountOne')
                                    : t('tabularSheetCount').replace('{count}', formatNum(detail.report.sheets.length))}
                            </span>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={download} aria-label={`${t('download')} ${fileName}`} title={t('download')}>
                                <Download size={16} aria-hidden="true" />
                            </Button>
                            {fullscreenSupported && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={fullscreen ? t('exitFullscreen') : t('fullscreen')}
                                    aria-pressed={fullscreen}
                                    onClick={toggleFullscreen}
                                >
                                    {fullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-auto">
                        {loading && status(<Loader2 className="animate-spin" size={20} aria-hidden="true" />)}
                        {!loading && error && status(error, 'text-error')}
                        {!loading && !error && detail && detail.report === null && status(t('tabularNoReport'))}

                        {!loading && !error && detail?.report && (
                            <div className="flex flex-col gap-4 px-6 py-4">
                                {detail.report.sheets.map((sheet, sheetIndex) => (
                                    <section
                                        key={sheetIndex}
                                        aria-label={sheet.name}
                                        className="flex flex-col gap-3 bg-surface-container-lowest p-5 shadow-card"
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="mr-1 text-base font-semibold">{sheet.name}</h3>
                                            <Badge appearance="filled" tone="neutral" title={t('tabularKind')}>{sheet.kind}</Badge>
                                            {sheet.hidden && <Badge appearance="filled" tone="neutral">{t('tabularHidden')}</Badge>}
                                            {sheet.used_llm && <Badge appearance="filled" tone="info">{t('tabularUsedLLM')}</Badge>}
                                        </div>

                                        <dl className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-6 gap-y-1 text-sm text-on-surface-variant">
                                            {([
                                                ['tabularHeaderRow', sheet.header_row >= 0 ? formatNum(sheet.header_row + 1) : '—'],
                                                ['tabularRowsRead', formatNum(sheet.rows_read)],
                                                ['tabularRowsMaterialised', formatNum(sheet.rows_materialised)],
                                                ['tabularRowsEmbedded', formatNum(sheet.rows_embedded)],
                                                ['tabularRowsPastCap', formatNum(sheet.rows_past_cap)],
                                                ['tabularFormulaEmpty', formatNum(sheet.formula_cells_empty)],
                                                ['tabularCoercionFailures', formatNum(sheet.coercion_failures)],
                                                ...(sheet.dropped_columns > 0 ? [['tabularDroppedColumns', formatNum(sheet.dropped_columns)]] : []),
                                            ] as [string, string][]).map(([key, value]) => (
                                                <div key={key} className="flex justify-between gap-3">
                                                    <dt>{t(key)}</dt>
                                                    <dd className="tabular-nums text-on-surface">{value}</dd>
                                                </div>
                                            ))}
                                        </dl>

                                        {sheet.notes && sheet.notes.length > 0 && (
                                            <div className="text-sm">
                                                <div className="font-semibold">{t('tabularNotes')}</div>
                                                <ul className="list-disc pl-5 text-on-surface-variant">
                                                    {sheet.notes.map((note, i) => <li key={i}>{note}</li>)}
                                                </ul>
                                            </div>
                                        )}

                                        {tablesForSheet(sheetIndex).map(table => (
                                            <Table key={`${table.sheet_index}-${table.region_index}`} className="text-sm">
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>{t('tabularColHeader')}</TableHead>
                                                        <TableHead>{t('tabularColSQLName')}</TableHead>
                                                        <TableHead>{t('tabularColType')}</TableHead>
                                                        <TableHead>{t('tabularColRole')}</TableHead>
                                                        <TableHead>{t('tabularColDescription')}</TableHead>
                                                        <TableHead>{t('tabularColShadow')}</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {table.columns.map((col, i) => (
                                                        <TableRow key={i}>
                                                            <TableCell>{col.original}</TableCell>
                                                            <TableCell className="font-mono">{col.name}</TableCell>
                                                            <TableCell>{col.type}</TableCell>
                                                            <TableCell>{col.role || '—'}</TableCell>
                                                            <TableCell>{col.description || ''}</TableCell>
                                                            <TableCell className="font-mono">{col.shadow_of || col.shadow_column || ''}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        ))}
                                    </section>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export const TabularDetailModal: React.FC<TabularDetailModalProps> = ({ show, ...rest }) => {
    if (!show) return null;
    // Remount inner content on fileId change (PdfPreviewModal pattern) so
    // loading/error/detail state resets per file.
    return <TabularDetailContent key={rest.fileId} {...rest} />;
};
