package ingest

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/sheetsource"
	"github.com/justrag/go-backend/internal/tabular"
	"github.com/justrag/go-backend/internal/tabular/profile"
)

// Oracle for the parser: formulas copied from the Zustandsbewertung workbook
// (the VLOOKUP into Prozent-Noten) and Excel's documented argument order for
// VLOOKUP / XLOOKUP / INDEX(MATCH); columns are 0-based (A=0).
func TestParseLookupFormula(t *testing.T) {
	cases := []struct {
		name string
		f    string
		want lookupCall
		ok   bool
	}{
		{"vlookup in IF, quoted sheet", `IF(C11="","",VLOOKUP(C11,'Prozent-Noten'!$A$2:$B$102,2,FALSE))`,
			lookupCall{KeyArgCol: 2, KeyArgRow: 10, Sheet: "Prozent-Noten", KeyCol: 0, LabelCol: 1, FromRow: 1, ToRow: 101}, true},
		{"vlookup third column, bare sheet, whole columns", `VLOOKUP($D5,Codes!B:E,3,0)`,
			lookupCall{KeyArgCol: 3, KeyArgRow: 4, Sheet: "Codes", KeyCol: 1, LabelCol: 3, FromRow: -1, ToRow: -1}, true},
		{"xlookup with prefix", `_xlfn.XLOOKUP(A2,Liste!$A$2:$A$9,Liste!$C$2:$C$9)`,
			lookupCall{KeyArgCol: 0, KeyArgRow: 1, Sheet: "Liste", KeyCol: 0, LabelCol: 2, FromRow: 1, ToRow: 8}, true},
		{"index match", `INDEX('Bau arten'!$C$4:$C$9,MATCH(B7,'Bau arten'!$B$4:$B$9,0))`,
			lookupCall{KeyArgCol: 1, KeyArgRow: 6, Sheet: "Bau arten", KeyCol: 1, LabelCol: 2, FromRow: 3, ToRow: 8}, true},
		{"escaped quote in sheet name", `VLOOKUP(A1,'Peter''s'!A1:B5,2,FALSE)`,
			lookupCall{KeyArgCol: 0, KeyArgRow: 0, Sheet: "Peter's", KeyCol: 0, LabelCol: 1, FromRow: 0, ToRow: 4}, true},
		{"plain cross-sheet copy is not a lookup", `'Erhebung Zustand Bausubstanz'!B4`, lookupCall{}, false},
		{"hard-coded IF chain is not a lookup", `IF('Erhebung Nutzungsart'!$C5=1,"gering","hoch")`, lookupCall{}, false},
		{"column index past the range", `VLOOKUP(A1,Codes!A1:B5,3,FALSE)`, lookupCall{}, false},
		// Codex review of #11 — only exact, row-aligned, column-precise lookups
		// with a plain cell key are links:
		{"approximate vlookup (TRUE)", `VLOOKUP(A2,Codes!A:B,2,TRUE)`, lookupCall{}, false},
		{"vlookup without range_lookup is approximate", `VLOOKUP(A2,Codes!A:B,2)`, lookupCall{}, false},
		{"approximate match", `INDEX(Codes!B2:B9,MATCH(A2,Codes!A2:A9,1))`, lookupCall{}, false},
		{"index honours its column argument", `INDEX(Codes!B2:D9,MATCH(A2,Codes!A2:A9,0),3)`,
			lookupCall{KeyArgCol: 0, KeyArgRow: 1, Sheet: "Codes", KeyCol: 0, LabelCol: 3, FromRow: 1, ToRow: 8}, true},
		{"multi-column index without a column", `INDEX(Codes!B2:D9,MATCH(A2,Codes!A2:A9,0))`, lookupCall{}, false},
		{"offset match is no key read", `INDEX(Codes!B2:B9,MATCH(A2,Codes!A2:A9,0)+1)`, lookupCall{}, false},
		{"misaligned xlookup ranges", `XLOOKUP(A2,Codes!A2:A9,Codes!B3:B10)`, lookupCall{}, false},
		{"approximate xlookup match_mode", `XLOOKUP(A2,Codes!A2:A9,Codes!B2:B9,"",-1)`, lookupCall{}, false},
		{"key is an expression", `VLOOKUP(TRIM(A2),Codes!A:B,2,FALSE)`, lookupCall{}, false},
		{"function name inside a string literal", `IF(A1="VLOOKUP(A2,Codes!A:B,2,0)","x","y")`, lookupCall{}, false},
		// Review of #11: a key with an anchored row is one parameter cell every
		// row reads, not a per-row key.
		{"anchored key row", `VLOOKUP($B$1,Codes!$A$2:$B$50,2,FALSE)`, lookupCall{}, false},
		{"anchored key row in match", `INDEX(Codes!B2:B9,MATCH(B$1,Codes!A2:A9,0))`, lookupCall{}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := parseLookupFormula(c.f)
			if ok != c.ok || (ok && got != c.want) {
				t.Errorf("parseLookupFormula(%q) = %+v, %v; want %+v, %v", c.f, got, ok, c.want, c.ok)
			}
		})
	}
}

