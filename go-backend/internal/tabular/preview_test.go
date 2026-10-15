package tabular

import "testing"

var previewCols = []ColumnSpec{
	{Name: "nr", Type: TypeBigint},
	{Name: "name", Type: TypeText},
	{Name: "baujahr_num", Type: TypeNumeric, ShadowOf: "baujahr"},
	{Name: "seit", Type: TypeDate},
}

const previewEmpty = `(("name" IS NULL OR btrim("name") IN ('', '0')) AND ("baujahr_num" IS NULL OR "baujahr_num" = 0) AND ("seit" IS NULL))`

// Oracle for every case: the statement written out by hand from the rules in
// the docblocks — the first column never decides emptiness, blank means
// NULL / ” / '0' / 0 by type, identifiers quoted, request values bound.
func TestBuildPreviewSQL_Default(t *testing.T) {
	got := BuildPreviewSQL("sheet_ab_0_0", previewCols, PreviewQuery{})
	want := `SELECT "_rowid", ` + previewEmpty + `, "nr"::text, "name"::text, "baujahr_num"::text, "seit"::text` +
		` FROM "tabular"."sheet_ab_0_0" AS t WHERE NOT ` + previewEmpty + ` ORDER BY t."_rowid" LIMIT $1 OFFSET $2`
	if got != want {
		t.Errorf("default:\n got %s\nwant %s", got, want)
	}
}

func TestBuildPreviewSQL_SearchSortShowEmpty(t *testing.T) {
	got := BuildPreviewSQL("sheet_ab_0_0", previewCols, PreviewQuery{
		Search: "x", SortColumn: "baujahr_num", SortDesc: true, ShowEmpty: true,
	})
	search := `("nr"::text ILIKE $1 ESCAPE '\' OR "nr"::text ILIKE $2 ESCAPE '\' OR "name"::text ILIKE $1 ESCAPE '\'` +
		` OR "baujahr_num"::text ILIKE $1 ESCAPE '\' OR "baujahr_num"::text ILIKE $2 ESCAPE '\' OR "seit"::text ILIKE $1 ESCAPE '\')`
	want := `SELECT "_rowid", ` + previewEmpty + `, "nr"::text, "name"::text, "baujahr_num"::text, "seit"::text` +
		` FROM "tabular"."sheet_ab_0_0" AS t WHERE ` + search +
		` ORDER BY t."baujahr_num" DESC NULLS LAST, t."_rowid" LIMIT $3 OFFSET $4`
	if got != want {
		t.Errorf("search/sort/showEmpty:\n got %s\nwant %s", got, want)
	}
}

// A one-column table has no "rest": its only cell decides emptiness.
func TestEmptyRowSQL_SingleColumn(t *testing.T) {
	got := emptyRowSQL([]ColumnSpec{{Name: "a", Type: TypeText}})
	if want := `(("a" IS NULL OR btrim("a") IN ('', '0')))`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestSearchArgs(t *testing.T) {
	if args := searchArgs(previewCols, PreviewQuery{}); args != nil {
		t.Errorf("no search must bind nothing, got %v", args)
	}
	args := searchArgs(previewCols, PreviewQuery{Search: "3,2_%"})
	if len(args) != 2 || args[0] != `%3,2\_\%%` || args[1] != `%3.2\_\%%` {
		t.Errorf("patterns = %v", args)
	}
}

// Regression: a text-only table must not bind the decimal pattern ($2) no
// expression references — Postgres rejects it ("could not determine data
// type of parameter $2"), which surfaced as a 500 on every search there.
func TestBuildPreviewSQL_SearchTextOnly(t *testing.T) {
	cols := []ColumnSpec{{Name: "a", Type: TypeText}, {Name: "b", Type: TypeText}}
	pq := PreviewQuery{Search: "x"}
	if args := searchArgs(cols, pq); len(args) != 1 {
		t.Fatalf("text-only search must bind one pattern, got %v", args)
	}
	empty := `(("b" IS NULL OR btrim("b") IN ('', '0')))`
	want := `SELECT "_rowid", ` + empty + `, "a"::text, "b"::text FROM "tabular"."t" AS t WHERE NOT ` + empty +
		` AND ("a"::text ILIKE $1 ESCAPE '\' OR "b"::text ILIKE $1 ESCAPE '\') ORDER BY t."_rowid" LIMIT $2 OFFSET $3`
	if got := BuildPreviewSQL("t", cols, pq); got != want {
		t.Errorf("text-only search:\n got %s\nwant %s", got, want)
	}
}
