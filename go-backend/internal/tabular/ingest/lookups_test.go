package ingest

import (
	"context"
	"reflect"
	"testing"

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
			lookupCall{KeyArgCol: 2, Sheet: "Prozent-Noten", KeyCol: 0, LabelCol: 1, FromRow: 1, ToRow: 101}, true},
		{"vlookup third column, bare sheet, whole columns", `VLOOKUP($D5,Codes!B:E,3,0)`,
			lookupCall{KeyArgCol: 3, Sheet: "Codes", KeyCol: 1, LabelCol: 3, FromRow: -1, ToRow: -1}, true},
		{"xlookup with prefix", `_xlfn.XLOOKUP(A2,Liste!$A$2:$A$9,Liste!$C$2:$C$9)`,
			lookupCall{KeyArgCol: 0, Sheet: "Liste", KeyCol: 0, LabelCol: 2, FromRow: 1, ToRow: 8}, true},
		{"index match", `INDEX('Bau arten'!$C$4:$C$9,MATCH(B7,'Bau arten'!$B$4:$B$9,0))`,
			lookupCall{KeyArgCol: 1, Sheet: "Bau arten", KeyCol: 1, LabelCol: 2, FromRow: 3, ToRow: 8}, true},
		{"escaped quote in sheet name", `VLOOKUP(A1,'Peter''s'!A1:B5,2,FALSE)`,
			lookupCall{KeyArgCol: 0, Sheet: "Peter's", KeyCol: 0, LabelCol: 1, FromRow: 0, ToRow: 4}, true},
		{"plain cross-sheet copy is not a lookup", `'Erhebung Zustand Bausubstanz'!B4`, lookupCall{}, false},
		{"hard-coded IF chain is not a lookup", `IF('Erhebung Nutzungsart'!$C5=1,"gering","hoch")`, lookupCall{}, false},
		{"column index past the range", `VLOOKUP(A1,Codes!A1:B5,3,FALSE)`, lookupCall{}, false},
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
		Formulas:   map[int]string{3: `IF(C11="","",VLOOKUP(C11,'Prozent-Noten'!$A$2:$B$102,2,FALSE))`},
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
		"t_survey.nutzungsart": {"5", "2", "1", "4", "0"},
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
			// Name matches the sheet "Nutzungsarten"; 5, 2, 1, 4 are keys, 0 is a blank template cell.
			"nutzungsart": {Table: "t_arten", Key: "index", Label: "nutzungsart", Source: tabular.LookupSourceHeuristic},
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
	if want := map[int]string{0: `VLOOKUP(A3,X!A1:B2,2,0)`}; !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}
