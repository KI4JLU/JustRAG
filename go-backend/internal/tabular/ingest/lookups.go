package ingest

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/sheetsource"
	"github.com/justrag/go-backend/internal/tabular"
	"github.com/justrag/go-backend/internal/tabular/profile"
)

// Lookup links: after every table of a file is materialized, the ingest ties
// columns to the file's lookup tables (a sheet of code → name pairs, a grade
// table …) so the preview can show "5 · <name>" and Text-to-SQL can join.
// Three sources, strongest first:
//
//   - formula:    a column computed by VLOOKUP / XLOOKUP / INDEX(MATCH) into
//     another sheet's range — exact.
//   - validation: a dropdown whose list is another sheet's range — exact.
//   - heuristic:  a code column whose name matches a small lookup table (its
//     sheet name or its label header) and whose values all occur in that
//     table's integer key column. Marked as such; may be wrong.
//
// A column gets at most one link; an earlier source wins.

// linkTable is what the lookup pass knows about one materialized table.
type linkTable struct {
	Sheet      string
	Region     profile.Region
	DataStart  int
	TableName  string
	Columns    []tabular.ColumnSpec
	SourceCols map[string]int // primary SQL name → absolute sheet column
	// Formulas holds, per sheet column, the first lookup formula seen in the
	// region's sampled data rows (shared-formula followers carry no text).
	Formulas    map[int]string
	Validations []sheetsource.Validation // the sheet's list validations
	RowCount    int64
}

// colAt returns the SQL name of the primary column at sheet column c.
func (t *linkTable) colAt(c int) (string, bool) {
	for name, sc := range t.SourceCols {
		if sc == c {
			return name, true
		}
	}
	return "", false
}

func (t *linkTable) column(name string) *tabular.ColumnSpec {
	for i := range t.Columns {
		if t.Columns[i].Name == name {
			return &t.Columns[i]
		}
	}
	return nil
}

// rangeRef is one sheet-qualified A1 reference ("'Prozent-Noten'!$A$2:$B$102").
type rangeRef struct {
	Sheet            string
	FromCol, ToCol   int // 0-based, inclusive
	FromRow, ToRow   int // 0-based, inclusive; -1 when the reference spans whole columns
	hasRows, isRange bool
}

var (
	// A sheet-qualified reference: quoted name (with '' as an escaped quote)
	// or a bare one, then a cell or a range.
	qualifiedRefRe = regexp.MustCompile(`^(?:'((?:[^']|'')+)'|([^\s!,()'"]+))!\$?([A-Za-z]{1,3})\$?(\d*)(?::\$?([A-Za-z]{1,3})\$?(\d*))?$`)
	// A same-sheet cell reference (the lookup key argument).
	cellRefRe = regexp.MustCompile(`^\$?([A-Za-z]{1,3})\$?(\d+)$`)
	// The functions the formula pass understands (Excel stores newer ones
	// with an _xlfn. prefix).
	lookupFnRe = regexp.MustCompile(`(?i)(?:_xlfn\.)?\b(VLOOKUP|XLOOKUP|INDEX)\(`)
	matchFnRe  = regexp.MustCompile(`(?i)^MATCH\(`)
)

func colIndex(letters string) int {
	n := 0
	for _, r := range strings.ToUpper(letters) {
		n = n*26 + int(r-'A'+1)
	}
	return n - 1
}

func parseQualifiedRef(s string) (rangeRef, bool) {
	m := qualifiedRefRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return rangeRef{}, false
	}
	sheet := m[2]
	if m[1] != "" {
		sheet = strings.ReplaceAll(m[1], "''", "'")
	}
	r := rangeRef{Sheet: sheet, FromCol: colIndex(m[3]), ToCol: colIndex(m[3]), FromRow: -1, ToRow: -1}
	if m[4] != "" {
		row, _ := strconv.Atoi(m[4])
		r.FromRow, r.ToRow, r.hasRows = row-1, row-1, true
	}
	if m[5] != "" {
		r.isRange = true
		r.ToCol = colIndex(m[5])
		if m[6] != "" {
			row, _ := strconv.Atoi(m[6])
			r.ToRow = row - 1
		} else {
			r.FromRow, r.ToRow, r.hasRows = -1, -1, false
		}
	}
	return r, true
}

