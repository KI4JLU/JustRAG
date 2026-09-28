package search

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
)

// Handler serves GET /api/search.
//
// Authentication only, like GET /api/kb and GET /api/kb/catalog: there is no
// KB in the path for a role middleware to gate on. Visibility is enforced in
// the store's SQL (visibleKBsCTE), per row, for every group — including the
// optional kb_id scope, which answers 404 rather than 403 when the caller
// cannot see that topic, so the route cannot confirm that a hidden topic
// exists (the favourites routes in internal/kbfilters reason the same way).
type Handler struct {
	store Store
}

// NewHandler creates a Handler over store.
func NewHandler(store Store) *Handler {
	return &Handler{store: store}
}

// Search handles GET /api/search?q=<text>[&kb_id=<uuid>][&limit=<n>].
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}

	params := r.URL.Query()

	text := strings.TrimSpace(params.Get("q"))
	switch n := utf8.RuneCountInString(text); {
	case n < MinQueryLen:
		// Never a full listing: an empty or one-character query is a client
		// error, not "match everything".
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest,
			fmt.Sprintf("q must be at least %d characters", MinQueryLen))
		return
	case n > MaxQueryLen:
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest,
			fmt.Sprintf("q must be at most %d characters", MaxQueryLen))
		return
	}

	limit := DefaultLimit
	if raw := params.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		// Above the cap is clamped, not rejected: asking for "as many as you
		// allow" is a reasonable request, and the cap is the answer to it.
		limit = min(n, MaxLimit)
	}

	var kbID string
	if raw := params.Get("kb_id"); raw != "" {
		// A malformed id would otherwise reach $3::uuid and surface as a 500.
		// It is answered exactly like an id that does not exist.
		parsed, err := uuid.Parse(raw)
		if err != nil {
			httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "knowledge base not found")
			return
		}
		// Canonical form: uuid.Parse also accepts urn:uuid: and braced
		// spellings, which Postgres' uuid input does not all accept.
		kbID = parsed.String()
	}

	resp, err := h.store.Search(ctx, Caller{UserID: user.ID, SysRole: user.Role},
		Query{Text: text, KBID: kbID, Limit: limit})
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "knowledge base not found")
		return
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to search: %w", err))
		return
	}

	// [] rather than null: the dropdown maps over each group directly.
	if resp.Topics == nil {
		resp.Topics = []TopicHit{}
	}
	if resp.Sources == nil {
		resp.Sources = []SourceHit{}
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, resp)
}
