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
 *
 * Every query run gets a GENERATION number, bumped whenever table, query or
 * file change (also when the same query comes back later: A → B → A is a new
 * run). A response, a failure or a pending flag only counts for the
 * generation it was started in, so a late page of an earlier run can never
 * be appended to, or overwrite, the current one.
 */
export function useSheetRows(kbId: string, fileId: string, table: string, query: SheetQuery): SheetRowsState {
    const key = JSON.stringify([table, query.search, query.sort, query.showEmpty]);
    const genRef = useRef(0);
    const [gen, setGen] = useState(0);
    const [loaded, setLoaded] = useState<(Loaded & { gen: number }) | null>(null);
    const [pending, setPending] = useState<{ gen: number; offset: number } | null>(null);
    const [failedGen, setFailedGen] = useState<number | null>(null);

    const fetchPage = useCallback((runGen: number, offset: number) => {
        if (!table) return;
        setPending({ gen: runGen, offset });
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
                if (genRef.current !== runGen) return;
                const page = res.data;
                setLoaded(prev => {
                    const base = prev?.gen === runGen && offset > 0 ? prev : null;
                    if (offset > 0 && base?.rows.length !== offset) return prev; // not the next page of this run
                    return {
                        gen: runGen,
                        key,
                        rows: base ? [...base.rows, ...page.rows] : page.rows,
                        matched: page.matched,
                        emptyRows: page.empty_rows ?? base?.emptyRows,
                        emptyColumns: page.empty_columns ?? base?.emptyColumns,
                    };
                });
                setFailedGen(null);
            })
            .catch(() => {
                if (genRef.current === runGen) setFailedGen(runGen);
            })
            .finally(() => {
                setPending(p => (p?.gen === runGen && p.offset === offset ? null : p));
            });
        // `query` is captured through `key`, which covers every field used.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kbId, fileId, table, key]);

    // A new run per table/query/file: bump the generation, then fetch page 0.
    useEffect(() => {
        genRef.current += 1;
        const runGen = genRef.current;
        setGen(runGen);
        fetchPage(runGen, 0);
    }, [fetchPage]);

    const current = loaded?.gen === gen ? loaded : null;
    const rows = current?.rows ?? [];
    const matched = current?.matched ?? 0;
    const loading = pending?.gen === gen;
    const hasMore = !!current && rows.length < matched;

    const loadMore = useCallback(() => {
        if (!current || loading || current.rows.length >= current.matched) return;
        fetchPage(gen, current.rows.length);
    }, [current, loading, fetchPage, gen]);

    return {
        rows,
        matched,
        emptyRows: current?.emptyRows,
        emptyColumns: current?.emptyColumns,
        loading,
        error: failedGen === gen,
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
    const t = String(v).trim();
    const n = Number(t);
    // Integers past 2^53 lose digits as numbers: those stay text.
    if (/^-?\d+$/.test(t) && !Number.isSafeInteger(n)) return t.replace(/^(-?)0+(?=\d)/, '$1');
    return Number.isFinite(n) && t !== '' ? String(n) : t;
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
