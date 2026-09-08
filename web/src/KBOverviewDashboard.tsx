import { useState, useEffect, useCallback, useMemo, useId } from 'react';
import axios from 'axios';
import { RefreshCw, AlertTriangle, Search, ChevronDown, Hourglass, Play, XCircle, Trash2, UserCog, Globe } from 'lucide-react';
import {
    Button, Card, Checkbox, DashboardLayout, Input, Label, ListToolbar, Popover,
    PopoverContent, PopoverTrigger, Spinner, Stack, cn,
} from '@ki4jlu/design-system';
import { getApiErrorMessage } from './utils/apiError';
import { API_BASE_URL } from './api';
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './contexts/AuthContext';
import { KbDeleteDialog } from './components/admin/KbDeleteDialog';
import { KbPublishDialog } from './components/admin/KbPublishDialog';
import { KbTransferOwnerDialog } from './components/admin/KbTransferOwnerDialog';

/* ---------------------------------------------------------------------------
 * Shell: the design system's `DashboardLayout` template (card KI-714,
 * Stage 4b). The template's slot API and how it compares to `AuthLayout`'s two
 * known gaps are documented once, in Dashboard.tsx — read that first.
 *
 * What this file uses the slots for:
 *   toolbar -> `ListToolbar` (search field left, column-picker right). This is
 *              a LAYOUT CHANGE: the search field and the column picker used to
 *              sit in the same row as the heading. `toolbar` renders ABOVE the
 *              PageHeader, which is the template's documented place for a
 *              list's search/filter row, so the two controls move up one row.
 *   actions -> auto-refresh checkbox + refresh button (page actions, so they
 *              stay on the heading row).
 *   stats   -> the three queue-summary cards.
 *   children-> error, loading and the table.
 *
 * THE TABLE IS UNTOUCHED. Stage 5 (card KI-694) migrates `<table>` to
 * `Table`/`TableLayout`; this card is the outer page shell only, the same
 * discipline Stage 3b used for AdminEvalTab's tables. `thStyle`, `tdStyle`,
 * `cellStyle` and `rowStyle` therefore survive verbatim as TABLE styles, and
 * so do the two badge `<span>`s in `renderCell` — they are table cell content,
 * not page chrome. The three row-action `<button>`s DID become DS `Button`s:
 * swapping a control inside a `<td>` is not migrating the table markup.
 *
 * The heading level changes h2 -> h1, because PageHeader renders a real `<h1>`
 * and the level is not a prop. AdminUI.tsx already renders the admin page's
 * `<h1>`, so this page now has two. Reported as an open question — the fix is
 * either a heading-level prop in the DS or a change in AdminUI.tsx, neither of
 * which belongs in this card.
 * TODO: no visual confirmation in this pass; the stories exist for the
 * developer's both-theme pass.
 * ------------------------------------------------------------------------- */

interface QueueStats {
    waiting: number;
    active: number;
    failed: number;
}

interface KBRow {
    id: string;
    name: string;
    ownerName?: string;
    ownerId?: string;
    ownerUsername?: string;
    isGlobal: boolean;
    isPublished: boolean;
    fileCount: number;
    totalSizeBytes: number;
    failedFileCount: number;
    processingFileCount: number;
    webTurns: number;
    apiTurns: number;
    chatCount: number;
    lastFileUploadAt?: string;
    lastTurnAt?: string;
    createdAt: string;
}

interface OverviewResponse {
    rows: KBRow[];
    queueSummary: Record<string, QueueStats>;
    timestamp: string;
}

type SortKey = keyof Pick<KBRow,
    'name' | 'ownerName' | 'fileCount' | 'totalSizeBytes' | 'failedFileCount' |
    'processingFileCount' | 'chatCount' | 'createdAt'>
    | 'lastActivity' | 'activity';

interface ColumnDef {
    key: SortKey;
    label: string;
    numeric?: boolean;
    optional?: boolean;
}

