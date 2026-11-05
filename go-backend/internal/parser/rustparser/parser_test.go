package rustparser

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/parser/docling"
)

const docxMIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// TestRustDocxParserMapsResponse replays a real fp-server response captured
// against the live service in the fileparser repo's Task 20 gate run (see
// testdata/fp-docx-response.json). It is deliberately not a hand-written
// mock: the docling client's assumptions about the response shape are the
// contract, and a hand-rolled body would only prove that we parse what we
// pretend the server sends (the lesson from docs/observability/docling.md).
func TestRustDocxParserMapsResponse(t *testing.T) {
	body, err := os.ReadFile("testdata/fp-docx-response.json")
	if err != nil {
		t.Fatalf("read captured response: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/convert/file" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)

	c := docling.NewClient(srv.URL, 10*time.Second)
	p := &DocxParser{Client: c}

	// ConvertAndMap opens FilePath before uploading; the bytes themselves
	// are irrelevant to the mapping under test.
	dir := t.TempDir()
	file := filepath.Join(dir, "sample.docx")
	if err := os.WriteFile(file, []byte("placeholder bytes"), 0o644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	res, err := p.Parse(context.Background(), parser.ParseContext{
		FilePath: file,
		FileName: "sample.docx",
		MimeType: docxMIME,
	})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !res.IsMarkdown {
		t.Error("expected IsMarkdown")
	}
	if len(res.Pages) != 0 {
		t.Errorf("expected no pages (no page provenance in the response), got %d", len(res.Pages))
	}
	if res.Text != "- Apple\n\n- Banana" {
		t.Errorf("unexpected text: %q", res.Text)
	}
}

func TestRustDocxParserCanParse(t *testing.T) {
	p := &DocxParser{}
	if !p.CanParse(docxMIME, "x.docx") {
		t.Error("expected CanParse for the docx mime type")
	}
	if !p.CanParse("application/octet-stream", "REPORT.DOCX") {
		t.Error("expected CanParse for a .docx suffix (case-insensitive)")
	}
	if p.CanParse("application/pdf", "x.pdf") {
		t.Error("unexpected CanParse for a PDF")
	}
}
