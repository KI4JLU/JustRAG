package splitter

import (
	"log/slog"
	"sync"
	"unicode/utf8"

	"github.com/pkoukk/tiktoken-go"
)

// getTokenizer lazily initializes the shared tiktoken encoder exactly once.
// Returns nil when initialization failed — callers fall back to char-based
// estimation (CountTokens) or "no signal" (EncodeBPE).
var getTokenizer = sync.OnceValue(func() *tiktoken.Tiktoken {
	// Serve the cl100k_base vocab from the embedded copy so initialization
	// never reaches the network (see offline_tokenizer.go). Registered here,
	// inside the Once, so it is in place before EncodingForModel resolves and
	// the SetBpeLoader global write is synchronized with the encoder read.
	tiktoken.SetBpeLoader(&offlineBpeLoader{fallback: tiktoken.NewDefaultBpeLoader()})
	enc, err := tiktoken.EncodingForModel("gpt-4")
	if err != nil {
		slog.Warn("failed to initialize tiktoken tokenizer, falling back to char estimation", "error", err)
		return nil
	}
	return enc
})

// CountTokens returns the token count for text using tiktoken (cl100k_base).
// Falls back to len(text)/4 if the tokenizer is unavailable.
func CountTokens(text string) int {
	if text == "" {
		return 0
	}
	if tok := getTokenizer(); tok != nil {
		return len(tok.Encode(text, nil, nil))
	}
	return utf8.RuneCountInString(text) / 4
}

// EncodeBPE returns the cl100k_base BPE token IDs for text. Empty text
// or an unavailable tokenizer returns nil — callers should treat that
// as "no signal" rather than special-casing. Used by callers that need
// the raw IDs (not just the count): the dynamic-alpha hybrid-search
// heuristic in internal/vector reads the ID distribution to estimate
// query-token rarity (lower IDs ≈ more common tokens in the BPE merge
// order, higher IDs ≈ rarer multilingual / domain-specific tokens).
func EncodeBPE(text string) []int {
	if text == "" {
		return nil
	}
	tok := getTokenizer()
	if tok == nil {
		return nil
	}
	return tok.Encode(text, nil, nil)
}

// TruncateToTokens returns the head of text cut to at most budget cl100k_base
// tokens (head-only: titles, ToC and opening paragraphs carry most of a
// document's context). Text within budget, and budget <= 0, return text
// unchanged. Falls back to budget*4 runes, mirroring CountTokens, if the
// tokenizer is unavailable.
//
// One encode, then the byte length of the first budget tokens: decoding a
// prefix of an ordinary encoding yields exactly that prefix of the input.
// Re-encoding the cut can differ from the original tokens at the cut edge,
// so the result is recounted and cut further while it is still over budget;
// every pass drops at least one token, so the loop ends.
func TruncateToTokens(text string, budget int) string {
	if budget <= 0 || text == "" {
		return text
	}
	tok := getTokenizer()
	if tok == nil {
		return truncateRunes(text, budget*4)
	}
	ids := tok.Encode(text, nil, nil)
	if len(ids) <= budget {
		return text
	}
	for n := budget; n > 0; {
		// n < len(ids), so cut < len(text). A token can end inside a
		// multi-byte rune; cut back to that rune's start.
		cut := len(tok.Decode(ids[:n]))
		for cut > 0 && !utf8.RuneStart(text[cut]) {
			cut--
		}
		head := text[:cut]
		over := CountTokens(head) - budget
		if over <= 0 {
			return head
		}
		n -= over
	}
	return ""
}

// truncateRunes returns the first limit runes of s.
func truncateRunes(s string, limit int) string {
	n := 0
	for i := range s {
		if n == limit {
			return s[:i]
		}
		n++
	}
	return s
}
