package tabular

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// PreviewQuery selects one page of a materialized table for the source
// preview. Search, sort and the empty-row filter run in SQL, so the preview
// works the same on a 20-row sheet and a 2M-row one.
type PreviewQuery struct {
	Offset, Limit int
	// Search is a case-insensitive substring matched against every column's
	// text; for numeric columns a decimal comma also matches the stored point
	// ("3,2" finds 3.2, as the preview displays it).
	Search string
	// SortColumn is a catalog column name ("" = ingest order, _rowid).
	// NULL sorts last in both directions; _rowid breaks ties.
	SortColumn string
	SortDesc   bool
	// ShowEmpty includes empty rows (see emptyRowSQL); by default they are
	// filtered out.
	ShowEmpty bool
	// WithStats adds EmptyRows / EmptyColumns — a full-table aggregate, so
	// the caller asks for it once per table (the first page), not per page.
	WithStats bool
}

// PreviewRow is one table row: its _rowid, whether it is empty, and each
// cell as SQL text (NULL stays nil).
type PreviewRow struct {
	ID    int64
	Empty bool
	Cells []*string
}

// PreviewPage is one page of a materialized table plus the counts the
// preview's toolbar and footer show.
type PreviewPage struct {
	Columns []string
	Rows    []PreviewRow
	// Matched counts the rows passing the search and the empty-row filter.
	Matched int64
	// EmptyRows / EmptyColumns are set only with PreviewQuery.WithStats.
	EmptyRows    *int64
	EmptyColumns []string
}

// previewTimeout bounds each preview statement; search on a very large table
// is a full scan, and the timeout turns that into an error, not a hang.
const previewTimeout = 5 * time.Second

func isNumericType(t ColumnType) bool {
	return t == TypeNumeric || t == TypeBigint || t == TypeFloat
}

// blankSQL is true when one cell counts as blank for the empty-row rule:
// NULL, an empty or whitespace-only text, or zero ("0" / 0) — the values an
// Excel template leaves in rows nobody filled in.
func blankSQL(c ColumnSpec) string {
	col := q(c.Name)
	switch {
	case isNumericType(c.Type):
		return fmt.Sprintf("(%s IS NULL OR %s = 0)", col, col)
	case c.Type == TypeText:
		return fmt.Sprintf("(%s IS NULL OR btrim(%s) IN ('', '0'))", col, col)
	default:
		return fmt.Sprintf("(%s IS NULL)", col)
	}
}

// emptyRowSQL is true when a row is empty: every cell after the first is
// blank — the first column of such sheets is usually a running number that a
// template pre-fills. A one-column table has no "rest", so there the one cell
// decides.
func emptyRowSQL(cols []ColumnSpec) string {
	rest := cols
	if len(cols) > 1 {
		rest = cols[1:]
	}
	parts := make([]string, 0, len(rest))
	for _, c := range rest {
		parts = append(parts, blankSQL(c))
	}
	return "(" + strings.Join(parts, " AND ") + ")"
}

// hasNumeric reports whether any column is numeric — only then does a search
// bind the decimal-point pattern ($2).
func hasNumeric(cols []ColumnSpec) bool {
	for _, c := range cols {
		if isNumericType(c.Type) {
			return true
		}
	}
	return false
}

// whereSQL renders the filter shared by the page and the count query. With a
// search, $1 is the LIKE pattern and $2 its decimal-point variant — $2 only
// when a numeric column uses it. Without a search the filter binds nothing:
// Postgres cannot type a parameter no expression references.
func whereSQL(cols []ColumnSpec, pq PreviewQuery) string {
	var conds []string
	if !pq.ShowEmpty {
		conds = append(conds, "NOT "+emptyRowSQL(cols))
	}
	if pq.Search != "" {
		ors := make([]string, 0, len(cols))
		for _, c := range cols {
			ors = append(ors, q(c.Name)+`::text ILIKE $1 ESCAPE '\'`)
			if isNumericType(c.Type) {
				ors = append(ors, q(c.Name)+`::text ILIKE $2 ESCAPE '\'`)
			}
		}
		conds = append(conds, "("+strings.Join(ors, " OR ")+")")
	}
	if len(conds) == 0 {
		return "TRUE"
	}
	return strings.Join(conds, " AND ")
}

// BuildPreviewSQL renders the page query: _rowid, the empty flag, and every
// catalog column as text, filtered and ordered per pq. LIMIT/OFFSET are the
// two parameters after the search patterns: $3/$4 with a search, $1/$2
// without (see previewArgs).
// Table and column names come from tabular_catalog (sanitized at ingest) and
// go through q like every other identifier in this package; request values
// are bound parameters only. The caller validates SortColumn against the
// catalog.
func BuildPreviewSQL(table string, cols []ColumnSpec, pq PreviewQuery) string {
	exprs := []string{q(RowIDColumn), emptyRowSQL(cols)}
	for _, c := range cols {
		exprs = append(exprs, q(c.Name)+"::text")
	}
	order := q(RowIDColumn)
	if pq.SortColumn != "" {
		dir := "ASC"
		if pq.SortDesc {
			dir = "DESC"
		}
		order = fmt.Sprintf("%s %s NULLS LAST, %s", q(pq.SortColumn), dir, q(RowIDColumn))
	}
	n := len(searchArgs(cols, pq))
	limit, offset := fmt.Sprintf("$%d", n+1), fmt.Sprintf("$%d", n+2)
	return fmt.Sprintf(`SELECT %s FROM %s.%s WHERE %s ORDER BY %s LIMIT %s OFFSET %s`,
		strings.Join(exprs, ", "), q(TabularSchema), q(table), whereSQL(cols, pq), order, limit, offset)
}

