package policyaccept

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
)

// VersionKey is the global-only site_config key holding the policy version
// users must accept. Empty or absent: nobody is asked.
const VersionKey = "policy_acceptance_version"

// versionPattern bounds what an admin may store as a version: a short label
// such as a date ("2026-07-13") or "v2". The client echoes it back on accept,
// so it stays free of whitespace and markup.
var versionPattern = regexp.MustCompile(`^[0-9A-Za-z._-]{1,64}$`)

// ValidateVersion is the save-time validator for VersionKey. Empty is valid
// and turns the notice off.
func ValidateVersion(v string) error {
	v = strings.TrimSpace(v)
	if v == "" || versionPattern.MatchString(v) {
		return nil
	}
	return fmt.Errorf("must be at most 64 characters of letters, digits, '.', '_' or '-'")
}

// SiteConfigReader reads one global site_config value.
type SiteConfigReader interface {
	GetSiteConfigValue(ctx context.Context, key string) (*string, error)
}

// Handler serves the caller's own acceptance state. The authenticate
// middleware is the whole gate: every route reads or writes only the
// caller's rows.
type Handler struct {
	store Store
	cfg   SiteConfigReader
}

// NewHandler creates a Handler.
func NewHandler(store Store, cfg SiteConfigReader) *Handler {
	return &Handler{store: store, cfg: cfg}
}

// stateResponse is the body of both routes. Version is the version to
// accept ("" when the notice is off); Required is true while the caller has
// not accepted it; AcceptedAt is when they did.
type stateResponse struct {
	Version    string     `json:"version"`
	Required   bool       `json:"required"`
	AcceptedAt *time.Time `json:"acceptedAt,omitempty"`
}

// normalizeVersion turns a stored VersionKey value into the version to
// accept. A value that fails ValidateVersion (one written past the
// validator) reads as off ("") rather than as a version the client could
// never echo back.
func normalizeVersion(raw *string) string {
	if raw == nil {
		return ""
	}
	v := strings.TrimSpace(*raw)
	if !versionPattern.MatchString(v) {
		return ""
	}
	return v
}

// currentVersion reads VersionKey; "" means the notice is off.
func (h *Handler) currentVersion(ctx context.Context) (string, error) {
	raw, err := h.cfg.GetSiteConfigValue(ctx, VersionKey)
	if err != nil {
		return "", fmt.Errorf("policyaccept: read %s: %w", VersionKey, err)
	}
	return normalizeVersion(raw), nil
}

// Get handles GET /api/user/policy-acceptance.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	version, err := h.currentVersion(ctx)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	if version == "" {
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, stateResponse{})
		return
	}
	at, err := h.store.AcceptedAt(ctx, user.ID, version)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, stateResponse{Version: version, Required: at == nil, AcceptedAt: at})
}

// Accept handles POST /api/user/policy-acceptance with body {"version": "…"}.
// The version must be the current one: a client that showed an older notice
// gets 409 policy_version_changed and has to show the current one first.
// The store checks the version and records the acceptance in one
// transaction, so a version changed mid-request is a 409 too.
func (h *Handler) Accept(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	var body struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if strings.TrimSpace(body.Version) == "" {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "version is required")
		return
	}
	version := body.Version
	at, err := h.store.Accept(ctx, user.ID, version)
	if errors.Is(err, ErrVersionChanged) {
		httputil.WriteCodedErrorCtx(ctx, w, http.StatusConflict, "policy_version_changed",
			"the policy version has changed; reload and accept the current version")
		return
	}
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, stateResponse{Version: version, AcceptedAt: &at})
}