// callArgs splits the argument list of the call whose "(" is at open,
// honouring nested calls and quoted sheet names / strings. It returns the
// trimmed arguments, or nil when the parentheses do not close.
func callArgs(f string, open int) []string {
	var args []string
	depth, start := 0, open+1
	var quote rune
	for i, r := range f[open:] {
		pos := open + i
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			}
		case r == '\'' || r == '"':
			quote = r
		case r == '(':
			depth++
		case r == ')':
			depth--
			if depth == 0 {
				return append(args, strings.TrimSpace(f[start:pos]))
			}
		case r == ',' && depth == 1:
			args = append(args, strings.TrimSpace(f[start:pos]))
			start = pos + 1
		}
	}
	return nil
}

// callEnd returns the index of the ")" closing the call whose "(" is at
// open, honouring nesting and quotes; -1 when it does not close.
func callEnd(f string, open int) int {
	depth := 0
	var quote rune
	for i, r := range f[open:] {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			}
		case r == '\'' || r == '"':
			quote = r
		case r == '(':
			depth++
		case r == ')':
			depth--
			if depth == 0 {
				return open + i
			}
		}
	}
	return -1
}

// lookupCall is one lookup found in a formula: the key argument's
// same-sheet column (-1 when it is not a plain cell reference), and the
// target sheet's key and label columns.
type lookupCall struct {
	KeyArgCol int
	Sheet     string
	KeyCol    int
	LabelCol  int
	FromRow   int // -1 when unknown
	ToRow     int
}

func keyArgCol(arg string) int {
	if m := cellRefRe.FindStringSubmatch(arg); m != nil {
		return colIndex(m[1])
	}
	return -1
}

// exactArg reports whether a match-mode argument asks for an exact match:
// FALSE or 0 (VLOOKUP's range_lookup, MATCH's match_type).
func exactArg(a string) bool {
	switch strings.ToUpper(strings.TrimSpace(a)) {
	case "FALSE", "0":
		return true
	}
	return false
}

// singleColumn reports whether r is one column wide.
func singleColumn(r rangeRef) bool { return r.FromCol == r.ToCol }

// rowsAligned reports whether two references cover the same rows (both
// whole columns, or the same row span) — the precondition for reading the
// i-th key next to the i-th value.
func rowsAligned(a, b rangeRef) bool {
	return a.hasRows == b.hasRows && a.FromRow == b.FromRow && a.ToRow == b.ToRow
}

// maskStrings blanks the contents of string literals ("…", with "" as an
// escaped quote) so a function name inside a text constant is not taken
// for a call. Positions are kept, so indexes found in the mask apply to f.
func maskStrings(f string) string {
	b := []byte(f)
	in := false
	for i := 0; i < len(b); i++ {
		if b[i] != '"' {
			if in {
				b[i] = ' '
			}
			continue
		}
		if in && i+1 < len(b) && b[i+1] == '"' { // escaped quote inside a string
			b[i], b[i+1] = ' ', ' '
			i++
			continue
		}
		in = !in
	}
	return string(b)
}

