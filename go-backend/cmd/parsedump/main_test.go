package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMimeForMatchesUploadcheck(t *testing.T) {
	if got := mimeFor("Bericht.DOCX"); got != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		t.Fatalf("docx mime = %q", got)
	}
	if got := mimeFor("x.unknownext"); got != "application/octet-stream" {
		t.Fatalf("unknown mime = %q", got)
	}
}

func TestDumpBuiltinDocx(t *testing.T) {
	f, err := buildFactory("builtin", "")
	if err != nil {
		t.Fatal(err)
	}
	d := dump(context.Background(), f, "builtin", "sample", "../../../test/fixtures/sample.docx")
	if d.Error != nil {
		t.Fatalf("unexpected error: %s", *d.Error)
	}
	if d.Text == "" || d.Parser != "builtin" || d.Doc != "sample" {
		t.Fatalf("bad dump: %+v", d)
	}
}

func TestDumpErrorIsInField(t *testing.T) {
	f, err := buildFactory("builtin", "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "broken.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.4\ntruncated"), 0o600); err != nil {
		t.Fatal(err)
	}
	d := dump(context.Background(), f, "builtin", "broken", path)
	if d.Error == nil || *d.Error == "" {
		t.Fatalf("expected error, got %+v", d)
	}
}

func TestDumpJSONFieldNames(t *testing.T) {
	b, err := json.Marshal(Dump{Pages: []Page{{PageNumber: 1, Text: "x"}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{`"page_number"`, `"is_markdown"`, `"elapsed_ms"`, `"error":null`} {
		if !strings.Contains(string(b), k) {
			t.Fatalf("missing %s in %s", k, b)
		}
	}
}

func TestBuildFactoryRejectsUnknownParser(t *testing.T) {
	if _, err := buildFactory("nope", ""); err == nil {
		t.Fatal("expected error")
	}
	if _, err := buildFactory("docling", ""); err == nil {
		t.Fatal("docling without url must error")
	}
}

func TestDoclingClientUsesProductionDefaults(t *testing.T) {
	c := doclingClient("http://x", "de,en", "accurate")
	o := c.Options
	if o.TableMode != "accurate" || o.DocumentTimeoutSeconds != 600 || strings.Join(o.OCRLanguages, ",") != "de,en" {
		t.Fatalf("options differ from production readDoclingOptions defaults: %+v", o)
	}
	if !c.Async {
		t.Fatal("client must use task endpoints like production")
	}
}

// doclingURL returns a reachable docling-serve base URL or skips the test:
// any HTTP answer (even 404) means the sidecar is up; a connection error
// means it is not. Overridable via DOCLING_URL.
func doclingURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("DOCLING_URL")
	if url == "" {
		url = "http://127.0.0.1:5001"
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Get(url)
	if err != nil {
		t.Skipf("docling not reachable at %s: %v", url, err)
	}
	resp.Body.Close()
	return url
}

// A docling run over a docx with a heading and a table must carry the
// goldset structure field, with the pinned field names. Skips when no
// docling sidecar is reachable.
func TestDumpStructureFieldNames(t *testing.T) {
	url := doclingURL(t)
	f, err := buildFactory("docling", url)
	if err != nil {
		t.Fatal(err)
	}
	d := dump(context.Background(), f, "docling", "structured-sample", "../../../test/fixtures/structured-sample.docx")
	if d.Error != nil {
		t.Fatalf("unexpected error: %s", *d.Error)
	}
	if d.Structure == nil || len(d.Structure.Headings) == 0 || len(d.Structure.Tables) == 0 {
		t.Fatalf("want structure with headings and tables, got %+v", d.Structure)
	}
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{`"structure"`, `"headings"`, `"row_span"`, `"col_span"`, `"num_rows"`} {
		if !strings.Contains(string(b), k) {
			t.Fatalf("missing %s in %s", k, b)
		}
	}
}

// The builtin chain produces no structure, and the field must be absent
// from the dump (not an empty object): goldset treats an absent structure
// as "parser does not produce structure" (n/a), which is what builtin is.
func TestDumpBuiltinOmitsStructure(t *testing.T) {
	f, err := buildFactory("builtin", "")
	if err != nil {
		t.Fatal(err)
	}
	d := dump(context.Background(), f, "builtin", "sample", "../../../test/fixtures/sample.docx")
	if d.Error != nil {
		t.Fatalf("unexpected error: %s", *d.Error)
	}
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), `"structure"`) {
		t.Fatalf("builtin dump must omit structure, got %s", b)
	}
}
