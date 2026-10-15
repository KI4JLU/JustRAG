import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import type { TabularRow, TabularRows } from '../types';
import type { SortState } from '../utils/tableFormat';

/** Rows per request while scrolling; the endpoint allows up to 500. */
export const SHEET_PAGE_SIZE = 200;

const rowsUrl = (kbId: string, fileId: string) => `${API_BASE_URL}/api/kb/${kbId}/files/${fileId}/tabular/rows`;

export interface SheetQuery {
    search: string;
    sort: SortState;
    showEmpty: boolean;
}

export interface SheetRowsState {
    rows: TabularRow[];
    /** Rows passing search and the empty-row filter (all pages). */
    matched: number;
    /** Whole-table stats from the first page; undefined until it arrives. */
    emptyRows?: number;
    emptyColumns?: string[];
    loading: boolean;
    error: boolean;
    hasMore: boolean;
    loadMore: () => void;
}

interface Loaded {
    key: string;
    rows: TabularRow[];
    matched: number;
    emptyRows?: number;
    emptyColumns?: string[];
}

/**
 * One sheet's rows for the preview, page by page as the table scrolls.
 * Search, sort and the empty-row filter are server-side (GET …/tabular/rows),
 * so a new query starts over at offset 0; `loadMore` appends the next page.
 * State is keyed by table + query, so a stale response for an earlier query
 * is dropped instead of mixed in.
 */
export function useSheetRows(kbId: string, fileId: string, table: string, query: SheetQuery): SheetRowsState {
    const key = JSON.stringify([table, query.search, query.sort, query.showEmpty]);
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [pending, setPending] = useState<{ key: string; offset: number } | null>(null);
    const [failedKey, setFailedKey] = useState<string | null>(null);
    // The query a response must still belong to; updated after render (and
    // before the fetch effect below, which is declared after it).
    const keyRef = useRef(key);
    useEffect(() => { keyRef.current = key; }, [key]);

    const current = loaded?.key === key ? loaded : null;

    const fetchPage = useCallback((offset: number) => {
        if (!table) return;
        const requestKey = key;
        setPending({ key: requestKey, offset });
        axios.get<TabularRows>(rowsUrl(kbId, fileId), {
            params: {
                table,
                offset,
                limit: SHEET_PAGE_SIZE,
                ...(query.search ? { q: query.search } : {}),
                ...(query.sort ? { sort: query.sort.column, dir: query.sort.dir } : {}),
                ...(query.showEmpty ? { show_empty: true } : {}),
            },
        })
            .then(res => {
                if (keyRef.current !== requestKey) return;
                const page = res.data;
                setLoaded(prev => {
                    const base = prev?.key === requestKey && offset > 0 ? prev : null;
                    return {
                        key: requestKey,
                        rows: base ? [...base.rows, ...page.rows] : page.rows,
                        matched: page.matched,
                        emptyRows: page.empty_rows ?? base?.emptyRows,
                        emptyColumns: page.empty_columns ?? base?.emptyColumns,
                    };
                });
                setFailedKey(null);
            })
            .catch(() => {
                if (keyRef.current === requestKey) setFailedKey(requestKey);
            })
            .finally(() => {
                setPending(p => (p?.key === requestKey && p.offset === offset ? null : p));
            });
        // `query` is captured through `key`, which covers every field used.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kbId, fileId, table, key]);

    useEffect(() => {
        fetchPage(0);
    }, [fetchPage]);

    const rows = current?.rows ?? [];
    const matched = current?.matched ?? 0;
    const loading = pending?.key === key;
    const hasMore = !!current && rows.length < matched;

    const loadMore = useCallback(() => {
        if (!current || loading || current.rows.length >= current.matched) return;
        fetchPage(current.rows.length);
    }, [current, loading, fetchPage]);

    return {
        rows,
        matched,
        emptyRows: current?.emptyRows,
        emptyColumns: current?.emptyColumns,
        loading,
        error: failedKey === key,
        hasMore,
        loadMore,
    };
}

/**
 * Non-empty row counts for the sheet tabs, fetched once for every table when
 * the preview opens (`matched` of a one-row page with the default filter).
 * A table whose request fails simply shows no count.
 */
export function useSheetCounts(kbId: string, fileId: string, tables: string[]): Record<string, number> {
    const [counts, setCounts] = useState<Record<string, number>>({});
    const tablesKey = tables.join('\0');

    useEffect(() => {
        if (!tablesKey) return;
        let cancelled = false;
        for (const table of tablesKey.split('\0')) {
            axios.get<TabularRows>(rowsUrl(kbId, fileId), { params: { table, offset: 0, limit: 1 } })
                .then(res => {
                    if (!cancelled) setCounts(c => ({ ...c, [table]: res.data.matched }));
                })
                .catch(() => { /* no count for this tab */ });
        }
        return () => { cancelled = true; };
    }, [kbId, fileId, tablesKey]);

    return counts;
}

/** Lookup tables are small; one page covers them (the endpoint's maximum). */
const LOOKUP_LIMIT = 500;

/** A code as the lookup map keys it: integers canonicalised ("5.0" → "5"). */
export function lookupKey(v: string | number): string {
    const n = Number(v);
    return Number.isFinite(n) && String(v).trim() !== '' ? String(n) : String(v).trim();
}

/**
 * Code → name maps for the lookup tables the given columns link to, fetched
 * once per table (all rows, empty ones included). A map appears when its
 * table has loaded; a failed or oversized table simply has none.
 */
export function useLookupLabels(
    kbId: string, fileId: string, refs: { table: string; key: string; label: string }[],
): Record<string, Map<string, string>> {
    const [maps, setMaps] = useState<Record<string, Map<string, string>>>({});
    const refsKey = JSON.stringify([...new Map(refs.map(r => [`${r.table}.${r.key}.${r.label}`, r])).values()]);

    useEffect(() => {
        const wanted: { table: string; key: string; label: string }[] = JSON.parse(refsKey);
        let cancelled = false;
        for (const ref of wanted) {
            const id = `${ref.table}.${ref.key}.${ref.label}`;
            axios.get<TabularRows>(rowsUrl(kbId, fileId), { params: { table: ref.table, offset: 0, limit: LOOKUP_LIMIT, show_empty: true } })
                .then(res => {
                    if (cancelled || res.data.matched > LOOKUP_LIMIT) return;
                    const ki = res.data.columns.indexOf(ref.key);
                    const li = res.data.columns.indexOf(ref.label);
                    if (ki < 0 || li < 0) return;
                    const map = new Map<string, string>();
                    for (const row of res.data.rows) {
                        const k = row.cells[ki];
                        const l = row.cells[li];
                        if (k !== null && l !== null) map.set(lookupKey(k), l);
                    }
                    setMaps(m => ({ ...m, [id]: map }));
                })
                .catch(() => { /* no labels for this lookup */ });
        }
        return () => { cancelled = true; };
    }, [kbId, fileId, refsKey]);

    return maps;
}
