package kbstartpage

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/kbbehavior"
	"github.com/justrag/go-backend/internal/store"
)

const maxBodyBytes = 64 << 10

type pageStore interface {
	Load(ctx context.Context, kbID string) (*StartPage, error)
	Save(ctx context.Context, kbID string, p StartPage) error
}

type behaviorStore interface {
	Load(ctx context.Context, kbID string) (kbbehavior.Settings, error)
}

// Handler serves GET (kbViewChain — every member sees the start page) and
// PUT (kbAdminChain, like the behavior settings) /api/kb/{id}/start-page.
type Handler struct {
	pages    pageStore
	behavior behaviorStore
}

// NewHandler creates a Handler; behavior answers which roles the KB has.
func NewHandler(pages *Store, behavior *kbbehavior.Store) *Handler {
	return &Handler{pages: pages, behavior: behavior}
}

// response is the body of both routes. Configured is false while the KB
// shows the default start page.
type response struct {
	StartPage  StartPage `json:"startPage"`
	Configured bool      `json:"configured"`
}

func kbID(r *http.Request) string {
	if a := kbaccess.AccessFromContext(r.Context()); a != nil && a.KB != nil {
		return a.KB.ID
	}
	return r.PathValue("id")
}

// Get handles GET /api/kb/{id}/start-page.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	h.write(w, r)
}

// Put handles PUT /api/kb/{id}/start-page: replaces the start page with the
// body and answers like Get. Every role entry must name a role the KB has.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var p StartPage
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid request body")
		return
	}
	settings, err := h.behavior.Load(ctx, kbID(r))
	if err != nil {
		h.writeStoreError(w, r, err)
		return
	}
	if err := Validate(p, settings.Behavior.ActiveRoleID, settings.Behavior.HasRole); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": "))
		return
	}
	if err := h.pages.Save(ctx, kbID(r), Normalize(p)); err != nil {
		h.writeStoreError(w, r, err)
		return
	}
	h.write(w, r)
}

func (h *Handler) write(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	stored, err := h.pages.Load(ctx, kbID(r))
	if err != nil {
		h.writeStoreError(w, r, err)
		return
	}
	settings, err := h.behavior.Load(ctx, kbID(r))
	if err != nil {
		h.writeStoreError(w, r, err)
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, response{
		StartPage:  Effective(stored, settings.Behavior.ActiveRoleID, settings.Behavior.HasRole),
		Configured: stored != nil,
	})
}

func (h *Handler) writeStoreError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotFound) {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusNotFound, "knowledge base not found")
		return
	}
	httputil.WriteInternalErrorCtx(r.Context(), w, err)
}