// parseLookupFormula finds the first EXACT lookup into another sheet in a
// formula (without the leading "="). Accepted forms — anything else is no
// link, since an approximate or reshaped lookup is not a key → label table:
//
//   - VLOOKUP(key, Sheet!range, n, FALSE|0)        (range_lookup required)
//   - XLOOKUP(key, Sheet!keys, Sheet!values[, if_not_found[, 0]])
//     with single-column, row-aligned key and value ranges
//   - INDEX(Sheet!values, MATCH(key, Sheet!keys, 0)[, col])
//     with single-column, row-aligned ranges after applying col
//
// The key must be a plain same-sheet cell reference (KeyArgCol >= 0).
func parseLookupFormula(f string) (lookupCall, bool) {
	masked := maskStrings(f)
	for _, loc := range lookupFnRe.FindAllStringSubmatchIndex(masked, -1) {
		fn := strings.ToUpper(f[loc[2]:loc[3]])
		args := callArgs(f, loc[1]-1)
		var call lookupCall
		switch fn {
		case "VLOOKUP":
			if len(args) < 4 || !exactArg(args[3]) {
				continue
			}
			tbl, ok := parseQualifiedRef(args[1])
			n, err := strconv.Atoi(args[2])
			if !ok || !tbl.isRange || err != nil || n < 1 || tbl.FromCol+n-1 > tbl.ToCol {
				continue
			}
			call = lookupCall{KeyArgCol: keyArgCol(args[0]), Sheet: tbl.Sheet, KeyCol: tbl.FromCol, LabelCol: tbl.FromCol + n - 1, FromRow: tbl.FromRow, ToRow: tbl.ToRow}
		case "XLOOKUP":
			if len(args) < 3 || (len(args) >= 5 && strings.TrimSpace(args[4]) != "" && strings.TrimSpace(args[4]) != "0") {
				continue
			}
			keys, ok1 := parseQualifiedRef(args[1])
			vals, ok2 := parseQualifiedRef(args[2])
			if !ok1 || !ok2 || keys.Sheet != vals.Sheet || !singleColumn(keys) || !singleColumn(vals) || !rowsAligned(keys, vals) {
				continue
			}
			call = lookupCall{KeyArgCol: keyArgCol(args[0]), Sheet: keys.Sheet, KeyCol: keys.FromCol, LabelCol: vals.FromCol, FromRow: keys.FromRow, ToRow: keys.ToRow}
		case "INDEX":
			if len(args) < 2 || len(args) > 3 {
				continue
			}
			vals, ok := parseQualifiedRef(args[0])
			m := matchFnRe.FindStringIndex(args[1])
			// MATCH(…) must be the whole row argument — MATCH(…)+1 is an
			// offset lookup, not a key → label read.
			if !ok || m == nil || callEnd(args[1], m[1]-1) != len(args[1])-1 {
				continue
			}
			margs := callArgs(args[1], m[1]-1)
			if len(margs) < 3 || !exactArg(margs[2]) {
				continue
			}
			labelCol := vals.FromCol
			if len(args) == 3 {
				n, err := strconv.Atoi(strings.TrimSpace(args[2]))
				if err != nil || n < 1 || vals.FromCol+n-1 > vals.ToCol {
					continue
				}
				labelCol = vals.FromCol + n - 1
			} else if !singleColumn(vals) {
				continue // multi-column INDEX without a column: no single label
			}
			keys, ok := parseQualifiedRef(margs[1])
			if !ok || keys.Sheet != vals.Sheet || !singleColumn(keys) || !rowsAligned(keys, vals) {
				continue
			}
			call = lookupCall{KeyArgCol: keyArgCol(margs[0]), Sheet: keys.Sheet, KeyCol: keys.FromCol, LabelCol: labelCol, FromRow: keys.FromRow, ToRow: keys.ToRow}
		default:
			continue
		}
		if call.KeyArgCol < 0 {
			continue // key is an expression (TRIM(A2), A2&"x" …): not representable as a column
		}
		return call, true
	}
	return lookupCall{}, false
}

// resolveTarget finds THE materialized table on sheet that holds both sheet
// columns and, for a row-bounded reference, overlaps its rows. Zero or
// several candidates (stacked tables under a whole-column reference, or a
// reference into rows no table covers) mean no link.
func resolveTarget(tables []*linkTable, sheet string, keyCol, labelCol, fromRow, toRow int) (*linkTable, string, string, bool) {
	var found *linkTable
	var key, label string
	for _, t := range tables {
		if t.Sheet != sheet {
			continue
		}
		k, ok1 := t.colAt(keyCol)
		l, ok2 := t.colAt(labelCol)
		if !ok1 || !ok2 {
			continue
		}
		if fromRow >= 0 && !(toRow >= t.DataStart && (t.Region.OpenEnded || fromRow <= t.Region.Bottom)) {
			continue
		}
		if found != nil {
			return nil, "", "", false // ambiguous
		}
		found, key, label = t, k, l
	}
	return found, key, label, found != nil
}

type linkKey struct{ table, column string }

// formulaLinks: columns computed by a lookup into another sheet.
func formulaLinks(tables []*linkTable, out map[linkKey]tabular.LookupRef) {
	for _, t := range tables {
		for sheetCol, f := range t.Formulas {
			col, ok := t.colAt(sheetCol)
			if !ok {
				continue
			}
			call, ok := parseLookupFormula(f)
			if !ok || call.Sheet == t.Sheet {
				continue
			}
			target, key, label, ok := resolveTarget(tables, call.Sheet, call.KeyCol, call.LabelCol, call.FromRow, call.ToRow)
			if !ok || target.TableName == t.TableName {
				continue
			}
			via, ok := t.colAt(call.KeyArgCol)
			if !ok {
				continue // the key cell is not a column of this table
			}
			setLink(out, linkKey{t.TableName, col}, tabular.LookupRef{Table: target.TableName, Key: key, Label: label, Via: via, Source: tabular.LookupSourceFormula})
		}
	}
}

