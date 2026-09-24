package chat_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/chat"
	"github.com/justrag/go-backend/internal/prompts"
)

// Oracle: without the store capability (or a model) the endpoint must answer
// an empty list, never an error — the client then keeps its configured prompts.
func TestStarterQuestions_EmptyWithoutCapability(t *testing.T) {
	h := chat.NewHandler(&mockStore{}, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/kb/kb1/starter-questions?lang=de", nil)
	req.SetPathValue("id", "kb1")
	rr := httptest.NewRecorder()
	h.StarterQuestions(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var body struct{ Questions []string }
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body.Questions == nil || len(body.Questions) != 0 {
		t.Fatalf("expected an empty questions array, got %s", rr.Body.String())
	}
}

// Oracle: the literal names and excerpts handed in must reach the prompt.
func TestStarterQuestionsUser_CarriesDocuments(t *testing.T) {
	p := prompts.StarterQuestionsUser("Haushalt", []prompts.StarterDoc{{Name: "plan.pdf", Excerpt: "Budget 2026"}}, 6)
	for _, want := range []string{"Haushalt", `name="plan.pdf"`, "Budget 2026", "Suggest 6"} {
		if !strings.Contains(p, want) {
			t.Fatalf("prompt lacks %q:\n%s", want, p)
		}
	}
}