func TestNamesMatch(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"Nutzungsart", "Nutzungsarten", true},
		{"Nutzungsart", "Nutzungsart", true},
		{"Gebäude", "gebaeude", true},
		{"Nr.", "Nr", true},
		{"Nr.", "Nutzungsarten", false},
		{"Bauart", "Nutzungsarten", false},
		// Review of #11: a plural is a match, a compound is not.
		{"Note", "Noten", true},
		{"Raum", "Raumgröße", false},
		{"Nutzung", "Nutzungsarten", false},
		{"", "x", false},
	} {
		if got := namesMatch(c.a, c.b); got != c.want {
			t.Errorf("namesMatch(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

// fixture mirrors the Zustandsbewertung workbook: a survey sheet with a
// VLOOKUP grade column and a dropdown column, a code column "Nutzungsart",
// the hidden lookup sheets "Prozent-Noten" and "Nutzungsarten", and a list
// sheet the dropdown points at.
func fixture() ([]*linkTable, map[string][]string) {
	reg := profile.Region{Top: 2, Left: 0, Bottom: 202, Right: 10}
	survey := &linkTable{
		Sheet: "Erhebung", Region: reg, DataStart: 3, TableName: "t_survey", RowCount: 15,
		Columns: []tabular.ColumnSpec{
			{Name: "nr", Original: "Nr.", Type: tabular.TypeText},
			{Name: "prozent", Original: "Prozent", Type: tabular.TypeNumeric},
			{Name: "note", Original: "Note", Type: tabular.TypeNumeric},
			{Name: "nutzungsart", Original: "Nutzungsart", Type: tabular.TypeNumeric},
			{Name: "status", Original: "Status", Type: tabular.TypeText},
			{Name: "baujahr", Original: "Baujahr", Type: tabular.TypeNumeric},
		},
		SourceCols: map[string]int{"nr": 0, "prozent": 2, "note": 3, "nutzungsart": 4, "status": 5, "baujahr": 6},
		Formulas:   map[int]lookupFormula{3: {Text: `IF(C11="","",VLOOKUP(C11,'Prozent-Noten'!$A$2:$B$102,2,FALSE))`, Row: 10}},
		Validations: []sheetsource.Validation{
			{Sqref: []sheetsource.Range{{FromRow: 3, FromCol: 5, ToRow: 202, ToCol: 5}}, Ref: "Listen!$A$2:$A$4"},
		},
	}
	noten := &linkTable{
		Sheet: "Prozent-Noten", Region: profile.Region{Top: 0, Bottom: 101, Right: 1}, DataStart: 1, TableName: "t_noten", RowCount: 101,
		Columns:    []tabular.ColumnSpec{{Name: "prozent", Original: "Prozent", Type: tabular.TypeNumeric}, {Name: "ganze_note", Original: "Ganze Note", Type: tabular.TypeNumeric}},
		SourceCols: map[string]int{"prozent": 0, "ganze_note": 1},
	}
	arten := &linkTable{
		Sheet: "Nutzungsarten", Region: profile.Region{Top: 2, Left: 1, Bottom: 7, Right: 2}, DataStart: 3, TableName: "t_arten", RowCount: 5,
		Columns:    []tabular.ColumnSpec{{Name: "index", Original: "Index", Type: tabular.TypeText}, {Name: "nutzungsart", Original: "Nutzungsart", Type: tabular.TypeText}},
		SourceCols: map[string]int{"index": 1, "nutzungsart": 2},
	}
	listen := &linkTable{
		Sheet: "Listen", Region: profile.Region{Top: 0, Bottom: 3, Right: 0}, DataStart: 1, TableName: "t_listen", RowCount: 3,
		Columns:    []tabular.ColumnSpec{{Name: "status", Original: "Status", Type: tabular.TypeText}},
		SourceCols: map[string]int{"status": 0},
	}
	values := map[string][]string{
		"t_arten.index":        {"1", "2", "3", "4", "5"},
		"t_arten.nutzungsart":  {"gering", "leicht", "erhöht", "hoch", "sehr hoch"},
		"t_noten.prozent":      nil, // 101 rows: never read as a key set by these tests' expectations
		"t_survey.nutzungsart": {"5", "2", "1", "4", ""},
		"t_survey.baujahr":     {"1968", "2004"},
		"t_listen.status":      {"offen", "erledigt", "geprüft"},
		"t_survey.nr":          {"1", "2", "3"},
		"t_survey.prozent":     {"78", "95"},
		"t_survey.note":        {"2", "1"},
		"t_survey.status":      {"offen"},
		"t_noten.ganze_note":   {"1", "2"},
	}
	return []*linkTable{survey, noten, arten, listen}, values
}

func fakeValues(vals map[string][]string) valuesFunc {
	return func(_ context.Context, table, column string) ([]string, bool, error) {
		v, ok := vals[table+"."+column]
		return v, ok, nil
	}
}

func TestDetectLookups(t *testing.T) {
	tables, vals := fixture()
	got := detectLookups(context.Background(), tables, fakeValues(vals))
	want := map[string]map[string]tabular.LookupRef{
		"t_survey": {
			// VLOOKUP(C11, Prozent-Noten!A:B, 2): the grade column, keyed by "prozent".
			"note": {Table: "t_noten", Key: "prozent", Label: "ganze_note", Via: "prozent", Source: tabular.LookupSourceFormula},
			// Dropdown listing Listen!A2:A4.
			"status": {Table: "t_listen", Key: "status", Label: "status", Source: tabular.LookupSourceValidation},
			// Name matches the sheet "Nutzungsarten"; 5, 2, 1, 4 are keys, "" carries no code.
			// The key column is text and the code column numeric, so the join
			// compares numbers.
			"nutzungsart": {Table: "t_arten", Key: "index", Label: "nutzungsart", Source: tabular.LookupSourceHeuristic, Compare: tabular.LookupCompareNumeric},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("detectLookups:\n got %+v\nwant %+v", got, want)
	}
}

func TestHeuristicLinks_Negative(t *testing.T) {
	t.Run("a value outside the key column blocks the link", func(t *testing.T) {
		tables, vals := fixture()
		vals["t_survey.nutzungsart"] = []string{"5", "7"}
		if ref, ok := detectLookups(context.Background(), tables, fakeValues(vals))["t_survey"]["nutzungsart"]; ok {
			t.Errorf("unexpected link %+v", ref)
		}
	})
	t.Run("a zero that is no key blocks the link like any other value", func(t *testing.T) {
		// Codex review of #11: 0 used to be skipped as a template blank.
		tables, vals := fixture()
		vals["t_survey.nutzungsart"] = []string{"5", "2", "0"}
		if ref, ok := detectLookups(context.Background(), tables, fakeValues(vals))["t_survey"]["nutzungsart"]; ok {
			t.Errorf("unexpected link %+v", ref)
		}
	})
	t.Run("no name match, no link — even with matching values", func(t *testing.T) {
		tables, vals := fixture()
		tables[0].Columns[3].Original = "Kategorie"
		tables[0].Columns[3].Name = "kategorie"
		tables[0].SourceCols = map[string]int{"nr": 0, "prozent": 2, "note": 3, "kategorie": 4, "status": 5, "baujahr": 6}
		vals["t_survey.kategorie"] = []string{"1", "2"}
		if ref, ok := detectLookups(context.Background(), tables, fakeValues(vals))["t_survey"]["kategorie"]; ok {
			t.Errorf("unexpected link %+v", ref)
		}
	})
	t.Run("two matching lookup tables are ambiguous", func(t *testing.T) {
		tables, vals := fixture()
		twin := *tables[2]
		twin.Sheet, twin.TableName = "Nutzungsarten alt", "t_arten2"
		tables = append(tables, &twin)
		vals["t_arten2.index"] = vals["t_arten.index"]
		if ref, ok := detectLookups(context.Background(), tables, fakeValues(vals))["t_survey"]["nutzungsart"]; ok {
			t.Errorf("unexpected link %+v", ref)
		}
	})
	t.Run("one code alone does not decide a link", func(t *testing.T) {
		tables, vals := fixture()
		vals["t_survey.nutzungsart"] = []string{"3", ""}
		if ref, ok := detectLookups(context.Background(), tables, fakeValues(vals))["t_survey"]["nutzungsart"]; ok {
			t.Errorf("unexpected link %+v", ref)
		}
	})
	t.Run("keys that fold together are not unique", func(t *testing.T) {
		// "1" and "01" are distinct text with 5 rows, but one integer key.
		tables, vals := fixture()
		vals["t_arten.index"] = []string{"1", "01", "2", "3", "4"}
		vals["t_survey.nutzungsart"] = []string{"1", "2"}
		if ref, ok := detectLookups(context.Background(), tables, fakeValues(vals))["t_survey"]["nutzungsart"]; ok {
			t.Errorf("unexpected link %+v", ref)
		}
	})
	t.Run("stats with repeats skip the key column without a query", func(t *testing.T) {
		tables, vals := fixture()
		tables[2].Stats = map[string]tabular.ColumnStat{"index": {Name: "index", DistinctCount: 3}}
		values := func(ctx context.Context, table, column string) ([]string, bool, error) {
			if table == "t_arten" && column == "index" {
				t.Error("key column read although its stats rule it out")
			}
			return fakeValues(vals)(ctx, table, column)
		}
		if ref, ok := detectLookups(context.Background(), tables, values)["t_survey"]["nutzungsart"]; ok {
			t.Errorf("unexpected link %+v", ref)
		}
	})
	t.Run("a table no column name matches is never probed", func(t *testing.T) {
		tables, vals := fixture()
		// A small two-column table shaped like a lookup table, but no header
		// of the survey matches its sheet or its columns.
		tables = append(tables, &linkTable{
			Sheet: "Sonstiges", Region: profile.Region{Bottom: 3, Right: 1}, DataStart: 1, TableName: "t_misc", RowCount: 3,
			Columns:    []tabular.ColumnSpec{{Name: "id", Original: "Id", Type: tabular.TypeText}, {Name: "text", Original: "Text", Type: tabular.TypeText}},
			SourceCols: map[string]int{"id": 0, "text": 1},
		})
		values := func(ctx context.Context, table, column string) ([]string, bool, error) {
			if table == "t_misc" {
				t.Errorf("probed %s.%s although no header matches it", table, column)
			}
			return fakeValues(vals)(ctx, table, column)
		}
		detectLookups(context.Background(), tables, values)
	})
	t.Run("a key column with duplicates is no lookup table", func(t *testing.T) {
		tables, vals := fixture()
		vals["t_arten.index"] = []string{"1", "2", "3"} // 3 distinct keys for 5 rows
		if ref, ok := detectLookups(context.Background(), tables, fakeValues(vals))["t_survey"]["nutzungsart"]; ok {
			t.Errorf("unexpected link %+v", ref)
		}
	})
}

// Only lookup formulas from data rows count, and shared-formula followers
// (which carry no text) are skipped.
func TestFirstLookupFormulas(t *testing.T) {
	cell := func(f string) sheetsource.Cell { return sheetsource.Cell{IsFormula: f != "", Formula: f} }
	sample := &sheetsource.Sample{Rows: [][]sheetsource.Cell{
		{cell(`VLOOKUP(A1,X!A1:B2,2,0)`), cell("")}, // header row: ignored
		{cell("(shared)"), cell(`SUM(A2:A9)`)},
		{cell(`VLOOKUP(A3,X!A1:B2,2,0)`), cell("")},
	}}
	rp := profile.RegionProfile{Region: profile.Region{Bottom: 2}, DataStart: 1, Columns: []profile.ColumnProfile{{Index: 0}, {Index: 1}}}
	got := firstLookupFormulas(sample, rp)
	if want := map[int]lookupFormula{0: {Text: `VLOOKUP(A3,X!A1:B2,2,0)`, Row: 2}}; !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

// Codex review of #11: a whole-column reference over two stacked tables, or
// a row range no table covers, is ambiguous or unmapped — no link.
func TestResolveTarget_Unambiguous(t *testing.T) {
	mk := func(name string, top, bottom int) *linkTable {
		return &linkTable{Sheet: "Codes", TableName: name, Region: profile.Region{Top: top, Bottom: bottom}, DataStart: top + 1,
			SourceCols: map[string]int{"key": 0, "label": 1}}
	}
	upper, lower := mk("t_upper", 0, 9), mk("t_lower", 20, 29)
	tables := []*linkTable{upper, lower}
	if _, _, _, ok := resolveTarget(tables, "Codes", 0, 1, -1, -1); ok {
		t.Error("whole-column reference over two tables must be ambiguous")
	}
	if got, _, _, ok := resolveTarget(tables, "Codes", 0, 1, 21, 28); !ok || got.TableName != "t_lower" {
		t.Errorf("rows 22-29 must resolve to t_lower, got %v %v", got, ok)
	}
	if _, _, _, ok := resolveTarget(tables, "Codes", 0, 1, 40, 49); ok {
		t.Error("rows no table covers must not resolve")
	}
}

// Review of #11: a formula whose key cell is in another row is no per-row
// link, and Excel-equal values the ingest typed differently join as text.
func TestFormulaLinks_RowAndType(t *testing.T) {
	t.Run("key in another row", func(t *testing.T) {
		tables, vals := fixture()
		f := tables[0].Formulas[3]
		f.Row = 11 // the formula reads C11 from row 12
		tables[0].Formulas[3] = f
		if ref, ok := detectLookups(context.Background(), tables, fakeValues(vals))["t_survey"]["note"]; ok {
			t.Errorf("unexpected link %+v", ref)
		}
	})
	t.Run("mismatched types compare as text", func(t *testing.T) {
		tables, vals := fixture()
		tables[1].Columns[0].Type = tabular.TypeText // Prozent-Noten's key column stayed text
		ref, ok := detectLookups(context.Background(), tables, fakeValues(vals))["t_survey"]["note"]
		if !ok || ref.Compare != tabular.LookupCompareText {
			t.Errorf("got %+v, %v; want a link with compare=text", ref, ok)
		}
	})
}

// slowMat answers DistinctValues only once the detection deadline expired
// and records what UpdateColumns saw.
type slowMat struct {
	fakeMat
	vals    map[string][]string
	updated map[string][]tabular.ColumnSpec
	errs    []error
}

func (m *slowMat) DistinctValues(ctx context.Context, table, column string, _ int) ([]string, bool, error) {
	<-ctx.Done()
	return nil, false, ctx.Err()
}

func (m *slowMat) UpdateColumns(ctx context.Context, table string, cols []tabular.ColumnSpec) error {
	if err := ctx.Err(); err != nil {
		m.errs = append(m.errs, err)
		return err
	}
	m.updated[table] = cols
	return nil
}

// Review of #11: a heuristic that runs out of time must not cost the exact
// links — the writes have their own deadline.
func TestLinkLookups_SlowHeuristicKeepsExactLinks(t *testing.T) {
	old := lookupPassTimeout
	lookupPassTimeout = 20 * time.Millisecond
	t.Cleanup(func() { lookupPassTimeout = old })

	tables, vals := fixture()
	mat := &slowMat{vals: vals, updated: map[string][]tabular.ColumnSpec{}}
	g := &Ingester{mat: mat}
	g.linkLookups(context.Background(), tables)

	if len(mat.errs) > 0 {
		t.Fatalf("UpdateColumns failed: %v", mat.errs)
	}
	got := map[string]string{}
	for _, c := range mat.updated["t_survey"] {
		if c.Lookup != nil {
			got[c.Name] = c.Lookup.Source
		}
	}
	want := map[string]string{"note": tabular.LookupSourceFormula, "status": tabular.LookupSourceValidation}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("saved links %v, want %v", got, want)
	}
}
