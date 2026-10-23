package splitter

import (
	"strings"
	"testing"
)

func BenchmarkSplitDefault(b *testing.B) {
	// ~10 KB of text, typical document chunk.
	text := strings.Repeat("This is a sample sentence for testing the text splitter. ", 200)
	cfg := DefaultConfig()

	b.ReportAllocs()
	for b.Loop() {
		Split(text, cfg)
	}
}

func BenchmarkSplitMarkdown(b *testing.B) {
	text := strings.Repeat("# Heading\n\nSome paragraph text here.\n\n- Item one\n- Item two\n\n", 200)
	cfg := MarkdownConfig()

	b.ReportAllocs()
	for b.Loop() {
		Split(text, cfg)
	}
}

func BenchmarkSplitLargeDocument(b *testing.B) {
	// ~100 KB — large document.
	text := strings.Repeat("A longer paragraph of text that simulates a real document. ", 2000)
	cfg := DefaultConfig()

	b.ReportAllocs()
	for b.Loop() {
		Split(text, cfg)
	}
}

// BenchmarkTruncateToTokens measures the enrichment-prefix cut on a German
// document of about 36 KB (≈10k tokens), the size that hung the old binary
// search, at the production budget of 8000 tokens.
func BenchmarkTruncateToTokens(b *testing.B) {
	text := strings.Repeat("Qualifikationsrahmen für deutsche Hochschulabschlüsse: Prüfungsordnung, Maßnahmen und Übergänge. ", 360)
	b.ReportAllocs()
	for b.Loop() {
		_ = TruncateToTokens(text, 8000)
	}
}
