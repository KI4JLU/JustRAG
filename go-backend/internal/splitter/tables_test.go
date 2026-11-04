package splitter

import (
	"fmt"
	"strings"
	"testing"
)

const tblHeader = "| Konto | Bezeichnung | Betrag | Periode |"
const tblSep = "|---|---|---|---|"

func table(rows int) string {
	var b strings.Builder
	b.WriteString(tblHeader + "\n" + tblSep + "\n")
	for i := range rows {
		fmt.Fprintf(&b, "| 4%03d | Mieten Geräte Nr. %d | %d.785,00 | 2026/%d |\n", i, i, i, i%12+1)
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func smallCfg() Config {
	return Config{ChunkSize: 120, ChunkOverlap: 15, Separators: MarkdownSeparators}
}

// rowsWithoutHeader counts data rows of the test table sitting in a chunk
// that does not contain the header — the KI-853 measurement, applied here
// as an oracle independent of repeatTableHeaders' own logic.
func rowsWithoutHeader(chunks []string) (rows, orphans int) {
	for _, c := range chunks {
		has := strings.Contains(c, tblHeader)
		for _, l := range strings.Split(c, "\n") {
			if strings.HasPrefix(l, "| 4") {
				rows++
				if !has {
					orphans++
				}
			}
		}
	}
	return rows, orphans
}

func TestSplit_LongTableRepeatsHeaderInEveryChunk(t *testing.T) {
	text := "Einleitung zum Haushalt.\n\n" + table(60) + "\n\nNachbemerkung ohne Tabelle."
	chunks := Split(text, smallCfg())
	if len(chunks) < 4 {
		t.Fatalf("want the table split over several chunks, got %d", len(chunks))
	}
	rows, orphans := rowsWithoutHeader(chunks)
	if rows < 60 || orphans != 0 {
		t.Fatalf("rows=%d orphans=%d, want every row with its header", rows, orphans)
	}
	for i, c := range chunks {
		if n := strings.Count(c, tblHeader); n > 1 {
			t.Errorf("chunk %d carries the header %d times", i, n)
		}
		if strings.Contains(c, tblHeader) && !strings.Contains(c, tblSep) {
			t.Errorf("chunk %d has the header but not the |---| row", i)
		}
	}
	last := chunks[len(chunks)-1]
	if strings.Contains(last, "Nachbemerkung") && !strings.Contains(last, "| 4") && strings.Contains(last, tblHeader) {
		t.Errorf("prose-only chunk after the table got a header: %q", last)
	}
}

// Without the fix this is what happened: the oracle must be able to fail.
func TestSplit_OracleSeesTheOldLoss(t *testing.T) {
	cfg := smallCfg()
	raw := splitRecursive(table(60), cfg.Separators, cfg.ChunkSize, cfg.ChunkOverlap)
	if _, orphans := rowsWithoutHeader(raw); orphans == 0 {
		t.Fatal("unfixed split shows no orphan rows; the oracle proves nothing")
	}
}

func TestSplit_TextWithoutTablesUnchanged(t *testing.T) {
	cfg := smallCfg()
	text := strings.Repeat("Ein Absatz über Prüfungsordnungen, Fristen und Zuständigkeiten. ", 40) +
		"\n\nEine Zeile mit | Pipe mitten im Text.\n\n" + strings.Repeat("Noch ein Satz. ", 50)
	got := Split(text, cfg)
	want := splitRecursive(strings.TrimSpace(text), cfg.Separators, cfg.ChunkSize, cfg.ChunkOverlap)
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatal("text without markdown tables must split exactly as before")
	}
}

func TestSplitCarry_TableContinuesOnNextPage(t *testing.T) {
	cfg := smallCfg()
	page1 := "Seite eins.\n\n" + table(3)
	_, carry := SplitCarry(page1, cfg, TableCarry{})
	if carry.header != tblHeader {
		t.Fatalf("carry after page 1 = %+v, want the open table", carry)
	}

	// Next page starts with bare rows: they get the header.
	got, _ := SplitCarry("| 4100 | Fortsetzung | 1,00 | 2026/1 |", cfg, carry)
	if len(got) != 1 || !strings.HasPrefix(got[0], tblHeader+"\n"+tblSep+"\n| 4100") {
		t.Errorf("continuation page = %q, want header prefixed", got)
	}
	// Next page starts with prose: nothing is added, and the table is closed.
	got, c2 := SplitCarry("Neuer Abschnitt.", cfg, carry)
	if strings.Contains(got[0], tblHeader) || c2 != (TableCarry{}) {
		t.Errorf("prose page = %q carry=%+v, want untouched and closed", got, c2)
	}
	// Next page starts with its own table: its own header, no second one.
	own := "| A | B |\n|---|---|\n| 1 | 2 |"
	got, _ = SplitCarry(own, cfg, carry)
	if got[0] != own {
		t.Errorf("page with its own table = %q, want unchanged", got[0])
	}
}

func TestSplit_OverlongHeaderNotRepeated(t *testing.T) {
	cfg := smallCfg()
	// About 43 tokens with its |---| row: fits in a chunk (120) but exceeds chunkSize/4 (30).
	wide := "|" + strings.Repeat(" Spaltenüberschrift |", 6)
	sep := "|" + strings.Repeat("---|", 6)
	var b strings.Builder
	b.WriteString(wide + "\n" + sep + "\n")
	for i := range 40 {
		fmt.Fprintf(&b, "| %d |\n", i)
	}
	for i, c := range Split(b.String(), cfg)[1:] {
		if strings.Contains(c, "Spaltenüberschrift") {
			t.Errorf("chunk %d repeats a header over chunkSize/4", i+1)
		}
	}
}

// The overlap is cut at word boundaries: a chunk continuing a table can start
// with the tail of a row whose full text is in the previous chunk. The tail
// is dropped and the header goes in front; nothing else is lost.
func TestRepeatTableHeaders_DropsOverlapRowTail(t *testing.T) {
	chunks := []string{
		tblHeader + "\n" + tblSep + "\n| 4001 | Miete | 1,00 | 2026/1 |\n| 4002 | Strom | 2,00 | 2026/2 |",
		"2,00 | 2026/2 |\n| 4003 | Wasser | 3,00 | 2026/3 |",
	}
	got, carry := repeatTableHeaders(chunks, TableCarry{}, 512)
	want := tblHeader + "\n" + tblSep + "\n| 4003 | Wasser | 3,00 | 2026/3 |"
	if got[1] != want {
		t.Errorf("chunk 1 = %q, want %q", got[1], want)
	}
	if carry.header != tblHeader {
		t.Errorf("carry = %+v, want the table still open", carry)
	}
	// At the start of a text nothing overlaps: a leading tail-like line is
	// kept (it is real content) and the table counts as closed.
	got, _ = repeatTableHeaders([]string{"a | b |\n| 1 | 2 |"}, TableCarry{header: tblHeader, sep: tblSep}, 512)
	if got[0] != "a | b |\n| 1 | 2 |" {
		t.Errorf("first chunk of a text = %q, want unchanged", got[0])
	}
}
