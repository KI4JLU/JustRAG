package kbbehavior

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
)

// MaxRoleWriterInputRunes caps a description or a revise instruction.
const MaxRoleWriterInputRunes = 500

// MaxRoleWriterTopicRunes caps generate's topic, the KB's name (as long as
// PATCH /api/kb/{id} lets a name be).
const MaxRoleWriterTopicRunes = 255

// RoleWriterHandler is the role edit screen's AI help: it writes a role from a
// description, revises a role prompt by an instruction, or describes a role. Nothing is stored;
// the client puts the result into its draft.
type RoleWriterHandler struct {
	resolver *ai.ConfigResolver
	// model picks the model per request ("" = the KB's chat model): the
	// fast tier, since a reasoning chat model spends most of a call thinking.
	model func(context.Context) string
}

// NewRoleWriterHandler wires the handler to the AI config resolver; model may be nil.
func NewRoleWriterHandler(resolver *ai.ConfigResolver, model func(context.Context) string) *RoleWriterHandler {
	if model == nil {
		model = func(context.Context) string { return "" }
	}
	return &RoleWriterHandler{resolver: resolver, model: model}
}

type generateRoleRequest struct {
	Description string `json:"description"`
	Topic       string `json:"topic"`
	Language    string `json:"language"`
}

type reviseRoleRequest struct {
	Prompt      string `json:"prompt"`
	Instruction string `json:"instruction"`
	Language    string `json:"language"`
}

func decodeRoleWriter(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return false
	}
	return true
}

// Generate handles POST /api/kb/{id}/behavior/role-writer/generate:
// {description, topic?, language} → {name, prompt}.
func (h *RoleWriterHandler) Generate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req generateRoleRequest
	if !decodeRoleWriter(w, r, &req) {
		return
	}
	desc := strings.TrimSpace(req.Description)
	if desc == "" || utf8.RuneCountInString(desc) > MaxRoleWriterInputRunes {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "description must be 1 to 500 characters")
		return
	}
	if utf8.RuneCountInString(req.Topic) > MaxRoleWriterTopicRunes {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "topic must not exceed 255 characters")
		return
	}
	draft, err := ai.GenerateRolePrompt(ctx, h.resolver, kbID(r), h.model(ctx), req.Topic, desc, Lang(req.Language))
	if err != nil {
		logctx.From(ctx).Warn("kbbehavior: role generation failed", "error", err)
		httputil.WriteErrorCtx(ctx, w, http.StatusBadGateway, "role generation failed")
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, RoleDraftResponse{
		Name:   clipRunes(draft.Name, MaxRoleNameRunes),
		Prompt: clipRunes(draft.Prompt, MaxPromptRunes),
	})
}

// Revise handles POST /api/kb/{id}/behavior/role-writer/revise:
// {prompt, instruction, language} → {prompt}.
func (h *RoleWriterHandler) Revise(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req reviseRoleRequest
	if !decodeRoleWriter(w, r, &req) {
		return
	}
	instruction := strings.TrimSpace(req.Instruction)
	switch {
	case strings.TrimSpace(req.Prompt) == "" || utf8.RuneCountInString(req.Prompt) > MaxPromptRunes:
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "prompt must be 1 to 8000 characters")
		return
	case instruction == "" || utf8.RuneCountInString(instruction) > MaxRoleWriterInputRunes:
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "instruction must be 1 to 500 characters")
		return
	}
	prompt, err := ai.ReviseRolePrompt(ctx, h.resolver, kbID(r), h.model(ctx), req.Prompt, instruction, Lang(req.Language))
	if err != nil {
		logctx.From(ctx).Warn("kbbehavior: role revision failed", "error", err)
		httputil.WriteErrorCtx(ctx, w, http.StatusBadGateway, "role revision failed")
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, RoleDraftResponse{Prompt: clipRunes(prompt, MaxPromptRunes)})
}

type describeRoleRequest struct {
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
	Language string `json:"language"`
}

// Describe handles POST /api/kb/{id}/behavior/role-writer/describe:
// {name?, prompt, language} → {description}, at most MaxRoleDescRunes.
func (h *RoleWriterHandler) Describe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req describeRoleRequest
	if !decodeRoleWriter(w, r, &req) {
		return
	}
	switch {
	case strings.TrimSpace(req.Prompt) == "" || utf8.RuneCountInString(req.Prompt) > MaxPromptRunes:
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "prompt must be 1 to 8000 characters")
		return
	case utf8.RuneCountInString(req.Name) > MaxRoleNameRunes:
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "name is too long")
		return
	}
	desc, err := ai.DescribeRole(ctx, h.resolver, kbID(r), h.model(ctx), req.Name, req.Prompt, Lang(req.Language))
	if err != nil {
		logctx.From(ctx).Warn("kbbehavior: role description failed", "error", err)
		httputil.WriteErrorCtx(ctx, w, http.StatusBadGateway, "role description failed")
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, RoleDescriptionResponse{Description: clipRunes(desc, MaxRoleDescRunes)})
}

// RoleDescriptionResponse is the body of the describe endpoint.
type RoleDescriptionResponse struct {
	Description string `json:"description"`
}

// RoleDraftResponse is the body of both role writer endpoints; Revise leaves Name empty.
type RoleDraftResponse struct {
	Name   string `json:"name,omitempty"`
	Prompt string `json:"prompt"`
}

func clipRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
