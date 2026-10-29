package chat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func postGenerateDescription(t *testing.T, h *Handler) (int, string) {
	t.Helper()
	return postGenerateDescriptionBody(t, h, `{"language":"de"}`)
}

func postGenerateDescriptionBody(t *testing.T, h *Handler, reqBody string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/kb/"+starterTestKB+"/description/generate", strings.NewReader(reqBody))
	req.SetPathValue("id", starterTestKB)
	rr := httptest.NewRecorder()
	h.GenerateDescription(rr, req)
	var body struct {
		Description string `json:"description"`
	}
	if rr.Code == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatalf("body %s: %v", rr.Body.String(), err)
		}
	}
	return rr.Code, body.Description
}

// Oracle: the endpoint's contract in API.md — the model's description comes
// back folded to one line, from the fast-tier model with the documents in the
// prompt, and every call generates anew (nothing is kept server-side).
func TestGenerateDescription_Served(t *testing.T) {
	h, _, model, _ := newStarterTestHandler(t, `{"description": "Der Haushaltsplan 2026.\nIch helfe dir beim Budget."}`)
	code, got := postGenerateDescription(t, h)
	if code != http.StatusOK || got != "Der Haushaltsplan 2026. Ich helfe dir beim Budget." {
		t.Fatalf("got %d %q", code, got)
	}
	if model.models[0] != "fast-model" || !strings.Contains(model.prompts[0], "Budget 2026 Excerpt") {
		t.Errorf("model %q, prompt:\n%s", model.models[0], model.prompts[0])
	}
	postGenerateDescription(t, h)
	if model.callCount() != 2 {
		t.Errorf("%d model calls, want 2 (no cache)", model.callCount())
	}
}

// Oracle: developer ruling 29.10.2026 — the model is handed the title the
// editor shows (unsaved included), else the KB's saved name.
func TestGenerateDescription_Title(t *testing.T) {
	const ok = `{"description": "Plone an der Universität. Beantwortet Fragen zu Seiten."}`
	h, _, model, _ := newStarterTestHandler(t, ok)
	if code, _ := postGenerateDescriptionBody(t, h, `{"language":"de","title":"  Plone   FAQ "}`); code != http.StatusOK {
		t.Fatalf("got %d", code)
	}
	if !strings.Contains(model.prompts[0], "<titel>Plone FAQ</titel>") {
		t.Errorf("prompt lacks the editor's title:\n%s", model.prompts[0])
	}
	postGenerateDescription(t, h)
	if strings.Contains(model.prompts[1], "Plone FAQ") || !strings.Contains(model.prompts[1], "<titel>") {
		t.Errorf("without a title the saved name is used:\n%s", model.prompts[1])
	}
	if code, _ := postGenerateDescriptionBody(t, h, `{"title":"`+strings.Repeat("x", maxDescriptionTitleRunes+1)+`"}`); code != http.StatusBadRequest {
		t.Errorf("over-long title: got %d, want 400", code)
	}
}

// Oracle: the card's validation rules — a link, an over-long text or an
// unparseable answer is no description: 502, never a text to save.
func TestGenerateDescription_UnusableIsBadGateway(t *testing.T) {
	for name, content := range map[string]string{
		"link":     `{"description": "Mehr auf https://example.org."}`,
		"too long": `{"description": "` + strings.Repeat("x", maxAutoDescriptionRunes+1) + `."}`,
		"not json": `kein JSON`,
	} {
		h, _, _, _ := newStarterTestHandler(t, content)
		if code, got := postGenerateDescription(t, h); code != http.StatusBadGateway || got != "" {
			t.Errorf("%s: got %d %q, want 502", name, code, got)
		}
	}
}

// Oracle: hand-counted — a text over the cap keeps its whole sentences that
// fit; one whose first sentence alone is too long is nothing.
func TestFitSentences(t *testing.T) {
	a, b := strings.Repeat("a", 10)+".", strings.Repeat("b", 10)+"!"
	for _, c := range []struct {
		in   string
		max  int
		want string
	}{
		{a + " " + b, 30, a + " " + b},
		{a + " " + b, 15, a},
		{a + " " + b, 5, ""},
		{"Dr. med. " + b, 12, "Dr. med."},
	} {
		if got := fitSentences(c.in, c.max); got != c.want {
			t.Errorf("fitSentences(%q, %d) = %q, want %q", c.in, c.max, got, c.want)
		}
	}
}
