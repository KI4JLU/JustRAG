// parsedump runs JustRAG's production parser chain on one file and prints the
// ParseResult as JSON, so the fileparser golden-set harness (goldset) can
// score exactly what JustRAG would index.
//
// Usage:
//
//	cd go-backend && go build -o /tmp/parsedump ./cmd/parsedump
//	/tmp/parsedump -parser builtin|docling [-docling-url URL] [-doc ID] FILE
//
// Parse failures are reported in the JSON "error" field with exit code 0;
// only usage errors exit non-zero.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/parser/docling"
)

// Dump is the JSON shape goldset's ParseDump reads.
type Dump struct {
	Parser     string  `json:"parser"`
	Doc        string  `json:"doc"`
	Text       string  `json:"text"`
	Pages      []Page  `json:"pages"`
	IsMarkdown bool    `json:"is_markdown"`
	Degraded   bool    `json:"degraded"`
	Error      *string `json:"error"`
	ElapsedMS  int64   `json:"elapsed_ms"`
	// Structure is the parser's structured content (headings, lists,
	// tables) in the goldset schema; omitted for parsers that produce
	// none (builtin), where the field's absence is the signal.
	Structure *parser.Structure `json:"structure,omitempty"`
}

// Page is one entry of Dump.Pages.
type Page struct {
	PageNumber int    `json:"page_number"`
	Text       string `json:"text"`
}

// mimeFor mirrors internal/uploadcheck: MIME from the extension only.
func mimeFor(fileName string) string {
	mt := mime.TypeByExtension(strings.ToLower(filepath.Ext(fileName)))
	if mt == "" {
		return "application/octet-stream"
	}
	return mt
}

// doclingClient mirrors the fixed defaults of internal/app/worker.go
// readDoclingOptions (table_mode accurate, OCR de+en, 600 s per document).
// Captioning and formula enrichment need site config and a vision endpoint and
// are not reproduced here.
func doclingClient(url, ocrLangs, tableMode string) *docling.Client {
	dc := docling.NewClient(url, 300*time.Second)
	dc.Async = true
	dc.Options = docling.ConvertOptions{
		TableMode:              tableMode,
		OCRLanguages:           strings.Split(ocrLangs, ","),
		DocumentTimeoutSeconds: 600,
	}
	return dc
}

// buildFactory returns the parser chain for kind: "builtin" is JustRAG with
// Docling disabled; "docling" mirrors internal/app/worker.go with Docling
// enabled (Docling first, built-in parser as fallback).
func buildFactory(kind, doclingURL string) (*parser.Factory, error) {
	return buildFactoryWith(kind, doclingURL, "de,en", "accurate")
}

func buildFactoryWith(kind, doclingURL, ocrLangs, tableMode string) (*parser.Factory, error) {
	switch kind {
	case "builtin":
		return parser.DefaultFactory(nil), nil
	case "docling":
		if doclingURL == "" {
			return nil, errors.New("-docling-url is required with -parser docling")
		}
		dc := doclingClient(doclingURL, ocrLangs, tableMode)
		return parser.DefaultFactoryWith(nil,
			&docling.FallbackParser{Primary: &docling.DoclingPDFParser{Client: dc}, Fallback: &parser.PDFParser{}},
			&docling.FallbackParser{Primary: &docling.DoclingDocxParser{Client: dc}, Fallback: &parser.DocxParser{}},
			&docling.FallbackParser{Primary: &docling.DoclingPptxParser{Client: dc}, Fallback: &parser.PptxParser{}},
		), nil
	default:
		return nil, fmt.Errorf("unknown parser %q (want builtin or docling)", kind)
	}
}

func dump(ctx context.Context, f *parser.Factory, parserName, docID, path string) Dump {
	d := Dump{Parser: parserName, Doc: docID, Pages: []Page{}}
	fail := func(err error) Dump {
		msg := err.Error()
		d.Error = &msg
		return d
	}
	fileName := filepath.Base(path)
	mt := mimeFor(fileName)
	info, err := os.Stat(path)
	if err != nil {
		return fail(err)
	}
	p := f.GetParser(mt, fileName)
	if p == nil {
		return fail(fmt.Errorf("no parser for %s", mt))
	}
	start := time.Now()
	res, err := p.Parse(ctx, parser.ParseContext{FilePath: path, FileName: fileName, MimeType: mt, FileSize: info.Size()})
	d.ElapsedMS = time.Since(start).Milliseconds()
	if err != nil {
		return fail(err)
	}
	if res == nil {
		return fail(errors.New("parser returned no result"))
	}
	d.Text, d.IsMarkdown, d.Degraded = res.Text, res.IsMarkdown, res.Degraded
	d.Structure = res.Structure
	for _, pg := range res.Pages {
		d.Pages = append(d.Pages, Page{PageNumber: pg.PageNumber, Text: pg.Text})
	}
	return d
}

func main() {
	kind := flag.String("parser", "builtin", "parser chain: builtin or docling")
	doclingURL := flag.String("docling-url", "", "Docling Serve (or docling-compatible) base URL")
	docID := flag.String("doc", "", "document id recorded in the output (default: file name)")
	ocrLangs := flag.String("ocr-lang", "de,en", "Docling OCR languages (production default de,en)")
	tableMode := flag.String("table-mode", "accurate", "Docling table mode (production default accurate)")
	flag.Parse()
	if flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: parsedump -parser builtin|docling [-docling-url URL] [-doc ID] FILE")
		os.Exit(2)
	}
	path := flag.Arg(0)
	f, err := buildFactoryWith(*kind, *doclingURL, *ocrLangs, *tableMode)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	id := *docID
	if id == "" {
		id = filepath.Base(path)
	}
	if err := json.NewEncoder(os.Stdout).Encode(dump(context.Background(), f, *kind, id, path)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
