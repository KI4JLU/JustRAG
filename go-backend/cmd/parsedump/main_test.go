package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
