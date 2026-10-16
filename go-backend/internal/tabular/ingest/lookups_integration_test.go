//go:build integration

package ingest

import (
	"context"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/justrag/go-backend/internal/tabular"
	"github.com/xuri/excelize/v2"
)

// writeLookupWorkbook builds the Zustandsbewertung pattern in miniature:
// a visible survey sheet whose "Note" column is a VLOOKUP into the hidden
// "Prozent-Noten" sheet, and whose "Nutzungsart" column holds codes of the
// hidden "Nutzungsarten" sheet without any formula pointing there.
func writeLookupWorkbook(t *testing.T) string {
	t.Helper()
	f := excelize.NewFile()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(f.SetSheetName("Sheet1", "Erhebung"))
	for _, s := range []string{"Prozent-Noten", "Nutzungsarten"} {
		_, err := f.NewSheet(s)
		must(err)
		must(f.SetSheetVisible(s, false))
	}

	must(f.SetSheetRow("Erhebung", "A1", &[]any{"Nr.", "Gebäude", "Prozent", "Note", "Nutzungsart"}))
	survey := []struct {
		name          string
		prozent, note int
		art           int
	}{{"Aulweg 129", 95, 1, 5}, {"Aulweg 121", 78, 2, 2}, {"Klinik 29", 64, 3, 1}, {"Schubert 81", 51, 4, 4}, {"RB 6", 88, 2, 5}}
	for i, s := range survey {
		r := i + 2
		must(f.SetSheetRow("Erhebung", fmt.Sprintf("A%d", r), &[]any{i + 1, s.name, s.prozent}))
		must(f.SetCellValue("Erhebung", fmt.Sprintf("E%d", r), s.art))
		// Cached value first: SetCellFormula keeps it, SetCellValue after a
		// formula would drop the formula.
		must(f.SetCellValue("Erhebung", fmt.Sprintf("D%d", r), s.note))
		must(f.SetCellFormula("Erhebung", fmt.Sprintf("D%d", r), fmt.Sprintf("VLOOKUP(C%d,'Prozent-Noten'!$A$2:$B$102,2,FALSE)", r)))
	}

	must(f.SetSheetRow("Prozent-Noten", "A1", &[]any{"Prozent", "Ganze Note"}))
	for p := 100; p >= 0; p-- {
		note := 6 - min(5, p/17)
		must(f.SetSheetRow("Prozent-Noten", fmt.Sprintf("A%d", 102-p), &[]any{p, note}))
	}

	must(f.SetSheetRow("Nutzungsarten", "A1", &[]any{"Index", "Nutzungsart"}))
	for i, label := range []string{"gering", "leicht erhöht", "erhöht", "hoch", "sehr hoch"} {
		must(f.SetSheetRow("Nutzungsarten", fmt.Sprintf("A%d", i+2), &[]any{i + 1, label}))
	}

	path := t.TempDir() + "/lookups.xlsx"
	must(f.SaveAs(path))
	return path
}

func columnBySheet(t *testing.T, entries []tabular.CatalogEntry, sheet, column string) (tabular.CatalogEntry, tabular.ColumnSpec) {
	t.Helper()
	for _, e := range entries {
		if e.SheetName != sheet {
			continue
		}
		for _, c := range e.Columns {
			if c.Name == column {
				return e, c
			}
		}
	}
	t.Fatalf("no column %s.%s in catalog %+v", sheet, column, entries)
	return tabular.CatalogEntry{}, tabular.ColumnSpec{}
}

