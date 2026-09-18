package kbfilters

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// maxCategoryNameLen mirrors kb_user_categories.name varchar(100). Checked
// here so an over-long chip label is a 400 rather than a 500 from SQLSTATE
// 22001.
const maxCategoryNameLen = 100

// Handler serves the per-user filter endpoints.
//
// Two access shapes, both authentication-only as far as a KB ROLE is
// concerned:
//
//   - The /api/kb-user-categories routes carry no KB in the path at all. They
//     touch only rows the caller owns, so the authenticate middleware is the
//     whole gate (same pattern as GET /api/kb and GET /api/kb/catalog).
//   - The /api/kb/{id}/... routes sit on kbViewChain. Starring or tagging is
//     not a privilege — but it must not become a way to confirm that a KB
//     exists that the caller cannot see, so the existing view chain is reused
//     rather than a second visibility rule invented here.
type Handler struct {
	store Store
}

// NewHandler creates a Handler over store.
func NewHandler(store Store) *Handler {
	return &Handler{store: store}
}

type categoryRequest struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
}

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

// AddFavourite handles PUT /api/kb/{id}/favourite.
func (h *Handler) AddFavourite(w http.ResponseWriter, r *http.Request) {
	h.setFavourite(w, r, true)
}

// RemoveFavourite handles DELETE /api/kb/{id}/favourite.
func (h *Handler) RemoveFavourite(w http.ResponseWriter, r *http.Request) {
	h.setFavourite(w, r, false)
}

func (h *Handler) setFavourite(w http.ResponseWriter, r *http.Request, on bool) {
	ctx := r.Context()

	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	// The KB id is taken from the access result rather than the path value:
	// that is the row kbViewChain actually resolved and authorised, so the two
	// can never drift apart.
	access := kbaccess.AccessFromContext(ctx)
	if access == nil || access.KB == nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("kbfilters: missing KB access result"))
		return
	}

	var err error
	if on {
		err = h.store.AddFavourite(ctx, user.ID, access.KB.ID)
	} else {
		err = h.store.RemoveFavourite(ctx, user.ID, access.KB.ID)
	}
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to update favourite: %w", err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// User categories
// ---------------------------------------------------------------------------

// ListCategories handles GET /api/kb-user-categories.
func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}

	cats, err := h.store.ListCategories(ctx, user.ID)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to list categories: %w", err))
		return
	}
	// [] rather than null: the chip row maps over the response directly.
	if cats == nil {
		cats = []UserCategory{}
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, cats)
}

// CreateCategory handles POST /api/kb-user-categories.
func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	body, ok := decodeCategoryRequest(w, r)
	if !ok {
		return
	}

	cat, err := h.store.CreateCategory(ctx, user.ID, body.Name, body.SortOrder)
	switch {
	case errors.Is(err, ErrDuplicateName):
		httputil.WriteErrorCtx(ctx, w, http.StatusConflict, "a category with that name already exists")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to create category: %w", err))
	default:
		httputil.WriteJSONCtx(ctx, w, http.StatusCreated, cat)
	}
}

// UpdateCategory handles PATCH /api/kb-user-categories/{catId}. Name and
// sortOrder are both replaced; there is no field-level patching, because the
// only editor is a two-field rename dialog.
func (h *Handler) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	catID, ok := pathUUID(w, r, "catId")
	if !ok {
		return
	}
	body, ok := decodeCategoryRequest(w, r)
	if !ok {
		return
	}

	cat, err := h.store.UpdateCategory(ctx, user.ID, catID, body.Name, body.SortOrder)
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "category not found")
	case errors.Is(err, ErrDuplicateName):
		httputil.WriteErrorCtx(ctx, w, http.StatusConflict, "a category with that name already exists")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to update category: %w", err))
	default:
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, cat)
	}
}

// DeleteCategory handles DELETE /api/kb-user-categories/{catId}.
func (h *Handler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	catID, ok := pathUUID(w, r, "catId")
	if !ok {
		return
	}

	err := h.store.DeleteCategory(ctx, user.ID, catID)
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "category not found")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to delete category: %w", err))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

// AssignCategory handles PUT /api/kb/{id}/user-categories/{catId}.
func (h *Handler) AssignCategory(w http.ResponseWriter, r *http.Request) {
	h.setAssignment(w, r, true)
}

// UnassignCategory handles DELETE /api/kb/{id}/user-categories/{catId}.
func (h *Handler) UnassignCategory(w http.ResponseWriter, r *http.Request) {
	h.setAssignment(w, r, false)
}

func (h *Handler) setAssignment(w http.ResponseWriter, r *http.Request, on bool) {
	ctx := r.Context()

	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	access := kbaccess.AccessFromContext(ctx)
	if access == nil || access.KB == nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("kbfilters: missing KB access result"))
		return
	}
	catID, ok := pathUUID(w, r, "catId")
	if !ok {
		return
	}

	var err error
	if on {
		err = h.store.AssignCategory(ctx, user.ID, catID, access.KB.ID)
	} else {
		err = h.store.UnassignCategory(ctx, user.ID, catID, access.KB.ID)
	}
	switch {
	case errors.Is(err, ErrNotFound):
		// Raised by the composite FK when the category is somebody else's.
		// Same 404 as a genuinely missing id, on purpose.
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "category not found")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to update category assignment: %w", err))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// decodeCategoryRequest parses and validates the shared create/update body,
// writing the 400 itself and reporting whether the caller may continue.
func decodeCategoryRequest(w http.ResponseWriter, r *http.Request) (categoryRequest, bool) {
	ctx := r.Context()

	var body categoryRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid request body")
		return body, false
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "name is required")
		return body, false
	}
	if utf8.RuneCountInString(body.Name) > maxCategoryNameLen {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "name is too long")
		return body, false
	}
	return body, true
}

// pathUUID reads a path parameter and rejects anything that is not a UUID.
// Without this the malformed value would reach `$1::uuid` and surface as a
// 500; a bad id in the path is a client error, and for these routes it is
// indistinguishable from an id that does not exist.
func pathUUID(w http.ResponseWriter, r *http.Request, name string) (string, bool) {
	raw := r.PathValue(name)
	if _, err := uuid.Parse(raw); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusNotFound, "category not found")
		return "", false
	}
	return raw, true
}
