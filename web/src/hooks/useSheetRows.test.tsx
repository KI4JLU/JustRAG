import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios, { type AxiosRequestConfig } from 'axios';
import { lookupKey, useSheetRows, type SheetQuery } from './useSheetRows';
import type { TabularRows } from '../types';

vi.mock('axios');

type Deferred = { resolve: (v: { data: TabularRows }) => void; params: { table: string; offset: number; q?: string } };
let calls: Deferred[] = [];

const page = (offset: number, n: number, matched: number, tag: string): TabularRows => ({
    table_name: 't', sheet_name: 's', columns: ['c'], offset, limit: 200, row_count: matched, matched,
    rows: Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, empty: false, cells: [`${tag}${offset + i}`] })),
});

beforeEach(() => {
    calls = [];
    vi.spyOn(axios, 'get').mockImplementation((_url: string, config?: AxiosRequestConfig) =>
        new Promise(resolve => { calls.push({ resolve: resolve as Deferred['resolve'], params: config!.params as Deferred['params'] }); }));
});

const A: SheetQuery = { search: 'a', sort: null, showEmpty: false };
const B: SheetQuery = { search: 'b', sort: null, showEmpty: false };

// Oracle: the reviewer's scenario (Codex review of the UI). A late page of an
// earlier run of the SAME query must not be appended to a newer run of it.
describe('useSheetRows', () => {
    it('drops a late page from an earlier run of the same query (A → B → A)', async () => {
        const { result, rerender } = renderHook(({ q }) => useSheetRows('kb', 'f', 't', q), { initialProps: { q: A } });
        await act(async () => { calls[0].resolve({ data: page(0, 200, 400, 'a1-') }); });
        expect(result.current.rows).toHaveLength(200);

        act(() => result.current.loadMore()); // A, offset 200 — left pending
        const lateA = calls[1];
        expect(lateA.params.offset).toBe(200);

        rerender({ q: B });
        await act(async () => { calls[2].resolve({ data: page(0, 5, 5, 'b-') }); });
        rerender({ q: A }); // a NEW run of A
        await act(async () => { calls[3].resolve({ data: page(0, 200, 400, 'a2-') }); });

        await act(async () => { lateA.resolve({ data: page(200, 200, 400, 'a1-') }); });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.rows).toHaveLength(200);
        expect(result.current.rows[0].cells[0]).toBe('a2-0');
    });

    it('appends the next page of the current run', async () => {
        const { result } = renderHook(() => useSheetRows('kb', 'f', 't', A));
        await act(async () => { calls[0].resolve({ data: page(0, 200, 250, 'x') }); });
        act(() => result.current.loadMore());
        await act(async () => { calls[1].resolve({ data: page(200, 50, 250, 'x') }); });
        expect(result.current.rows).toHaveLength(250);
        expect(result.current.hasMore).toBe(false);
    });
});

describe('lookupKey', () => {
    it('canonicalises numbers but keeps integers past 2^53 exact', () => {
        expect(lookupKey('5.0')).toBe('5');
        expect(lookupKey(5)).toBe('5');
        expect(lookupKey('9007199254740993')).toBe('9007199254740993');
    });
});
