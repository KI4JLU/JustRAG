/**
 * In-memory tables for the table preview (components/tablePreview): a table
 * the browser already holds — a Markdown table from an AI answer — turned
 * into the preview's columns and rows, plus the client-side search and sort
 * the server does for an ingested spreadsheet (tabular.Catalog.PreviewRows).
 */
import type { ViewColumn, ViewRow } from '../components/tablePreview/types';
import { formatCell, type Cell, type SortState } from './tableFormat';

export interface LocalTable {
    columns: ViewColumn[];
    rows: ViewRow[];
}

// Only a plain decimal is a number, and only when it reads the same in German
// and English: "12,5" may be a German decimal or a list, and "1.234" German
// thousands or an English decimal (any dot with exactly three digits after a
// non-zero integer part), so those stay text, verbatim. Guessing would show a
// different value than the answer does. No leading zero either: "00123" is an
// identifier, and Number() would drop the zeros.
const PLAIN_NUMBER_RE = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const THOUSANDS_LIKE_RE = /^[+-]?[1-9]\d*\.\d{3}$/;

// At most 15 digits in all: a double holds every such decimal exactly, so it
// survives Number() and formatting unchanged, and its fraction digits stay
// within toLocaleString's range. A longer one (a 16+ digit id, a
// high-precision constant, a fraction of many zeros) stays text.
const MAX_DIGITS = 15;

function isExactNumber(text: string): boolean {
    return PLAIN_NUMBER_RE.test(text)
        && !THOUSANDS_LIKE_RE.test(text)
        && text.replace(/\D/g, '').length <= MAX_DIGITS;
}

/** Fraction digits of a plain decimal, not capped at 2 as the spreadsheet preview's are, so no shown value loses precision. */
function fractionDigits(text: string): number {
    return text.split('.')[1]?.length ?? 0;
}

/**
 * The extracted cells of a table (row-major, header row first when there is
 * one, as MarkdownTable's extractRows returns them) as preview columns and
 * rows. A column is a number column when every non-empty cell is a plain
 * decimal of at most 15 digits that reads the same in German and English (and
 * at least one is); empty cells are null. Column names are the headers, made
 * unique (the row details and the copy formats key on them); an empty header
 * becomes `fallbackName` with its 1-based position. Without a header row
 * (`hasHeader` false: a raw-HTML table with no `th`) every row is data and
 * every column is named that way. Rows shorter than the header are padded
 * with null, longer ones cut.
 */
export function toLocalTable(cells: string[][], fallbackName: string, hasHeader = true): LocalTable {
    const width = Math.max(0, ...cells.map(r => r.length));
    const header = hasHeader ? (cells[0] ?? []) : Array.from({ length: width }, () => '');
    const body = hasHeader ? cells.slice(1) : cells;
    // A header's first occurrence keeps its text; a repeat gets " (n)" with the
    // first n that is neither a header nor already given out, so headers
    // "Wert", "Wert", "Wert (2)" become "Wert", "Wert (3)", "Wert (2)".
    const bases = header.map((h, ci) => h.trim() || `${fallbackName} ${ci + 1}`);
    const taken = new Set<string>();
    const names = bases.map((base, ci) => {
        let name = base;
        if (bases.indexOf(base) !== ci) {
            let n = 2;
            while (taken.has(`${base} (${n})`) || bases.includes(`${base} (${n})`)) n++;
            name = `${base} (${n})`;
        }
        taken.add(name);
        return name;
    });

    const raw = body.map(r => names.map((_, ci) => {
        const v = (r[ci] ?? '').trim();
        return v === '' ? null : v;
    }));

    const columns: ViewColumn[] = names.map((name, ci) => {
        const values = raw.map(r => r[ci]).filter((v): v is string => v !== null);
        const numeric = values.length > 0 && values.every(isExactNumber);
        return {
            name,
            label: name,
            kind: numeric ? 'number' : 'text',
            empty: values.length === 0,
            decimals: numeric ? Math.max(0, ...values.map(fractionDigits)) : 0,
        };
    });

    const rows: ViewRow[] = raw.map((r, ri) => ({
        id: ri + 1,
        empty: r.every(v => v === null),
        cells: r.map((v, ci): Cell => (v !== null && columns[ci].kind === 'number' ? Number(v) : v)),
    }));

    return { columns, rows };
}

/**
 * Rows whose shown text contains `query` (case-insensitive) in any visible
 * column — the text SheetTable highlights, so every hit is visible.
 */
export function searchRows(table: LocalTable, visibleCols: number[], query: string, locale: string): ViewRow[] {
    const q = query.trim().toLowerCase();
    if (!q) return table.rows;
    return table.rows.filter(row => visibleCols.some(ci => {
        const col = table.columns[ci];
        const v = row.cells[ci] ?? null;
        return v !== null && formatCell(v, col.kind, col.decimals, locale).toLowerCase().includes(q);
    }));
}

/**
 * Rows sorted by one column: numbers numerically, text with a numeric-aware
 * collator ("Schritt 2" before "Schritt 10"), empty cells last in both
 * directions — as the spreadsheet preview sorts NULL. Stable; no sort keeps
 * the answer's order.
 */
export function sortRows(table: LocalTable, rows: ViewRow[], sort: SortState, locale: string): ViewRow[] {
    if (!sort) return rows;
    const ci = table.columns.findIndex(c => c.name === sort.column);
    if (ci < 0) return rows;
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const x = a.cells[ci] ?? null;
        const y = b.cells[ci] ?? null;
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
        return c * dir;
    });
}
