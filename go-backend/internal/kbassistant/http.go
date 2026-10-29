package kbassistant

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/store"
)

const maxBodyBytes = 1 << 20

type settingsStore interface {
	Get(ctx context.Context, kbID string, canRename bool) (Settings, error)
	Save(ctx context.Context, kbID string, in Input, author Author) (Settings, error)
	Restore(ctx context.Context, kbID string, n, baseVersion int, author Author) (Settings, error)
	Versions(ctx context.Context, kbID string) ([]Version, error)
}

// Handler serves /api/kb/{id}/assistant-settings — all routes on kbAdminChain,
// the gate of the settings dialog. Renaming keeps its stricter rule
// (kbaccess.CanRename) through the title.
type Handler struct {
	store settingsStore
}

// NewHandler creates a Handler over s.
func NewHandler(s *Store) *Handler { return &Handler{store: s} }

func kbID(r *http.Request) string {
	if a := kbaccess.AccessFromContext(r.Context()); a != nil && a.KB != nil {
		return a.KB.ID
	}
	return r.PathValue("id")
}

func author(r *http.Request) (Author, bool) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		return Author{}, false
	}
	return Author{ID: user.ID, CanRename: kbaccess.CanRename(kbaccess.AccessFromContext(r.Context()), user.Role)}, true
}

// Get handles GET /api/kb/{id}/assistant-settings.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	a, ok := author(r)
	if !ok {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusUnauthorized, "authentication required")
		return
	}
	s, err := h.store.Get(r.Context(), kbID(r), a.CanRename)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, s)
}

// Put handles PUT /api/kb/{id}/assistant-settings: saves the whole settings
// in one transaction and writes one version.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	a, ok := author(r)
	if !ok {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	var in Input
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid request body")
		return
	}
	if in.CategoryID != nil {
		id, err := uuid.Parse(*in.CategoryID)
		if err != nil {
			httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "unknown category")
			return
		}
		canonical := id.String()
		in.CategoryID = &canonical
	}
	s, err := h.store.Save(ctx, kbID(r), in, a)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, s)
}

// Versions handles GET /api/kb/{id}/assistant-settings/versions.
func (h *Handler) Versions(w http.ResponseWriter, r *http.Request) {
	v, err := h.store.Versions(r.Context(), kbID(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, map[string]any{"versions": v})
}

type restoreRequest struct {
	BaseVersion int `json:"baseVersion"`
}

// Restore handles POST /api/kb/{id}/assistant-settings/versions/{n}/restore.
func (h *Handler) Restore(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	a, ok := author(r)
	if !ok {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "version not found")
		return
	}
	var body restoreRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid request body")
		return
	}
	s, err := h.store.Restore(ctx, kbID(r), n, body.BaseVersion, a)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, s)
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	ctx := r.Context()
	switch {
	case errors.Is(err, store.ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrConflict):
		httputil.WriteJSONCtx(ctx, w, http.StatusConflict, map[string]string{
			"error": "the settings were changed meanwhile; reload them", "code": "settings_conflict",
		})
	case errors.Is(err, ErrRenameForbidden):
		httputil.WriteErrorCtx(ctx, w, http.StatusForbidden, "only the owner may rename a knowledge base")
	case errors.Is(err, ErrNotRestorable):
		httputil.WriteJSONCtx(ctx, w, http.StatusConflict, map[string]string{
			"error": "this version can no longer be restored", "code": "version_not_restorable",
		})
	case errors.Is(err, ErrInvalid):
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": "))
	default:
		httputil.WriteInternalErrorCtx(ctx, w, err)
	}
}