// searchArgs are the bound search patterns: none without a search, $1 for a
// text-only table, $1 and $2 (decimal-point variant) with a numeric column —
// exactly the parameters whereSQL references.
func searchArgs(cols []ColumnSpec, pq PreviewQuery) []any {
	if pq.Search == "" {
		return nil
	}
	args := []any{likePattern(pq.Search)}
	if hasNumeric(cols) {
		args = append(args, likePattern(strings.ReplaceAll(pq.Search, ",", ".")))
	}
	return args
}

// buildCountSQL counts the rows passing the same filter as the page.
func buildCountSQL(table string, cols []ColumnSpec, pq PreviewQuery) string {
	return fmt.Sprintf(`SELECT count(*) FROM %s.%s WHERE %s`, q(TabularSchema), q(table), whereSQL(cols, pq))
}

// buildStatsSQL counts the empty rows and, per column, whether it holds a
// value in any non-empty row (bool_or over the non-empty rows; NULL when
// there are none, which reads as "column empty").
func buildStatsSQL(table string, cols []ColumnSpec) string {
	empty := emptyRowSQL(cols)
	exprs := []string{fmt.Sprintf("count(*) FILTER (WHERE %s)", empty)}
	for _, c := range cols {
		exprs = append(exprs, fmt.Sprintf(
			"bool_or(%s IS NOT NULL AND %s::text <> '') FILTER (WHERE NOT %s)", q(c.Name), q(c.Name), empty))
	}
	return fmt.Sprintf(`SELECT %s FROM %s.%s`, strings.Join(exprs, ", "), q(TabularSchema), q(table))
}

// likePattern turns a search string into a LIKE "contains" pattern.
func likePattern(s string) string {
	return "%" + escapeLike(s) + "%"
}

// PreviewRows reads one page of the catalog entry's table in a read-only
// transaction with a statement timeout. The caller resolves the entry from
// tabular_catalog (so the table is known to belong to the file), validates
// SortColumn against e.Columns, and bounds limit/offset.
func (c *Catalog) PreviewRows(ctx context.Context, e CatalogEntry, pq PreviewQuery) (*PreviewPage, error) {
	page := &PreviewPage{Columns: make([]string, 0, len(e.Columns)), Rows: []PreviewRow{}}
	for _, col := range e.Columns {
		page.Columns = append(page.Columns, col.Name)
	}
	if len(e.Columns) == 0 {
		return page, nil
	}

	tx, err := c.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("tabular preview: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck // read-only; nothing to keep

	// statement_timeout cannot be a bound parameter; the value is a constant.
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL statement_timeout = %d", previewTimeout.Milliseconds())); err != nil {
		return nil, fmt.Errorf("tabular preview: statement_timeout: %w", err)
	}

	pageArgs := append(searchArgs(e.Columns, pq), pq.Limit, pq.Offset)
	rows, err := tx.Query(ctx, BuildPreviewSQL(e.TableName, e.Columns, pq), pageArgs...)
	if err != nil {
		return nil, fmt.Errorf("tabular preview: query %s: %w", e.TableName, err)
	}
	for rows.Next() {
		row := PreviewRow{Cells: make([]*string, len(e.Columns))}
		dest := make([]any, 0, len(e.Columns)+2)
		dest = append(dest, &row.ID, &row.Empty)
		for i := range row.Cells {
			dest = append(dest, &row.Cells[i])
		}
		if err := rows.Scan(dest...); err != nil {
			rows.Close()
			return nil, fmt.Errorf("tabular preview: scan %s: %w", e.TableName, err)
		}
		page.Rows = append(page.Rows, row)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tabular preview: rows %s: %w", e.TableName, err)
	}

	if err := tx.QueryRow(ctx, buildCountSQL(e.TableName, e.Columns, pq), searchArgs(e.Columns, pq)...).Scan(&page.Matched); err != nil {
		return nil, fmt.Errorf("tabular preview: count %s: %w", e.TableName, err)
	}

	if pq.WithStats {
		var emptyRows int64
		hasValue := make([]*bool, len(e.Columns))
		dest := make([]any, 0, len(e.Columns)+1)
		dest = append(dest, &emptyRows)
		for i := range hasValue {
			dest = append(dest, &hasValue[i])
		}
		if err := tx.QueryRow(ctx, buildStatsSQL(e.TableName, e.Columns)).Scan(dest...); err != nil {
			return nil, fmt.Errorf("tabular preview: stats %s: %w", e.TableName, err)
		}
		page.EmptyRows = &emptyRows
		page.EmptyColumns = []string{}
		for i, v := range hasValue {
			if v == nil || !*v {
				page.EmptyColumns = append(page.EmptyColumns, e.Columns[i].Name)
			}
		}
	}
	return page, nil
}
