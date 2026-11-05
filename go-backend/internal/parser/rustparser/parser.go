// Package rustparser routes DOCX ingestion through the Rust fileparser
// (fp-server). The service speaks the docling-serve wire protocol, so the
// existing docling client drives it unchanged; this package adds the parser
// identity and the shadow/primary comparison plumbing around it.
package rustparser

import (
	"context"

	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/parser/docling"
)

// DocxParser is a parser.Parser that converts DOCX via the Rust fileparser.
type DocxParser struct {
	Client *docling.Client
}

// Name returns the parser name (used in logs).
func (p *DocxParser) Name() string { return "rustparser-docx" }

// CanParse uses the same predicate as docling.DoclingDocxParser, so the two
// parsers stay in lockstep if the DOCX detection rule ever changes.
func (p *DocxParser) CanParse(mimeType, fileName string) bool {
	return (&docling.DoclingDocxParser{}).CanParse(mimeType, fileName)
}

// Parse converts the file through the fileparser and maps the
// docling-shaped response onto a ParseResult, exactly as the Docling DOCX
// parser does.
func (p *DocxParser) Parse(ctx context.Context, pctx parser.ParseContext) (*parser.ParseResult, error) {
	return docling.ConvertAndMap(ctx, p.Client, pctx)
}
