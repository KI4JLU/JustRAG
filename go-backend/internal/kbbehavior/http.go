package kbbehavior

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/store"
)

// maxBodyBytes bounds a PUT body: 20 roles of 8000 runes at up to 4 bytes
// each, plus rules and JSON overhead, stays well below 1 MiB.
const maxBodyBytes = 1 << 20

// settingsStore is what the handler needs from Store.
type settingsStore interface {
	Load(ctx context.Context, kbID string) (Settings, error)
	Save(ctx context.Context, kbID string, b Behavior) error
}

// Handler serves the behavior settings routes. The {id} routes sit behind
// kbaccess.RequireKBRole: reading on kbViewChain (a viewer sees the role
// names a chat header shows, as GET /api/kb/{id} already showed the
// systemPrompt), writing on kbAdminChain like PATCH /api/kb/{id}'s
// systemPrompt.
type Handler struct {
	store settingsStore
}

// NewHandler creates a Handler over s.
func NewHandler(s *Store) *Handler { return &Handler{store: s} }

// kbID is the KB the access middleware resolved: its canonical id, never the
// raw path value.
func kbID(r *http.Request) string {
	if a := kbaccess.AccessFromContext(r.Context()); a != nil && a.KB != nil {
		return a.KB.ID
	}
	return r.PathValue("id")
}

// Catalog handles GET /api/kb-behavior/catalog?lang=de|en (authentication
// only): the template roles and rule groups, in German unless lang is "en".
func (h *Handler) Catalog(w http.ResponseWriter, r *http.Request) {
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, CatalogFor(Lang(r.URL.Query().Get("lang"))))
}

// Get handles GET /api/kb/{id}/behavior.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	h.writeSettings(w, r)
}

// Put handles PUT /api/kb/{id}/behavior: replaces the KB's behavior with the
// body (the whole Behavior) and answers with the settings as Get does.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var b Behavior
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&b); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := Validate(b); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": "))
		return
	}
	if err := h.store.Save(ctx, kbID(r), b); err != nil {
		h.writeStoreError(w, r, err)
		return
	}
	h.writeSettings(w, r)
}

func (h *Handler) writeSettings(w http.ResponseWriter, r *http.Request) {
	s, err := h.store.Load(r.Context(), kbID(r))
	if err != nil {
		h.writeStoreError(w, r, err)
		return
	}
	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, s)
}

func (h *Handler) writeStoreError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotFound) {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusNotFound, "knowledge base not found")
		return
	}
	httputil.WriteInternalErrorCtx(r.Context(), w, err)
}
