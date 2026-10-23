package ai

import "github.com/justrag/go-backend/internal/splitter"

// contextDocTokenBudget is the cl100k_base token budget for the document
// portion of the per-chunk enrichment prompts (contextual prefix, HyPE). The
// document is the cacheable prefix shared across every call for one file, so
// it pays to include as much as the model can comfortably handle while
// keeping the per-call cost bounded.
const contextDocTokenBudget = 8000

// ContextDoc is a source document cut to contextDocTokenBudget, the shared
// prefix of the per-chunk enrichment calls. Build it once per file with
// NewContextDoc and pass the same value to every chunk's call: the cut is
// identical for every chunk, so cutting per call only repeats a tokenization
// of the whole document, and a byte-identical prefix is what lets the
// provider's prompt cache reuse it.
type ContextDoc struct {
	text string
}

// NewContextDoc cuts document to the enrichment budget (head-only).
func NewContextDoc(document string) ContextDoc {
	return ContextDoc{text: splitter.TruncateToTokens(document, contextDocTokenBudget)}
}

// Text returns the cut document.
func (d ContextDoc) Text() string { return d.text }