// Oracle: the workbook written above — what each column was built from is
// known by construction, so the stored links can be checked against it.
func TestIngestLookupLinksEndToEnd(t *testing.T) {
	pool := openMainPool(t)
	fileID, kbID := seedFile(t, pool, "lookups.xlsx")
	mat := tabular.NewMaterializer(pool)
	t.Cleanup(func() { _ = mat.DropTablesForFile(context.Background(), fileID) })

	path := writeLookupWorkbook(t)
	if _, err := New(mat, nil).Ingest(context.Background(), Input{
		FilePath: path, FileName: "lookups.xlsx", FileID: fileID, KBID: kbID,
		Options: Options{Materialize: true, SampleRows: 200, ChunkSize: 512},
	}); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	entries, err := tabular.NewCatalog(pool).ListByFile(context.Background(), fileID)
	if err != nil {
		t.Fatal(err)
	}

	noten, _ := columnBySheet(t, entries, "Prozent-Noten", "prozent")
	arten, _ := columnBySheet(t, entries, "Nutzungsarten", "index")

	_, note := columnBySheet(t, entries, "Erhebung", "note")
	wantNote := tabular.LookupRef{Table: noten.TableName, Key: "prozent", Label: "ganze_note", Via: "prozent", Source: tabular.LookupSourceFormula}
	if note.Lookup == nil || *note.Lookup != wantNote {
		t.Errorf("note.lookup = %+v, want %+v", note.Lookup, wantNote)
	}

	// The materializer keeps the "Index" key column as text while the code
	// column is numeric, so the link says to compare them as numbers.
	survey, art := columnBySheet(t, entries, "Erhebung", "nutzungsart")
	wantArt := tabular.LookupRef{Table: arten.TableName, Key: "index", Label: "nutzungsart", Source: tabular.LookupSourceHeuristic, Compare: tabular.LookupCompareNumeric}
	if art.Lookup == nil || *art.Lookup != wantArt {
		t.Errorf("nutzungsart.lookup = %+v, want %+v", art.Lookup, wantArt)
	}

	// The join the schema hint suggests must run on the real tables and
	// name every survey row (review of #11: a plain index = nutzungsart is
	// text = numeric, which Postgres rejects).
	var joined int
	q := fmt.Sprintf(`SELECT count(a.nutzungsart) FROM %s s JOIN %s a ON %s = %s`,
		pgx.Identifier{tabular.TabularSchema, survey.TableName}.Sanitize(), pgx.Identifier{tabular.TabularSchema, arten.TableName}.Sanitize(),
		tabular.LookupJoinExpr("a.index", wantArt.Compare), tabular.LookupJoinExpr("s.nutzungsart", wantArt.Compare))
	if err := pool.QueryRow(context.Background(), q).Scan(&joined); err != nil {
		t.Fatalf("hinted join failed: %v\n%s", err, q)
	}
	if joined != 5 {
		t.Errorf("hinted join named %d survey rows, want 5", joined)
	}

	for _, name := range []string{"nr", "gebaeude", "prozent"} {
		if _, c := columnBySheet(t, entries, "Erhebung", name); c.Lookup != nil {
			t.Errorf("%s must have no link, got %+v", name, c.Lookup)
		}
	}
}

// The dropdown fixture: header_row14_metadata.xlsx lists a column's values
// on the hidden "Dropdown" sheet via a list validation.
func TestIngestValidationLinkEndToEnd(t *testing.T) {
	pool := openMainPool(t)
	fileID, kbID := seedFile(t, pool, "header_row14_metadata.xlsx")
	mat := tabular.NewMaterializer(pool)
	t.Cleanup(func() { _ = mat.DropTablesForFile(context.Background(), fileID) })

	if _, err := New(mat, nil).Ingest(context.Background(), Input{
		FilePath: fixtures + "header_row14_metadata.xlsx", FileName: "header_row14_metadata.xlsx", FileID: fileID, KBID: kbID,
		Options: Options{Materialize: true, SampleRows: 200, ChunkSize: 512},
	}); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	entries, err := tabular.NewCatalog(pool).ListByFile(context.Background(), fileID)
	if err != nil {
		t.Fatal(err)
	}
	var links []string
	for _, e := range entries {
		for _, c := range e.Columns {
			if c.Lookup != nil {
				links = append(links, fmt.Sprintf("%s.%s -> %s.%s (%s)", e.SheetName, c.Name, c.Lookup.Table, c.Lookup.Key, c.Lookup.Source))
			}
		}
	}
	// The Gebäudeliste's Denkmalschutz column takes its dropdown values from
	// the hidden Dropdown sheet's "Denkmalschutz" list.
	_, col := columnBySheet(t, entries, "Gebäudeliste", "stammdaten_denkmalschutz")
	if col.Lookup == nil || col.Lookup.Source != tabular.LookupSourceValidation || col.Lookup.Key != "denkmalschutz" || col.Lookup.Label != "denkmalschutz" {
		t.Errorf("stammdaten_denkmalschutz.lookup = %+v; all links: %v", col.Lookup, links)
	}
	if len(links) != 1 {
		t.Errorf("expected exactly one link, got %v", links)
	}
}
