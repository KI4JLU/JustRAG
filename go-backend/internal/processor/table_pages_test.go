package processor

import (
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/splitter"
)

// KI-853: a table that runs on onto the next page continues there without
// its header; buildIndexedChunks carries the open table across pages, so
// the next page's rows get the header too.
func TestBuildIndexedChunks_TableAcrossPagesKeepsHeader(t *testing.T) {
	header, sep := "| Kurs | Datum | Seite |", "|---|---|---|"
	res := &parser.ParseResult{Pages: []parser.PageText{
		{PageNumber: 1, Text: "Programm\n\n" + header + "\n" + sep + "\n| 26WK25 | 07.04.26 | S. 54 |"},
		{PageNumber: 2, Text: "| 26PC29 | 08.04.26 | S. 117 |\n| 26FK27 | 10.04.26 | S. 43 |"},
	}}
	chunks := buildIndexedChunks(res, splitter.MarkdownConfig())
	var page2 []string
	for _, c := range chunks {
		if len(c.Pages) == 1 && c.Pages[0] == 2 {
			page2 = append(page2, c.Text)
		}
	}
	if len(page2) != 1 || !strings.HasPrefix(page2[0], header+"\n"+sep+"\n| 26PC29") {
		t.Fatalf("page 2 chunks = %q, want the header repeated in front", page2)
	}
}
