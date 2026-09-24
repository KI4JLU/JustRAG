package chat

import (
	"net/http"
	"strings"

	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/prompts"
)

// ragSystemPromptResponse is the body of GET /api/chat/rag-system-prompt.
type ragSystemPromptResponse struct {
	Language string `json:"language"`
	Prompt   string `json:"prompt"`
}

// RAGSystemPrompt handles GET /api/chat/rag-system-prompt?lang=de|en: the
// fixed answer instructions (prompts.ChatSystemPrompt) that every chat turn
// appends after the KB's own system prompt. Read-only; shown in the system
// prompt panel so KB owners see what their prompt is combined with. The
// per-turn date line and low-confidence notice are not included.
func (h *Handler) RAGSystemPrompt(w http.ResponseWriter, r *http.Request) {
	lang := "en"
	if r.URL.Query().Get("lang") == "de" {
		lang = "de"
	}
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, ragSystemPromptResponse{
		Language: lang,
		Prompt:   dedentPrompt(prompts.ChatSystemPrompt(lang)),
	})
}

// dedentPrompt removes the source-code indentation the prompt literal carries
// (lines after the first are indented by four spaces), keeping deeper nesting.
func dedentPrompt(s string) string {
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimPrefix(l, "    ")
	}
	return strings.Join(lines, "\n")
}