// validationLinks: columns whose dropdown lists another sheet's range — the
// value is the row itself, so key and label are the same column.
func validationLinks(tables []*linkTable, out map[linkKey]tabular.LookupRef) {
	for _, t := range tables {
		for _, v := range t.Validations {
			ref, ok := parseQualifiedRef(strings.TrimPrefix(v.Ref, "="))
			if !ok || ref.Sheet == t.Sheet || ref.FromCol != ref.ToCol {
				continue
			}
			target, key, _, ok := resolveTarget(tables, ref.Sheet, ref.FromCol, ref.FromCol, ref.FromRow, ref.ToRow)
			if !ok || target.TableName == t.TableName {
				continue
			}
			for name, sheetCol := range t.SourceCols {
				if validationCovers(v, sheetCol, t) {
					setLink(out, linkKey{t.TableName, name}, tabular.LookupRef{Table: target.TableName, Key: key, Label: key, Source: tabular.LookupSourceValidation})
				}
			}
		}
	}
}

// validationCovers reports whether any of v's ranges spans sheet column c
// inside t's data rows.
func validationCovers(v sheetsource.Validation, c int, t *linkTable) bool {
	for _, r := range v.Sqref {
		if c < r.FromCol || c > r.ToCol {
			continue
		}
		if r.ToRow >= t.DataStart && (t.Region.OpenEnded || r.FromRow <= t.Region.Bottom) {
			return true
		}
	}
	return false
}

func setLink(out map[linkKey]tabular.LookupRef, k linkKey, ref tabular.LookupRef) {
	if _, taken := out[k]; !taken {
		out[k] = ref
	}
}

// Heuristic bounds: a lookup table is small, only its first two columns are
// tried as the key, and a code column's values are read only after its name
// matched one. The whole pass is capped in queries and time (linkLookups).
const (
	lookupMaxRows       = 500
	lookupMaxValues     = 500
	lookupKeyCandidates = 2
	lookupMaxQueries    = 60
	lookupPassTimeout   = 15 * time.Second
	minNameMatchLen     = 4
)

// normName folds a header or sheet name for matching: lowercase, umlauts
// transliterated as the ingest's SQL names do, everything but letters and
// digits dropped.
func normName(s string) string {
	r := strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss")
	s = r.Replace(strings.ToLower(s))
	var b strings.Builder
	for _, c := range s {
		if unicode.IsLetter(c) || unicode.IsDigit(c) {
			b.WriteRune(c)
		}
	}
	return b.String()
}

// namesMatch: equal after folding, or one a prefix of the other when both are
// long enough ("nutzungsart" ~ "nutzungsarten").
func namesMatch(a, b string) bool {
	a, b = normName(a), normName(b)
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	if len(a) < minNameMatchLen || len(b) < minNameMatchLen {
		return false
	}
	return strings.HasPrefix(a, b) || strings.HasPrefix(b, a)
}

// intKey canonicalises an integer-valued text ("5", "5.0") to "5"; ok is
// false for anything else.
func intKey(v string) (string, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || f != float64(int64(f)) {
		return "", false
	}
	return strconv.FormatInt(int64(f), 10), true
}

// errLookupBudget stops the heuristic once the pass used its query budget.
var errLookupBudget = errors.New("tabular: lookup pass query budget used up")

// valuesFunc reads up to lookupMaxValues distinct values of a column and
// reports whether that is all of them (Materializer.DistinctValues).
type valuesFunc func(ctx context.Context, table, column string) ([]string, bool, error)

type lookupCandidate struct {
	table      *linkTable
	key, label string
	keys       map[string]bool
}

// lookupCandidates: small tables with an integer key column (unique, every
// row) and a text label column after it.
func lookupCandidates(ctx context.Context, tables []*linkTable, values valuesFunc) []lookupCandidate {
	var out []lookupCandidate
	for _, t := range tables {
		if t.RowCount == 0 || t.RowCount > lookupMaxRows || len(t.Columns) < 2 {
			continue
		}
		tried := 0
		for ki, kc := range t.Columns {
			if kc.ShadowOf != "" {
				continue
			}
			if tried == lookupKeyCandidates {
				break
			}
			tried++
			vals, complete, err := values(ctx, t.TableName, kc.Name)
			if err != nil || !complete || int64(len(vals)) != t.RowCount {
				continue
			}
			keys := map[string]bool{}
			for _, v := range vals {
				k, ok := intKey(v)
				if !ok {
					keys = nil
					break
				}
				keys[k] = true
			}
			if len(keys) == 0 {
				continue
			}
			for _, lc := range t.Columns[ki+1:] {
				if lc.Type == tabular.TypeText && lc.ShadowOf == "" {
					out = append(out, lookupCandidate{table: t, key: kc.Name, label: lc.Name, keys: keys})
					break
				}
			}
			break // the first integer key column wins
		}
	}
	return out
}

