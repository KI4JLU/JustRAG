package ai

import (
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/splitter"
)

// TestNewContextDoc checks the enrichment prefix against the token budget,
// with splitter.CountTokens as the oracle.
func TestNewContextDoc(t *testing.T) {
	short := "Qualifikationsrahmen für deutsche Hochschulabschlüsse"
	if got := NewContextDoc(short).Text(); got != short {
		t.Errorf("short document: got %q, want it unchanged", got)
	}

	long := strings.Repeat("Prüfungsordnung für Hochschulabschlüsse und Übergänge. ", 2000)
	got := NewContextDoc(long).Text()
	if !strings.HasPrefix(long, got) {
		t.Fatal("long document: result is not a prefix of the input")
	}
	if n := splitter.CountTokens(got); n > contextDocTokenBudget || n < contextDocTokenBudget-3 {
		t.Errorf("long document: result has %d tokens, want just under %d", n, contextDocTokenBudget)
	}
}