// Most-recent of lastFileUploadAt / lastTurnAt, as a timestamp (NaN if neither).
function mergedActivityTs(row: KBRow): number {
    const a = row.lastFileUploadAt ? new Date(row.lastFileUploadAt).getTime() : NaN;
    const b = row.lastTurnAt ? new Date(row.lastTurnAt).getTime() : NaN;
    if (Number.isNaN(a) && Number.isNaN(b)) return NaN;
    if (Number.isNaN(a)) return b;
    if (Number.isNaN(b)) return a;
    return Math.max(a, b);
}

// The raw ISO string of whichever of the two timestamps is the most recent.
function mergedActivityIso(row: KBRow): string | undefined {
    const a = row.lastFileUploadAt ? new Date(row.lastFileUploadAt).getTime() : NaN;
    const b = row.lastTurnAt ? new Date(row.lastTurnAt).getTime() : NaN;
    if (Number.isNaN(a) && Number.isNaN(b)) return undefined;
    if (Number.isNaN(a)) return row.lastTurnAt;
    if (Number.isNaN(b)) return row.lastFileUploadAt;
    return a >= b ? row.lastFileUploadAt : row.lastTurnAt;
}

// Aktivität = every accepted turn on every surface. One combined column
// (web + API) keeps an already-wide table narrow; the split rides the tooltip.
function turnTotal(row: KBRow): number {
    return (row.webTurns ?? 0) + (row.apiTurns ?? 0);
}

