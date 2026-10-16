import type { Cell, ColumnKind } from '../../utils/tableFormat';

/** A column as the preview shows it. */
export interface ViewColumn {
    /** SQL column name. */
    name: string;
    /** Original spreadsheet header (or the humanized SQL name). */
    label: string;
    kind: ColumnKind;
    /** No value in any non-empty row (hidden unless "show empty columns"). */
    empty: boolean;
    /** Fixed decimals for a number column. */
    decimals: number;
    /** Link to a lookup table of the same file, when the ingest found one. */
    lookup?: ViewLookup;
}

export interface ViewLookup {
    /** SQL table name of the lookup table (a tab value). */
    table: string;
    /** Its tab label (sheet name). */
    sheet: string;
    /** The column holds codes (resolved via `labels`), or an already looked-up value. */
    kind: 'code' | 'derived';
    /** Found by name and values rather than by a formula or dropdown. */
    inferred: boolean;
    /** Code → name, once the lookup table has loaded (code columns only). */
    labels?: Map<string, string>;
}

/** A row with its cells parsed to text / number / null. */
export interface ViewRow {
    /** The _rowid (ingest order). */
    id: number;
    empty: boolean;
    cells: Cell[];
}

export type DetailMode = 'inline' | 'panel';
