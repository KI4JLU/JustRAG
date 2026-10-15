//go:build integration

package tabular

import (
	"context"
	"reflect"
	"testing"
)

// Oracle: rows inserted by hand into a template-like table — a running
// number in the first column, two filled rows, two template rows that only
// carry the number plus 0/”/NULL, and a column nobody filled in. Every
// expectation below is read off that literal data, not off the SQL builder.
func TestPreviewRows(t *testing.T) {
	ctx := context.Background()
	pool := openMainPool(t)
	if _, err := pool.Exec(ctx, `CREATE TABLE tabular.preview_it_0_0 (_rowid bigint PRIMARY KEY, nr bigint, name text, amount numeric, unused text)`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DROP TABLE IF EXISTS tabular.preview_it_0_0`) })
	if _, err := pool.Exec(ctx, `INSERT INTO tabular.preview_it_0_0 VALUES
		(4, 4, '0', 0, NULL),
		(1, 1, 'Aulweg 129', 3.2, NULL),
		(3, 3, NULL, NULL, ''),
		(2, 2, 'Klinikstraße', NULL, NULL)`); err != nil {
		t.Fatal(err)
	}
	entry := CatalogEntry{TableName: "preview_it_0_0", Columns: []ColumnSpec{
		{Name: "nr", Type: TypeBigint}, {Name: "name", Type: TypeText},
		{Name: "amount", Type: TypeNumeric}, {Name: "unused", Type: TypeText},
	}}
	cat := NewCatalog(pool)

	ids := func(p *PreviewPage) []int64 {
		out := []int64{}
		for _, r := range p.Rows {
			out = append(out, r.ID)
		}
		return out
	}
	read := func(t *testing.T, pq PreviewQuery) *PreviewPage {
		t.Helper()
		if pq.Limit == 0 {
			pq.Limit = 10
		}
		p, err := cat.PreviewRows(ctx, entry, pq)
		if err != nil {
			t.Fatalf("PreviewRows(%+v): %v", pq, err)
		}
		return p
	}

	t.Run("hides template rows and reports the stats", func(t *testing.T) {
		p := read(t, PreviewQuery{WithStats: true})
		if got := ids(p); !reflect.DeepEqual(got, []int64{1, 2}) {
			t.Errorf("rows = %v, want [1 2]", got)
		}
		if p.Matched != 2 || p.EmptyRows == nil || *p.EmptyRows != 2 {
			t.Errorf("matched %d, empty rows %v; want 2 and 2", p.Matched, p.EmptyRows)
		}
		if !reflect.DeepEqual(p.EmptyColumns, []string{"unused"}) {
			t.Errorf("empty columns = %v, want [unused]", p.EmptyColumns)
		}
		if *p.Rows[0].Cells[2] != "3.2" || p.Rows[1].Cells[2] != nil {
			t.Errorf("amount cells = %v / %v", p.Rows[0].Cells[2], p.Rows[1].Cells[2])
		}
	})

	t.Run("shows empty rows flagged, in _rowid order", func(t *testing.T) {
		p := read(t, PreviewQuery{ShowEmpty: true})
		if got := ids(p); !reflect.DeepEqual(got, []int64{1, 2, 3, 4}) {
			t.Errorf("rows = %v", got)
		}
		flags := []bool{p.Rows[0].Empty, p.Rows[1].Empty, p.Rows[2].Empty, p.Rows[3].Empty}
		if !reflect.DeepEqual(flags, []bool{false, false, true, true}) {
			t.Errorf("empty flags = %v", flags)
		}
		if p.EmptyRows != nil {
			t.Error("stats were not asked for")
		}
	})

	t.Run("search is case-insensitive and a decimal comma matches", func(t *testing.T) {
		if got := ids(read(t, PreviewQuery{Search: "KLINIK"})); !reflect.DeepEqual(got, []int64{2}) {
			t.Errorf("KLINIK -> %v", got)
		}
		p := read(t, PreviewQuery{Search: "3,2"})
		if got := ids(p); !reflect.DeepEqual(got, []int64{1}) || p.Matched != 1 {
			t.Errorf("3,2 -> %v (matched %d)", got, p.Matched)
		}
		if got := ids(read(t, PreviewQuery{Search: "100%"})); len(got) != 0 {
			t.Errorf("LIKE metacharacters must match literally, got %v", got)
		}
	})

	t.Run("search works on a text-only table", func(t *testing.T) {
		// Regression: the decimal pattern was bound even with no numeric
		// column referencing it, and Postgres rejected the statement.
		if _, err := pool.Exec(ctx, `CREATE TABLE tabular.preview_it_1_0 (_rowid bigint PRIMARY KEY, a text, b text)`); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { pool.Exec(ctx, `DROP TABLE IF EXISTS tabular.preview_it_1_0`) })
		if _, err := pool.Exec(ctx, `INSERT INTO tabular.preview_it_1_0 VALUES (1, 'x', 'Baurecht'), (2, 'y', 'Brandschutz')`); err != nil {
			t.Fatal(err)
		}
		textOnly := CatalogEntry{TableName: "preview_it_1_0", Columns: []ColumnSpec{{Name: "a", Type: TypeText}, {Name: "b", Type: TypeText}}}
		p, err := cat.PreviewRows(ctx, textOnly, PreviewQuery{Search: "brand", Limit: 10})
		if err != nil {
			t.Fatalf("PreviewRows: %v", err)
		}
		if got := ids(p); !reflect.DeepEqual(got, []int64{2}) || p.Matched != 1 {
			t.Errorf("brand -> %v (matched %d)", got, p.Matched)
		}
	})

	t.Run("sorts with NULL last in both directions", func(t *testing.T) {
		if got := ids(read(t, PreviewQuery{SortColumn: "amount", ShowEmpty: true})); !reflect.DeepEqual(got, []int64{4, 1, 2, 3}) {
			t.Errorf("asc -> %v, want [4 1 2 3]", got)
		}
		if got := ids(read(t, PreviewQuery{SortColumn: "amount", SortDesc: true, ShowEmpty: true})); !reflect.DeepEqual(got, []int64{1, 4, 2, 3}) {
			t.Errorf("desc -> %v, want [1 4 2 3]", got)
		}
	})

	t.Run("pages with limit and offset", func(t *testing.T) {
		p := read(t, PreviewQuery{ShowEmpty: true, Offset: 1, Limit: 2})
		if got := ids(p); !reflect.DeepEqual(got, []int64{2, 3}) || p.Matched != 4 {
			t.Errorf("page -> %v (matched %d)", got, p.Matched)
		}
	})
}
