package kbbehavior

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/store"
)

// TemplatesHandler serves „Vorlagen" › Rollen: the role templates, behind
// adminChain like the catalog categories.
type TemplatesHandler struct {
	store *TemplateStore
	// validateStart checks a template's start (kbstartpage.ValidateTemplateStart:
	// the start's rules live there, and that package imports this one).
	validateStart func(TemplateStart) error
}

// NewTemplatesHandler creates a TemplatesHandler over s; validateStart checks
// a template's start (ErrInvalid-wrapped errors are the client's).
func NewTemplatesHandler(s *TemplateStore, validateStart func(TemplateStart) error) *TemplatesHandler {
	return &TemplatesHandler{store: s, validateStart: validateStart}
}

// List handles GET /api/admin/role-templates.
func (h *TemplatesHandler) List(w http.ResponseWriter, r *http.Request) {
	ts, err := h.store.List(r.Context())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, ts)
}

func (h *TemplatesHandler) decodeTemplate(w http.ResponseWriter, r *http.Request) (TemplateInput, bool) {
	var in TemplateInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return in, false
	}
	err := ValidateTemplate(in)
	if err == nil && in.Start != nil {
		// As stored: a start written in English has its German fallback filled.
		err = h.validateStart(*trimmed(in).Start)
	}
	if err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, trimInvalid(err))
		return in, false
	}
	return in, true
}

// Create handles POST /api/admin/role-templates and answers with the list.
func (h *TemplatesHandler) Create(w http.ResponseWriter, r *http.Request) {
	in, ok := h.decodeTemplate(w, r)
	if !ok {
		return
	}
	if _, err := h.store.Create(r.Context(), in); err != nil {
		h.writeError(w, r, err)
		return
	}
	h.List(w, r)
}

// Update handles PUT /api/admin/role-templates/{roleId} and answers with the list.
func (h *TemplatesHandler) Update(w http.ResponseWriter, r *http.Request) {
	in, ok := h.decodeTemplate(w, r)
	if !ok {
		return
	}
	if err := h.store.Update(r.Context(), r.PathValue("roleId"), in); err != nil {
		h.writeError(w, r, err)
		return
	}
	h.List(w, r)
}

// Delete handles DELETE /api/admin/role-templates/{roleId}: 409 while KBs use it.
func (h *TemplatesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if err := h.store.Delete(r.Context(), r.PathValue("roleId")); err != nil {
		h.writeError(w, r, err)
		return
	}
	h.List(w, r)
}

// Reorder handles PUT /api/admin/role-templates/order {"ids": [...]}.
func (h *TemplatesHandler) Reorder(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.store.Reorder(r.Context(), body.IDs); err != nil {
		h.writeError(w, r, err)
		return
	}
	h.List(w, r)
}

func (h *TemplatesHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	ctx := r.Context()
	switch {
	case errors.Is(err, ErrInvalid):
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, trimInvalid(err))
	case errors.Is(err, ErrTemplateInUse):
		httputil.WriteErrorCtx(ctx, w, http.StatusConflict, "role template is in use; disable it instead")
	case errors.Is(err, store.ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "role template not found")
	default:
		logctx.From(ctx).Error("kbbehavior: role templates", "error", err)
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "internal error")
	}
}

// trimInvalid is a validation error's message without the ErrInvalid prefix
// (this package's or kbstartpage's — both read "invalid …: ").
func trimInvalid(err error) string {
	msg := err.Error()
	if i := strings.Index(msg, ": "); i >= 0 && strings.HasPrefix(msg, "invalid ") {
		return msg[i+2:]
	}
	return msg
}
