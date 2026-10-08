package processor

import (
	"context"
	"testing"

	"github.com/justrag/go-backend/internal/parser"
)

// CachedParseText reads the entry ProcessFile would have written for the same
// (owner, user file) under the same parse configuration.
func TestCachedParseText_HitMissAndGates(t *testing.T) {
	ctx := context.Background()
	cache := NewParseCache(newTestStorage(t), "builtin")
	p := newScreeningProcessor(&mockStore{}, nil)

	if _, ok := p.CachedParseText(ctx, "kb-1", "owner-1", "uf-1", "text/plain", "doc.txt"); ok {
		t.Fatal("no cache wired: want a miss")
	}
	p.SetParseCache(cache)
	if _, ok := p.CachedParseText(ctx, "kb-1", "owner-1", "uf-1", "text/plain", "doc.txt"); ok {
		t.Fatal("empty cache: want a miss")
	}

	key := ParseCacheKey("owner-1", "uf-1", ParseConfigHash(ctx, p.siteConfigReader, "builtin"))
	if err := cache.Put(ctx, key, &parser.ParseResult{Text: "parsed body"}); err != nil {
		t.Fatal(err)
	}
	got, ok := p.CachedParseText(ctx, "kb-1", "owner-1", "uf-1", "text/plain", "doc.txt")
	if !ok || got != "parsed body" {
		t.Fatalf("hit = %q, %v; want the cached text", got, ok)
	}

	for name, args := range map[string][5]string{
		"no owner":     {"kb-1", "", "uf-1", "text/plain", "doc.txt"},
		"no user file": {"kb-1", "owner-1", "", "text/plain", "doc.txt"},
		"spreadsheet":  {"kb-1", "owner-1", "uf-1", "text/csv", "doc.csv"},
	} {
		if _, ok := p.CachedParseText(ctx, args[0], args[1], args[2], args[3], args[4]); ok {
			t.Errorf("%s: want a miss", name)
		}
	}
}

// KGExtractionEnabled resolves through the KB overlay, like RebuildKGForFile.
func TestKGExtractionEnabled_UsesKBOverlay(t *testing.T) {
	p := &Processor{siteConfigReader: fakeReader{vals: map[string]string{"kg_extraction_enabled": "false"}}}
	p.SetKBOverrideLister(fakeLister{overrides: map[string]map[string]*string{
		"kb-on": {"kg_extraction_enabled": ptr("true")},
	}})
	ctx := context.Background()
	if !p.KGExtractionEnabled(ctx, "kb-on") {
		t.Error("kb-on: per-KB override must win")
	}
	if p.KGExtractionEnabled(ctx, "kb-off") {
		t.Error("kb-off: global false must apply")
	}
}

// TextSearchConfig falls back to 'simple' without a main DB (the same
// resolver the ingest path uses).
func TestTextSearchConfig_FallbackWithoutDB(t *testing.T) {
	p := &Processor{}
	if got := p.TextSearchConfig(context.Background(), "kb-1"); got != "simple" {
		t.Errorf("TextSearchConfig = %q, want simple", got)
	}
}
