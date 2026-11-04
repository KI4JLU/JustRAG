package parser

import "context"

// ParseContext holds metadata about the file to be parsed.
type ParseContext struct {
	FilePath  string
	FileName  string
	MimeType  string
	FileSize  int64
	KbID      string
	ChunkSize int // target chunk size in tokens (default 512)
}

// ParseResult contains the extracted text content from a parsed file.
type ParseResult struct {
	Text string // full extracted text content
	// Pages holds per-page text extracted from paginated formats (e.g. PDF).
	// Each entry is {PageNumber (1-based), Text (that page's content)}.
	// When non-empty, the processor splits each page independently so
	// chunks reliably know which page they belong to. When empty, the
	// processor splits the full Text as a single unpaginated document.
	Pages      []PageText
	IsMarkdown bool // true when Text/Pages content is markdown (headings, lists, etc.)
	// Degraded is set when the result came from a fallback parser after the
	// preferred one failed (e.g. Docling timed out and pdftotext answered).
	// The result is still usable for this ingest but must not be cached under
	// the preferred parser's configuration. Not serialized.
	//
	// Known limitation: a Docling run that succeeds but silently drops
	// picture descriptions (per-image timeout, no error) is not detectable
	// here and is not marked Degraded.
	Degraded bool `json:"-"`
	// Structure is the structured content (headings, list groups, table
	// grids) when the parser extracted it; nil for parsers that don't
	// (the built-in ones). Not used by the ingest pipeline — it is
	// consumed by the golden-set parsedump tool.
	Structure *Structure
}

// PageText holds the extracted text for a single page.
type PageText struct {
	PageNumber int // 1-based
	Text       string
}

// Structure is the structured content a parser extracts alongside the text:
// headings, contiguous list groups and table grids, each in reading order.
// The JSON field names and shapes are pinned by the fileparser golden-set
// harness (crates/goldset/src/dump.rs, Structure) — rename or reshape only
// together with that crate.
type Structure struct {
	// Headings in document order. Empty when the parser found none.
	Headings []StructHeading `json:"headings"`
	// Contiguous list groups as the parser grouped them.
	Lists []StructList `json:"lists"`
	// Tables in document order.
	Tables []StructTable `json:"tables"`
}

// StructHeading is one heading in document order.
type StructHeading struct {
	Text  string `json:"text"`  // heading text, as extracted (not normalized)
	Level int    `json:"level"` // 1-based level: H1 = 1
}

// StructList is a contiguous group of list items, as the parser grouped them.
type StructList struct {
	Ordered bool             `json:"ordered"` // true for numbered/lettered lists, false for bullets
	Items   []StructListItem `json:"items"`   // items in document order
}

// StructListItem is one list item.
type StructListItem struct {
	Marker string `json:"marker"` // the rendered marker (1., a), -)
	Text   string `json:"text"`   // item text, as extracted (not normalized)
	Level  int    `json:"level"`  // nesting depth, 0-based
}

// StructTable is a table as a grid of top-left-anchored cells with spans.
type StructTable struct {
	NumRows int          `json:"num_rows"` // number of grid rows
	NumCols int          `json:"num_cols"` // number of grid columns
	Cells   []StructCell `json:"cells"`    // top-left-anchored cells with spans
}

// StructCell is a cell in a table grid, anchored at its top-left corner.
type StructCell struct {
	Row     int    `json:"row"`      // 0-based row of the top-left corner
	Col     int    `json:"col"`      // 0-based column of the top-left corner
	RowSpan int    `json:"row_span"` // number of grid rows this cell spans
	ColSpan int    `json:"col_span"` // number of grid columns this cell spans
	Text    string `json:"text"`     // cell text, as extracted (not normalized)
}

// Parser is the interface implemented by all format-specific parsers.
type Parser interface {
	Name() string
	CanParse(mimeType, fileName string) bool
	Parse(ctx context.Context, pctx ParseContext) (*ParseResult, error)
}

const (
	TextMaxChars = 5_000_000
	PDFMaxPages  = 500
)

// EstimateTokens returns a rough token count estimate (4 chars per token).
func EstimateTokens(text string) int {
	return len(text) / 4
}