// heuristicLinks: code columns matched to a lookup candidate by name (its
// sheet name or label header) whose non-blank values all occur in the key
// column. A column matching two candidates is left alone.
func heuristicLinks(ctx context.Context, tables []*linkTable, values valuesFunc, out map[linkKey]tabular.LookupRef) {
	cands := lookupCandidates(ctx, tables, values)
	if len(cands) == 0 {
		return
	}
	for _, t := range tables {
		for _, col := range t.Columns {
			k := linkKey{t.TableName, col.Name}
			if _, taken := out[k]; taken || col.ShadowOf != "" {
				continue
			}
			header := col.Original
			if header == "" {
				header = col.Name
			}
			var match *lookupCandidate
			for i := range cands {
				c := &cands[i]
				if c.table.TableName == t.TableName {
					continue
				}
				label := c.table.column(c.label)
				if !namesMatch(header, c.table.Sheet) && (label == nil || !namesMatch(header, label.Original)) {
					continue
				}
				if match != nil {
					match = nil // ambiguous
					break
				}
				match = c
			}
			if match == nil {
				continue
			}
			vals, complete, err := values(ctx, t.TableName, col.Name)
			if err != nil || !complete {
				continue
			}
			seen := 0
			for _, v := range vals {
				iv, ok := intKey(v)
				if strings.TrimSpace(v) == "" {
					continue // an empty text cell carries no code
				}
				if !ok || !match.keys[iv] {
					seen = -1
					break
				}
				seen++
			}
			if seen > 0 {
				out[k] = tabular.LookupRef{Table: match.table.TableName, Key: match.key, Label: match.label, Source: tabular.LookupSourceHeuristic}
			}
		}
	}
}

// detectLookups runs the three passes and returns the links per table.
func detectLookups(ctx context.Context, tables []*linkTable, values valuesFunc) map[string]map[string]tabular.LookupRef {
	links := map[linkKey]tabular.LookupRef{}
	formulaLinks(tables, links)
	validationLinks(tables, links)
	heuristicLinks(ctx, tables, values, links)
	out := map[string]map[string]tabular.LookupRef{}
	for k, ref := range links {
		if out[k.table] == nil {
			out[k.table] = map[string]tabular.LookupRef{}
		}
		out[k.table][k.column] = ref
	}
	return out
}

// firstLookupFormulas collects, per kept sheet column of a region, the first
// lookup formula in its sampled data rows.
func firstLookupFormulas(sample *sheetsource.Sample, rp profile.RegionProfile) map[int]string {
	out := map[int]string{}
	for _, cp := range rp.Columns {
		for r := rp.DataStart; r <= rp.Region.Bottom && r < len(sample.Rows); r++ {
			if r < 0 || cp.Index >= len(sample.Rows[r]) {
				continue
			}
			c := sample.Rows[r][cp.Index]
			if c.IsFormula && c.Formula != "" && c.Formula != "(shared)" && lookupFnRe.MatchString(c.Formula) {
				out[cp.Index] = c.Formula
				break
			}
		}
	}
	return out
}

// linkLookups detects the file's lookup links and writes them into the
// catalog. Links are an aid, not data: any failure is logged and leaves the
// tables as they are.
func (g *Ingester) linkLookups(ctx context.Context, tables []*linkTable) {
	ctx, cancel := context.WithTimeout(ctx, lookupPassTimeout)
	defer cancel()
	queries := 0
	values := func(ctx context.Context, table, column string) ([]string, bool, error) {
		if queries >= lookupMaxQueries {
			return nil, false, errLookupBudget
		}
		queries++
		return g.mat.DistinctValues(ctx, table, column, lookupMaxValues)
	}
	all := detectLookups(ctx, tables, values)
	for _, t := range tables {
		found := all[t.TableName]
		if len(found) == 0 {
			continue
		}
		cols := append([]tabular.ColumnSpec(nil), t.Columns...)
		for i := range cols {
			if ref, ok := found[cols[i].Name]; ok {
				ref := ref
				cols[i].Lookup = &ref
			}
		}
		if err := g.mat.UpdateColumns(ctx, t.TableName, cols); err != nil {
			logctx.From(ctx).Warn("tabular: lookup links not saved", "table", t.TableName, "error", SanitizeNote(err.Error()))
			continue
		}
		t.Columns = cols
	}
}
