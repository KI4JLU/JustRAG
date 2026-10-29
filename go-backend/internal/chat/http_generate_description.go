package chat

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/promptsafety"
)

// maxAutoDescriptionRunes caps a generated description (the prompt asks for
// 180; models overshoot, so a longer text is cut after its last whole
// sentence that fits).
const maxAutoDescriptionRunes = 260

// maxDescriptionTitleRunes caps the request's title (the start page editor
// allows 80).
const maxDescriptionTitleRunes = 200

type generateDescriptionRequest struct {
	Language string `json:"language"`
	// Title is the topic's title as the editor shows it, saved or not; empty
	// = the KB's saved name.
	Title string `json:"title"`
}

type generateDescriptionResponse struct {
	Description string `json:"description"`
}

// GenerateDescription handles POST /api/kb/{id}/description/generate
// ({"language": "de"|"en", "title"?}): a description for the topic's title
// block, written by the fast-tier model from its title (the editor's, else
// the KB's saved name) and one excerpt each of
// its newest documents (the starter questions' input, without the random
// pick). It is a draft for the admin's start page editor — nothing is stored
// here; the dialog's save keeps it as the topic's own description. KB admins
// only, on the generate budget. 409 when the KB has no eligible documents,
// 503 without a model, 502 when the generation failed or produced nothing
// usable.
func (h *Handler) GenerateDescription(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	parsed, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "knowledge base not found")
		return
	}
	kbID := parsed.String()
	var req generateDescriptionRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid request body")
		return
	}
	title := strings.Join(strings.Fields(req.Title), " ")
	if utf8.RuneCountInString(title) > maxDescriptionTitleRunes {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "title is too long")
		return
	}
	if h.aiResolver == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusServiceUnavailable, "no model configured")
		return
	}
	src, err := h.store.StarterContext(ctx, kbID, starterDocLimit)
	if err != nil {
		logctx.From(ctx).Error("chat.generate_description: load documents", "error", err, "kb_id", kbID)
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "failed to load the documents")
		return
	}
	if len(src.Files) == 0 {
		httputil.WriteErrorCtx(ctx, w, http.StatusConflict, "the knowledge base has no documents yet")
		return
	}
	if title == "" {
		title = src.KBName
	}
	docs, _ := h.starterDocs(ctx, kbID, src)
	raw, err := ai.GenerateKBDescription(ctx, h.aiResolver, kbID, ChatModelTierFast(ctx, h.siteConfigReader), title, docs, requestLanguage(req.Language))
	if err != nil {
		if ctx.Err() == nil {
			logctx.From(ctx).Warn("chat.generate_description: generate", "error", err, "kb_id", kbID)
			httputil.WriteErrorCtx(ctx, w, http.StatusBadGateway, "description generation failed")
		}
		return
	}
	d, why := validateAutoDescription(raw)
	if why != "" {
		logctx.From(ctx).Warn("chat.generate_description: unusable text", "runes", utf8.RuneCountInString(raw), "reason", why, "kb_id", kbID)
		httputil.WriteErrorCtx(ctx, w, http.StatusBadGateway, "description generation failed")
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, generateDescriptionResponse{Description: d})
}

// validateAutoDescription keeps a description that is safe to show under a
// title: one paragraph (line breaks folded into spaces), cut to the whole
// sentences that fit in maxAutoDescriptionRunes runes, no links, nothing the
// prompt-injection heuristic flags. why names the rule a refused text broke
// ("" = served).
func validateAutoDescription(raw string) (d, why string) {
	d = fitSentences(strings.Join(strings.Fields(raw), " "), maxAutoDescriptionRunes)
	switch {
	case strings.TrimSpace(raw) == "":
		return "", "empty"
	case d == "":
		return "", "first sentence too long"
	case starterURLRe.MatchString(d):
		return "", "link"
	case promptsafety.LooksLikeInstruction(d):
		return "", "instruction-shaped"
	}
	return d, ""
}

// fitSentences returns the leading whole sentences of s (ended by ".", "!"
// or "?" and a space or the end) that fit in max runes; "" when not even the
// first one does.
func fitSentences(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	end := 0
	runes := []rune(s)
	for i := 0; i < len(runes) && i < max; i++ {
		if strings.ContainsRune(".!?", runes[i]) && (i+1 == len(runes) || runes[i+1] == ' ') {
			end = i + 1
		}
	}
	return string(runes[:end])
}
