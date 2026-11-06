package siteconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
)

var publicConfigKeys = map[string]bool{
	"confluence_enabled":      true,
	"web_search_enabled":      true,
	"chat_web_search_enabled": true, // per-turn web-search gate: the UI hides its toggle when off
	"academic_search_enabled": true,
	"academic_search_name":    true,
	"git_repo_enabled":        true,
	// Branding: the app name's two parts (logo, window title — before login
	// too), and the names a prompt preview resolves its placeholders to.
	"institution_name": true,
	"system_name":      true,
	"assistant_name":   true,
	// The system notice is shown to every user (system_notice.go).
	"system_notice_enabled":     true,
	"system_notice_title":       true,
	"system_notice_text":        true,
	"system_notice_tone":        true,
	"system_notice_placement":   true,
	"system_notice_dismissible": true,
	"system_notice_link_url":    true,
	"system_notice_link_label":  true,
}

// sensitiveConfigKeys hold secrets that must never be echoed back to a client,
// not even to an admin. GetSiteConfig returns the mask placeholder for any
// non-empty value; UpdateSiteConfig treats an incoming mask as "unchanged" and
// preserves the stored value.
var sensitiveConfigKeys = map[string]bool{
	"google_search_api_key": true,
}

// siteConfigSecretMask is the placeholder substituted for sensitive values in
// API responses. It is also recognised on write as "keep the existing value".
const siteConfigSecretMask = "********"

// KeyValue is a key/value pair used for batch config updates.
// Value is nil when the client sends null (to clear a config key).
type KeyValue struct {
	Key   string
	Value *string
}

// SiteConfigRow is a single row returned from the site_configs table.
type SiteConfigRow struct {
	Key   string
	Value *string
}

// Store is the persistence interface used by the siteconfig handlers.
type Store interface {
	GetAllSiteConfigs(ctx context.Context) ([]SiteConfigRow, error)
	UpdateSiteConfigsBatch(ctx context.Context, configs []KeyValue) ([]SiteConfigRow, error)
}

// The app name keys GetSiteConfig answers with. They are not site_configs
// rows: the values come from the environment (APP_NAME_PREFIX,
// APP_NAME_PRODUCT), and the web app builds its logo and window title from
// them. UpdateSiteConfig ignores them, because the admin dialog posts back the
// whole map it fetched.
const (
	appNamePrefixKey  = "app_name_prefix"
	appNameProductKey = "app_name_product"
)

type Handler struct {
	store          Store
	appNamePrefix  string
	appNameProduct string
}

// Option configures a Handler.
type Option func(*Handler)

// WithAppName sets the app name every GET /api/site-config answer carries.
// Without it the keys are left out and the web app uses its default.
func WithAppName(prefix, product string) Option {
	return func(h *Handler) {
		h.appNamePrefix = prefix
		h.appNameProduct = product
	}
}

func NewHandler(store Store, opts ...Option) *Handler {
	h := &Handler{store: store}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

func (h *Handler) GetSiteConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	rows, err := h.store.GetAllSiteConfigs(ctx)
	if err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "Failed to fetch site config")
		return
	}

	user := auth.UserFromContext(ctx)
	isAdmin := user != nil && (user.Role == "admin" || user.Role == "superadmin")

	result := make(map[string]string)
	for _, row := range rows {
		if row.Value == nil {
			continue
		}
		if !isAdmin && !publicConfigKeys[row.Key] {
			continue
		}
		// Never send a secret to the client — admins included. The admin UI
		// renders the mask and only writes a real value back when changed.
		result[row.Key] = maskForClient(row.Key, *row.Value)
	}
	// Set after the rows, so a stored row of the same name never wins.
	if h.appNamePrefix != "" {
		result[appNamePrefixKey] = h.appNamePrefix
	}
	if h.appNameProduct != "" {
		result[appNameProductKey] = h.appNameProduct
	}

	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, result)
}

// UpdateSiteConfig handles POST /api/site-config.
// Body: {"configs": {"key1": "value1", ...}}
// Requires superadmin (enforced by middleware in main.go).
func (h *Handler) UpdateSiteConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var body struct {
		Configs map[string]any `json:"configs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.Configs == nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "configs is required")
		return
	}

	kvs := make([]KeyValue, 0, len(body.Configs))
	for k, v := range body.Configs {
		if k == appNamePrefixKey || k == appNameProductKey {
			continue // set by the environment, never stored
		}
		if v == nil {
			kvs = append(kvs, KeyValue{Key: k, Value: nil})
			continue
		}
		switch val := v.(type) {
		case string:
			// A sensitive key submitted as the mask means "unchanged" — skip it
			// so we don't overwrite the stored secret with the placeholder.
			if (sensitiveConfigKeys[k] || k == mcpServersKey) && val == siteConfigSecretMask {
				continue
			}
			kvs = append(kvs, KeyValue{Key: k, Value: &val})
		case float64: // JSON numbers decode as float64
			s := fmt.Sprintf("%v", val)
			kvs = append(kvs, KeyValue{Key: k, Value: &s})
		case bool:
			s := fmt.Sprintf("%v", val)
			kvs = append(kvs, KeyValue{Key: k, Value: &s})
		default:
			httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("config value for key %q must be a string, number, boolean, or null", k))
			return
		}
	}

	// Reject batches that would enable both halves of a documented
	// mutually-exclusive flag pair (raptor vs parent-child, Self-RAG vs
	// factuality verifier). Validation needs the merged view, so fetch the
	// current table first; on fetch failure fall through to the save rather
	// than blocking config writes on a read error — the runtime skip logic
	// still guards against the incoherent combinations.
	existing, existingErr := h.store.GetAllSiteConfigs(ctx)
	existingMap := make(map[string]*string, len(existing))
	for _, row := range existing {
		existingMap[row.Key] = row.Value
	}

	// Put the stored MCP server credentials back wherever the client sent
	// their mask. This one cannot fall through on a read error: writing the
	// mask would replace every token with "********".
	for i, kv := range kvs {
		if kv.Key != mcpServersKey || kv.Value == nil || !strings.Contains(*kv.Value, siteConfigSecretMask) {
			continue
		}
		if existingErr != nil {
			httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "Failed to update site config")
			return
		}
		stored := ""
		if v := existingMap[mcpServersKey]; v != nil {
			stored = *v
		}
		restored, err := restoreMaskedMCPHeaders(*kv.Value, stored)
		if err != nil {
			httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, err.Error())
			return
		}
		kvs[i].Value = &restored
	}

	if existingErr == nil {
		if err := ValidateConflicts(existingMap, kvs); err != nil {
			httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, httputil.SanitizeError(err))
			return
		}
	}

	// Reject a batch whose value for a validated GLOBAL-ONLY JSON key does not
	// parse (W6-R14). Unconditional — unlike the conflict check above, each
	// value is self-contained and needs no view of the existing table, so a
	// store read error can never let a broken policy through.
	if err := ValidateGlobalValues(kvs); err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, httputil.SanitizeError(err))
		return
	}

	rows, err := h.store.UpdateSiteConfigsBatch(ctx, kvs)
	if err != nil {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusInternalServerError, "Failed to update site config")
		return
	}

	result := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.Value != nil {
			result[row.Key] = maskForClient(row.Key, *row.Value)
		}
	}

	httputil.WriteJSONCtx(r.Context(), w, http.StatusOK, result)
}
