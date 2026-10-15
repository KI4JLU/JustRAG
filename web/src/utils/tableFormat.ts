/**
 * Pure helpers for the spreadsheet source preview (components/tablePreview):
 * column kinds and labels, cell parsing and number formatting, the sort cycle,
 * and the row copy formats. Empty-row and empty-column detection is NOT here:
 * it runs in SQL (tabular.Catalog.PreviewRows), so it holds for tables of any
 * size, and the rows endpoint returns the result.
 */

export type ColumnKind = 'text' | 'number';
export type Cell = string | number | null;

/** The materialized SQL type (tabular.ColumnType) → how the preview treats it. */
export function columnKind(sqlType: string): ColumnKind {
    return sqlType === 'numeric' || sqlType === 'bigint' || sqlType === 'double precision' ? 'number' : 'text';
}

/** SQL text from the rows endpoint → a typed cell; numbers become numbers. */
export function parseCell(text: string | null, kind: ColumnKind): Cell {
    if (text === null) return null;
    if (kind === 'number') {
        const n = Number(text);
        return Number.isFinite(n) ? n : text;
    }
    return text;
}

// Fallback word list for SQL names without a stored original header: the
// ingest transliterates umlauts (ä → ae …) and lowercases, which this undoes
// for the words spreadsheets here actually use.
const WORDS: Record<string, string> = {
    gebaeudebezeichnung: 'Gebäudebezeichnung', gebaeude: 'Gebäude', gebid: 'GebID', num: '(num.)',
    nr: 'Nr.', schluessel: 'Schlüssel', sanitaer: 'Sanitär', lueftung: 'Lüftung', prozent: '%',
    flaeche: 'Fläche', strasse: 'Straße', pruefung: 'Prüfung',
};

/** A readable label from a snake_case SQL name: words capitalised, umlauts restored. */
export function humanize(name: string): string {
    return name
        .split('_')
        .filter(Boolean)
        .map(w => WORDS[w] ?? w[0].toUpperCase() + w.slice(1))
        .join(' ');
}

/** The header label: the original spreadsheet header the ingest stored, else the humanized SQL name. */
export function columnLabel(name: string, original?: string): string {
    const o = original?.trim();
    return o ? o : humanize(name);
}

/** Fixed decimals for a number column: the most any loaded value has, at most 2. */
export function columnDecimals(values: Cell[]): number {
    let d = 0;
    for (const v of values) {
        if (typeof v !== 'number') continue;
        const frac = String(v).split('.')[1];
        if (frac) d = Math.max(d, frac.length);
    }
    return Math.min(d, 2);
}

/**
 * A cell as displayed. Numbers use the locale with the column's fixed
 * decimals; grouping only from 10 000 up, so years stay "1968", not "1.968".
 */
export function formatCell(value: Cell, kind: ColumnKind, decimals: number, locale: string): string {
    if (value === null) return '';
    if (kind !== 'number' || typeof value !== 'number') return String(value);
    return value.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: Math.abs(value) >= 10000,
    });
}

export type SortState = { column: string; dir: 'asc' | 'desc' } | null;

/** Header click: ascending → descending → off; another column starts at ascending. */
export function nextSort(current: SortState, column: string): SortState {
    if (!current || current.column !== column) return { column, dir: 'asc' };
    return current.dir === 'asc' ? { column, dir: 'desc' } : null;
}

/** One row as a JSON object keyed by SQL column name. */
export function rowToJson(columns: string[], cells: Cell[]): string {
    return JSON.stringify(Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? null])), null, 2);
}

/** One row as a Markdown table (header, separator, values); pipes are escaped. */
export function rowToMarkdown(columns: string[], cells: Cell[]): string {
    const esc = (v: Cell) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        `| ${cells.map(esc).join(' | ')} |`,
    ].join('\n');
}
