//go:build integration

package rustparser

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/parser"
	"github.com/justrag/go-backend/internal/parser/docling"
)

// TestIntegration_RealFpServer runs against a live fp-server:
//
//	RUSTPARSER_TEST_URL=http://localhost:5001 go test -tags integration ./internal/parser/rustparser/
//
// test/fixtures/sample.docx is a small two-item list ("Apple", "Banana")
// with no headings, so the known-content assertion is on those items.
func TestIntegration_RealFpServer(t *testing.T) {
	baseURL := os.Getenv("RUSTPARSER_TEST_URL")
	if baseURL == "" {
		t.Skip("set RUSTPARSER_TEST_URL to run against a live fp-server")
	}

	c := docling.NewClient(baseURL, 180*time.Second)
	c.Async = true // what the worker uses
	p := &DocxParser{Client: c}
	res, err := p.Parse(context.Background(), parser.ParseContext{
		FilePath: "../../../../test/fixtures/sample.docx",
		FileName: "sample.docx",
		MimeType: docxMIME,
	})
	if err != nil {
		t.Fatalf("parse against live fp-server: %v", err)
	}
	if !res.IsMarkdown {
		t.Error("expected IsMarkdown")
	}
	if strings.TrimSpace(res.Text) == "" {
		t.Error("expected non-empty text")
	}
	for _, want := range []string{"Apple", "Banana"} {
		if !strings.Contains(res.Text, want) {
			t.Errorf("text missing %q; got:\n%s", want, res.Text)
		}
	}
}
