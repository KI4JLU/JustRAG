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
}

// NewTemplatesHandler creates a TemplatesHandler over s.
func NewTemplatesHandler(s *TemplateStore) *TemplatesHandler { return &TemplatesHandler{store: s} }

// List handles GET /api/admin/role-templates.
func (h *TemplatesHandler) List(w http.ResponseWriter, r *http.Request) {
	ts, err := h.store.List(r.Context())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, ts)
}

func decodeTemplate(w http.ResponseWriter, r *http.Request) (TemplateInput, bool) {
	var in TemplateInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return in, false
	}
	if err := ValidateTemplate(in); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": "))
		return in, false
	}
	return in, true
}

// Create handles POST /api/admin/role-templates and answers with the list.
func (h *TemplatesHandler) Create(w http.ResponseWriter, r *http.Request) {
	in, ok := decodeTemplate(w, r)
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
	in, ok := decodeTemplate(w, r)
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
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": "))
	case errors.Is(err, ErrTemplateInUse):
		httputil.WriteErrorCtx(ctx, w, http.StatusConflict, "role template is in use; disable it instead")
	case errors.Is(err, store.ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "role template not found")
	default:
		logctx.From(ctx).Error("kbbehavior: role templates", "error", err)
		httputil.WriteErrorCtx(ctx, w, http.StatusInternalServerError, "internal error")
	}
}