function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Locale-aware relative time (improvement #5): drives "vor 2 Std." / "2 hr. ago"
// from the active UI language instead of the old hand-rolled mixed-language strings.
function formatRelative(iso: string | undefined, rtf: Intl.RelativeTimeFormat): string {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '—';
    const diffMs = then - Date.now(); // negative => in the past
    const sec = Math.round(diffMs / 1000);
    const min = Math.round(diffMs / 60000);
    const hr = Math.round(diffMs / 3600000);
    const day = Math.round(diffMs / 86400000);
    if (Math.abs(sec) < 60) return rtf.format(sec, 'second');
    if (Math.abs(min) < 60) return rtf.format(min, 'minute');
    if (Math.abs(hr) < 24) return rtf.format(hr, 'hour');
    return rtf.format(day, 'day');
}

const QUEUE_NAMES = ['rag-quick', 'rag-heavy', 'rag-batch'];

export default function KBOverviewDashboard() {
    const { t, language } = useTheme();
    const { user } = useAuth();
    // Delete and transfer stay superadmin-only. Publishing does not: it sits on
    // adminChain server-side (POST /api/admin/kb/{id}/publish), so plain system
    // admins get that one action — and therefore the actions column — too.
    const canManage = user?.role === 'superadmin';
    const canPublish = user?.role === 'admin' || user?.role === 'superadmin';
    const showActions = canManage || canPublish;
    const [deleteTarget, setDeleteTarget] = useState<KBRow | null>(null);
    const [publishTarget, setPublishTarget] = useState<KBRow | null>(null);
    const [transferTarget, setTransferTarget] = useState<KBRow | null>(null);
    const [actionBusy, setActionBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const rtf = useMemo(() => new Intl.RelativeTimeFormat(language, { numeric: 'auto' }), [language]);
    const [data, setData] = useState<OverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortAsc, setSortAsc] = useState(true);
    const [search, setSearch] = useState('');
    const [optionalVisible, setOptionalVisible] = useState<Record<string, boolean>>({
        processingFileCount: false,
        chatCount: false,
        createdAt: false,
    });
    // The DS Checkbox is a Radix <button role="checkbox">, which IS a labelable
    // element per HTML 4.10.4, so `Label htmlFor` + `Checkbox id` is a real
    // label/control pair. React generates the ids so no two mounts collide.
    const autoRefreshId = useId();
    const columnIdPrefix = useId();

    const fetchData = useCallback(async () => {
        setRefreshing(true);
        try {
            const res = await axios.get(`${API_BASE_URL}/api/admin/kb-overview`);
            setData(res.data as OverviewResponse);
            setError(null);
        } catch (err: unknown) {
            setError(getApiErrorMessage(err, t('kbOverviewLoadError')));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [t]);

    const confirmDelete = useCallback(async () => {
        if (!deleteTarget) return;
        setActionBusy(true);
        try {
            await axios.delete(`${API_BASE_URL}/api/admin/kbs/${deleteTarget.id}`);
            setDeleteTarget(null);
            setActionError(null);
            await fetchData();
        } catch (err: unknown) {
            setActionError(getApiErrorMessage(err, t('kbDeleteFailed')));
        } finally {
            setActionBusy(false);
        }
    }, [deleteTarget, fetchData, t]);

    // Publishing flips visibility to 'public' and (server-side) forces
    // is_published = false, so the row's badges change in two ways at once. The
    // local patch keeps the row honest the instant the request returns; the
    // refetch behind it reconciles the derived columns (owner is cleared on
    // publish) without a page reload — same shape as confirmDelete above.
    const confirmPublish = useCallback(async () => {
        if (!publishTarget) return;
        setActionBusy(true);
        try {
            await axios.post(`${API_BASE_URL}/api/admin/kb/${publishTarget.id}/publish`);
            const publishedId = publishTarget.id;
            setData((prev) => prev && {
                ...prev,
                rows: prev.rows.map((r) => r.id === publishedId
                    ? { ...r, isGlobal: true, isPublished: false, ownerName: undefined, ownerId: undefined, ownerUsername: undefined }
                    : r),
            });
            setPublishTarget(null);
            setActionError(null);
            await fetchData();
        } catch (err: unknown) {
            setActionError(getApiErrorMessage(err, t('kbPublishFailed')));
        } finally {
            setActionBusy(false);
        }
    }, [publishTarget, fetchData, t]);

    const confirmTransfer = useCallback(async (userId: string) => {
        if (!transferTarget) return;
        setActionBusy(true);
        try {
            await axios.patch(`${API_BASE_URL}/api/admin/kbs/${transferTarget.id}/owner`, { userId });
            setTransferTarget(null);
            setActionError(null);
            await fetchData();
        } catch (err: unknown) {
            setActionError(getApiErrorMessage(err, t('kbTransferFailed')));
        } finally {
            setActionBusy(false);
        }
    }, [transferTarget, fetchData, t]);

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [autoRefresh, fetchData]);

    const sortedRows = useMemo(() => {
        if (!data) return [];
        const needle = search.trim().toLowerCase();
        const rows = data.rows.filter((r) => !needle || r.name.toLowerCase().includes(needle));
        rows.sort((a, b) => {
            // 'lastActivity' is a synthetic column merging upload + message timestamps.
            if (sortKey === 'lastActivity') {
                const at = mergedActivityTs(a);
                const bt = mergedActivityTs(b);
                if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
                if (Number.isNaN(at)) return 1;
                if (Number.isNaN(bt)) return -1;
                return sortAsc ? at - bt : bt - at;
            }
            if (sortKey === 'activity') {
                const cmp = turnTotal(a) - turnTotal(b);
                return sortAsc ? cmp : -cmp;
            }
            const av = a[sortKey];
            const bv = b[sortKey];
            // Nullish values sort last regardless of direction.
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            let cmp: number;
            if (typeof av === 'number' && typeof bv === 'number') {
                cmp = av - bv;
            } else {
                cmp = String(av).localeCompare(String(bv));
            }
            return sortAsc ? cmp : -cmp;
        });
        return rows;
    }, [data, sortKey, sortAsc, search]);

    const toggleSort = (key: SortKey) => {
        if (key === sortKey) {
            setSortAsc(!sortAsc);
        } else {
            setSortKey(key);
            setSortAsc(true);
        }
    };

    const ALL_COLUMNS: ColumnDef[] = [
        { key: 'name', label: t('colName') },
        { key: 'ownerName', label: t('colOwner') },
        { key: 'fileCount', label: t('tabFiles'), numeric: true },
        { key: 'totalSizeBytes', label: t('colSize'), numeric: true },
        { key: 'failedFileCount', label: t('colFailed'), numeric: true },
        { key: 'activity', label: t('colActivity'), numeric: true },
        { key: 'lastActivity', label: t('colLastActivity') },
        { key: 'processingFileCount', label: t('colProcessing'), numeric: true, optional: true },
        { key: 'chatCount', label: t('colChats'), numeric: true, optional: true },
        { key: 'createdAt', label: t('colCreated'), optional: true },
    ];
    const columns = ALL_COLUMNS.filter((c) => !c.optional || optionalVisible[c.key]);
    const optionalColumns = ALL_COLUMNS.filter((c) => c.optional);

    /* SURVIVING INLINE STYLES — all four objects below style the `<table>`,
     * which Stage 5 (KI-694) owns. Migrating them here would be migrating the
     * table markup this card is explicitly told to leave alone. */
    const thStyle: React.CSSProperties = {
        textAlign: 'left', padding: '0.6rem 0.75rem', cursor: 'pointer',
        color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--border-color)', userSelect: 'none',
    };
    const tdStyle: React.CSSProperties = {
        padding: '0.6rem 0.75rem', color: 'var(--text-primary)',
        borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap',
    };

    const renderCell = (row: KBRow, key: SortKey): React.ReactNode => {
        switch (key) {
            case 'name':
                return (
                    <>
                        {row.name}
                        {row.isGlobal && <span style={{ marginLeft: 6, fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--shape-sm)', background: 'var(--accent-primary)', color: 'white' }}>{t('globalBadge')}</span>}
                        {row.isPublished && <span style={{ marginLeft: 6, fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--shape-sm)', border: '1px solid var(--border-color)' }}>{t('published')}</span>}
                    </>
                );
            case 'ownerName':
                return row.ownerName ?? '—';
            case 'fileCount':
                return row.fileCount;
            case 'totalSizeBytes':
                return formatBytes(row.totalSizeBytes);
            case 'failedFileCount':
                return (
                    <>
                        {row.failedFileCount > 0 && <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
                        {row.failedFileCount}
                    </>
                );
            case 'activity':
                return turnTotal(row);
            case 'processingFileCount':
                return row.processingFileCount;
            case 'chatCount':
                return row.chatCount;
            case 'lastActivity':
                return formatRelative(mergedActivityIso(row), rtf);
            case 'createdAt':
                return formatRelative(row.createdAt, rtf);
            default:
                return null;
        }
    };

    return (
        <DashboardLayout
            /* See Dashboard.tsx for why: index.css reverts h1-h6 and p margins
             * to the UA values in `@layer base`, and PageHeader's own h1/p
             * carry no margin utility. */
            className="[&>header_h1]:m-0 [&>header_p]:m-0"
            title={t('adminTabKbOverview')}
            toolbar={
                <ListToolbar
                    search={
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('kbSearchPlaceholder')}
                            aria-label={t('kbSearchPlaceholder')}
                            leadingIcon={<Search size={16} />}
                        />
                    }
                    filters={
                        /* Replaces a hand-built popover: a raw <button>
                         * trigger, an absolutely positioned `role="menu"` div
                         * and a `document.mousedown` listener in a useEffect to
                         * close it. The DS Popover (Radix) owns the open state,
                         * `aria-expanded`, the outside-click dismissal, Escape
                         * and focus return — so the `columnsMenuOpen` state and
                         * the `columnsMenuRef` effect are both gone.
                         *
                         * `FilterMenu` would have been the DS's toolbar
                         * dropdown, but it is strictly SINGLE-select
                         * (`value`/`defaultValue`/`onChange`) and this is a
                         * multi-select column picker, so Popover + Checkbox is
                         * the sanctioned composition instead. */
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" aria-label={t('columnsToggle')}>
                                    {t('columnsToggle')} <ChevronDown size={15} aria-hidden="true" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-auto min-w-[180px] p-2">
                                <Stack gap="sm">
                                    {optionalColumns.map((c) => (
                                        <div key={c.key} className="flex items-center gap-2">
                                            <Checkbox
                                                id={`${columnIdPrefix}-${c.key}`}
                                                checked={!!optionalVisible[c.key]}
                                                onCheckedChange={(next) => setOptionalVisible((prev) => ({ ...prev, [c.key]: next === true }))}
                                            />
                                            <Label htmlFor={`${columnIdPrefix}-${c.key}`} className="cursor-pointer">
                                                {c.label}
                                            </Label>
                                        </div>
                                    ))}
                                </Stack>
                            </PopoverContent>
                        </Popover>
                    }
                />
            }
            actions={
                <>
                    <div className="flex items-center gap-2">
                        {/* Checkbox, not Switch: this replaces a native
                          * checkbox one-for-one, and turning it into a Switch
                          * would be a semantic and visual change this card has
                          * no mandate for. Flagged as an open question — the
                          * value DOES apply immediately, which is the case
                          * Switch exists for. */}
                        <Checkbox
                            id={autoRefreshId}
                            checked={autoRefresh}
                            onCheckedChange={(next) => setAutoRefresh(next === true)}
                        />
                        <Label htmlFor={autoRefreshId} className="cursor-pointer">
                            {t('kbAutoRefresh')}
                        </Label>
                    </div>
                    <Button onClick={fetchData} disabled={refreshing}>
                        {refreshing
                            ? <Spinner size="sm" label={t('loading')} />
                            : <RefreshCw size={16} aria-hidden="true" />}
                        {t('refresh')}
                    </Button>
                </>
            }
            stats={
                <>
                    {QUEUE_NAMES.map((q) => {
                        const s = data?.queueSummary?.[q] ?? { waiting: 0, active: 0, failed: 0 };
                        return (
                            <Card key={q} className="p-4">
                                <div className="mb-1 text-sm text-on-surface-variant">{q}</div>
                                <div className="flex gap-4">
                                    <span title={t('queueWaiting')} className="inline-flex items-center gap-1">
                                        <Hourglass size={14} aria-hidden="true" /> {s.waiting}
                                    </span>
                                    <span title={t('queueActive')} className="inline-flex items-center gap-1">
                                        <Play size={14} aria-hidden="true" /> {s.active}
                                    </span>
                                    <span
                                        title={t('queueFailed')}
                                        className={cn('inline-flex items-center gap-1', s.failed > 0 && 'text-error')}
                                    >
                                        <XCircle size={14} aria-hidden="true" /> {s.failed}
                                    </span>
                                </div>
                            </Card>
                        );
                    })}
                </>
            }
        >
            {error && (
                <div className="text-error">{error}</div>
            )}
            {loading && (
                <div className="flex items-center gap-2 text-on-surface-variant">
                    <Spinner size="sm" label={t('loading')} />
                    <span aria-hidden="true">{t('loading')}</span>
                </div>
            )}

            {/* ===== Stage 5 (KI-694) territory below: table markup untouched ===== */}
            {!loading && data && (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead>
                            <tr>
                                {columns.map((c) => (
                                    <th
                                        key={c.key}
                                        style={{ ...thStyle, textAlign: c.numeric ? 'right' : 'left' }}
                                        onClick={() => toggleSort(c.key)}
                                    >
                                        {c.label}{sortKey === c.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                                    </th>
                                ))}
                                {showActions && (
                                    <th style={{ ...thStyle, textAlign: 'right', cursor: 'default' }}>{t('colActions')}</th>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRows.map((row) => {
                                const hasFailed = row.failedFileCount > 0;
                                const rowStyle: React.CSSProperties = hasFailed
                                    ? { background: 'rgba(224,57,57,0.06)' }
                                    : {};
                                return (
                                    <tr key={row.id} style={rowStyle}>
                                        {columns.map((c, idx) => {
                                            const cellStyle: React.CSSProperties = {
                                                ...tdStyle,
                                                textAlign: c.numeric ? 'right' : 'left',
                                            };
                                            if (c.key === 'failedFileCount' && hasFailed) {
                                                cellStyle.color = 'var(--error-text)';
                                            }
                                            if (c.key === 'processingFileCount' && row.processingFileCount > 0) {
                                                cellStyle.color = 'var(--accent-primary)';
                                            }
                                            if (idx === 0 && hasFailed) {
                                                cellStyle.borderLeft = '3px solid var(--error-text)';
                                            }
                                            // The name is the one free-text column; letting it
                                            // wrap is what keeps a long KB name from widening
                                            // the table past the viewport and pushing the
                                            // actions column into a horizontal scroll.
                                            if (c.key === 'name') {
                                                cellStyle.whiteSpace = 'normal';
                                                cellStyle.minWidth = '14rem';
                                            }
                                            const title = c.key === 'lastActivity'
                                                ? mergedActivityIso(row)
                                                : c.key === 'activity'
                                                    ? `Web: ${row.webTurns ?? 0} · API: ${row.apiTurns ?? 0}`
                                                    : c.key === 'createdAt'
                                                        ? row.createdAt
                                                        : undefined;
                                            return (
                                                <td key={c.key} style={cellStyle} title={title}>
                                                    {renderCell(row, c.key)}
                                                </td>
                                            );
                                        })}
                                        {showActions && (
                                            <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                {/* isGlobal is the generated mirror of (visibility = 'public'),
                                                    so !isGlobal is exactly "still private" — the only state
                                                    Publish accepts (it answers 409 otherwise). The reverse
                                                    direction lives in the global-KB admin tab. */}
                                                {canPublish && !row.isGlobal && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        type="button"
                                                        aria-label={t('kbActionPublish')}
                                                        title={t('kbActionPublish')}
                                                        onClick={() => { setActionError(null); setPublishTarget(row); }}
                                                    >
                                                        <Globe size={16} aria-hidden="true" />
                                                    </Button>
                                                )}
                                                {canManage && !row.isGlobal && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        type="button"
                                                        aria-label={t('kbActionTransfer')}
                                                        title={t('kbActionTransfer')}
                                                        onClick={() => { setActionError(null); setTransferTarget(row); }}
                                                    >
                                                        <UserCog size={16} aria-hidden="true" />
                                                    </Button>
                                                )}
                                                {canManage && (
                                                    <Button
                                                        variant="ghost-destructive"
                                                        size="icon"
                                                        type="button"
                                                        aria-label={t('kbActionDelete')}
                                                        title={t('kbActionDelete')}
                                                        onClick={() => { setActionError(null); setDeleteTarget(row); }}
                                                    >
                                                        <Trash2 size={16} aria-hidden="true" />
                                                    </Button>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                            {sortedRows.length === 0 && (
                                <tr><td style={tdStyle} colSpan={columns.length + (showActions ? 1 : 0)}>{t('kbNoKnowledgeBases')}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            {/* ===== end Stage 5 territory ===== */}

            {deleteTarget && (
                <KbDeleteDialog
                    kbName={deleteTarget.name}
                    isGlobal={deleteTarget.isGlobal}
                    fileCount={deleteTarget.fileCount}
                    sizeLabel={formatBytes(deleteTarget.totalSizeBytes)}
                    chatCount={deleteTarget.chatCount}
                    busy={actionBusy}
                    error={actionError}
                    onCancel={() => { setDeleteTarget(null); setActionError(null); }}
                    onConfirm={confirmDelete}
                />
            )}
            {publishTarget && (
                <KbPublishDialog
                    kbName={publishTarget.name}
                    busy={actionBusy}
                    error={actionError}
                    onCancel={() => { setPublishTarget(null); setActionError(null); }}
                    onConfirm={confirmPublish}
                />
            )}
            {transferTarget && (
                <KbTransferOwnerDialog
                    kbName={transferTarget.name}
                    currentOwnerId={transferTarget.ownerId ?? null}
                    currentOwnerName={transferTarget.ownerName ?? null}
                    busy={actionBusy}
                    error={actionError}
                    onCancel={() => { setTransferTarget(null); setActionError(null); }}
                    onConfirm={confirmTransfer}
                />
            )}
        </DashboardLayout>
    );
}
