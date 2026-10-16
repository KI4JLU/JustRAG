// Package tabular materializes uploaded spreadsheets into native-typed
// Postgres tables so the table_query MCP tool can answer lookups,
// aggregations, and filter/sort queries with deterministic SQL instead of
// embedding-based retrieval. See
// docs/superpowers/specs/2026-05-28-tabular-data-qa-design.md.
package tabular

// ColumnType is the narrow set of SQL types the inferrer targets. Anything
// it cannot prove uniformly numeric/temporal/boolean falls back to Text.
type ColumnType string

const (
	TypeBigint    ColumnType = "bigint"
	TypeFloat     ColumnType = "double precision"
	TypeDate      ColumnType = "date"
	TypeBool      ColumnType = "boolean"
	TypeText      ColumnType = "text"
	TypeNumeric   ColumnType = "numeric"
	TypeTimestamp ColumnType = "timestamp"
)

// ColumnSpec describes one materialized column. Original is the spreadsheet
// header as the user sees it; Name is the sanitized SQL identifier the LLM
// must use in queries. Embedded is true when Phase-2 flagged this column as
// free text to embed for fuzzy search.
//
// Role/Description/ShadowOf are the profiler's (Phase-2) view of a column:
// Role is the profiled semantic role as a string (e.g. "measure",
// "dimension"); Description is a short human-readable gloss; ShadowOf names
// the primary column this one shadows, e.g. "baujahr" for the coerced
// "baujahr_num" column. All three are omitted by a Phase-1 writer and decode
// to their zero value when reading Phase-1 JSON.
type ColumnSpec struct {
	Original    string     `json:"original"`
	Name        string     `json:"name"`
	Type        ColumnType `json:"type"`
	Embedded    bool       `json:"embedded,omitempty"`
	Role        string     `json:"role,omitempty"`
	Description string     `json:"description,omitempty"`
	ShadowOf    string     `json:"shadow_of,omitempty"`
	// Lookup links the column to a lookup table of the same file (set by the
	// ingest's lookup pass, nil otherwise). Omitted from older catalog JSON.
	Lookup *LookupRef `json:"lookup,omitempty"`
}

// Lookup link sources: how the ingest found a link.
const (
	LookupSourceFormula    = "formula"    // VLOOKUP / XLOOKUP / INDEX(MATCH) into another sheet
	LookupSourceValidation = "validation" // a dropdown (list validation) whose list is another sheet's range
	LookupSourceHeuristic  = "heuristic"  // a code column matched by name and values; may be wrong
)

// LookupRef.Compare values: how a join between the two columns must compare
// them when their SQL types differ ("" = directly).
const (
	LookupCompareNumeric = "numeric" // both sides read as numbers (a text key column "5" against a numeric code 5)
	LookupCompareText    = "text"    // both sides read as text
)

// LookupRef ties a column to a lookup table of the same file: the value in
// Table's Key column that corresponds to a row, and the Label column that
// names it. Two shapes:
//
//   - Via == "": the column itself holds keys (codes) — its value v reads as
//     Label where Key = v (a heuristic code column, or a dropdown).
//   - Via != "": the column holds an already looked-up value; Via is the
//     column of the same table whose value was the key (a VLOOKUP result).
//
// A validation link (a dropdown) has Key == Label: the column holds the
// listed value itself, not a code. Compare is set when the joined columns
// have different SQL types (LookupCompareNumeric / LookupCompareText).
//
// Table, Key, Label and Via are SQL names.
type LookupRef struct {
	Table   string `json:"table"`
	Key     string `json:"key"`
	Label   string `json:"label"`
	Via     string `json:"via,omitempty"`
	Source  string `json:"source"`
	Compare string `json:"compare,omitempty"`
}

// ColumnStat is the per-column entry of tabular_catalog.column_stats: the
// profiler's summary of one materialized column, stored alongside the
// (unchanged) Phase-1 `columns` shape for readers that only know that one.
//
// ShadowColumn is the inverse of ColumnSpec.ShadowOf: set on the PRIMARY
// column's stat entry, it names the shadow numeric-coercion column (e.g.
// "baujahr_num" on the "baujahr" entry). ColumnSpec.ShadowOf is the only
// ShadowOf in this package; ColumnStat carries ShadowColumn instead, on
// ruling R4.
type ColumnStat struct {
	Name            string   `json:"name"`
	Original        string   `json:"original"`
	Type            string   `json:"type"`
	Role            string   `json:"role"`
	Description     string   `json:"description,omitempty"`
	ShadowColumn    string   `json:"shadow_column,omitempty"`
	ValueSet        []string `json:"value_set,omitempty"`
	Min             string   `json:"min,omitempty"`
	Max             string   `json:"max,omitempty"`
	NullCount       int64    `json:"null_count"`
	NullTokens      int64    `json:"null_tokens"`
	DistinctCount   int64    `json:"distinct_count"`
	HighCardinality bool     `json:"high_cardinality,omitempty"`
	Samples         []string `json:"samples,omitempty"`
	CoercionFailed  int64    `json:"coercion_failed"`
	// LongValuesSkipped counts values excluded from the exact-lookup index
	// for exceeding the indexed-value byte cap (R21). They stay reachable
	// through BM25/ILIKE, just not through tabular_column_values.
	LongValuesSkipped int64 `json:"long_values_skipped,omitempty"`
}

// SheetReport is one sheet's entry in a file's ParseReport (files.parse_report).
type SheetReport struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Hidden    bool   `json:"hidden"`
	HeaderRow int    `json:"header_row"`
	Columns   int    `json:"columns"`

	RowsRead         int `json:"rows_read"`
	RowsMaterialised int `json:"rows_materialised"`
	RowsEmbedded     int `json:"rows_embedded"`
	RowsPastCap      int `json:"rows_past_cap"`

	FormulaCellsEmpty int  `json:"formula_cells_empty"`
	CoercionFailures  int  `json:"coercion_failures"`
	UsedLLM           bool `json:"used_llm"`
	DroppedColumns    int  `json:"dropped_columns"`

	Notes  []string `json:"notes,omitempty"`
	Tables []string `json:"tables,omitempty"`
}

// ParseReport is the per-file ingest report persisted to files.parse_report
// (spec §4.6): what the parser/materializer found and did, one entry per
// sheet, for the ingest-detail UI.
type ParseReport struct {
	Version      int           `json:"version"`
	Materialised bool          `json:"materialised"`
	Sheets       []SheetReport `json:"sheets"`
}
