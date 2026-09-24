package chat_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/chat"
)

func TestRAGSystemPrompt_LanguageAndDedent(t *testing.T) {
	h := chat.NewHandler(&mockStore{}, nil, nil)
	for _, tc := range []struct{ query, lang, opening string }{
		{"?lang=de", "de", "Du bist JustRAG"},
		{"?lang=en", "en", "You are JustRAG"},
		{"", "en", "You are JustRAG"},
		{"?lang=fr", "en", "You are JustRAG"},
	} {
		rr := httptest.NewRecorder()
		h.RAGSystemPrompt(rr, httptest.NewRequest(http.MethodGet, "/api/chat/rag-system-prompt"+tc.query, nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("%q: expected 200, got %d", tc.query, rr.Code)
		}
		var body struct{ Language, Prompt string }
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Language != tc.lang || !strings.HasPrefix(body.Prompt, tc.opening) {
			t.Fatalf("%q: got lang %q, prompt starts %q", tc.query, body.Language, body.Prompt[:20])
		}
		// Oracle: the literal indents its numbered rule lines ("    1.") by four
		// spaces; after dedent they start the line. Sub-items stay nested.
		if regexp.MustCompile(`(?m)^ +\d+[a-z]?\. `).MatchString(body.Prompt) {
			t.Fatalf("%q: a numbered rule keeps its source indentation", tc.query)
		}
		if !regexp.MustCompile(`(?m)^1\. `).MatchString(body.Prompt) {
			t.Fatalf("%q: rule 1 not at line start", tc.query)
		}
	}
}
