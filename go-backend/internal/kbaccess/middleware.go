package kbaccess

import (
	"context"
	"net/http"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
)

// accessKey is an unexported empty-struct context key used to store
// KBAccessResult. Other packages must use AccessFromContext / WithAccess to
// read or write it; the key itself stays unexported so the accessor is the
// only entry point.
type accessKey struct{}

// KnowledgeBase represents a knowledge base record.
type KnowledgeBase struct {
	ID          string
	UserID      *string
	IsGlobal    bool
	IsPublished bool
	// Sources holds the KB's source-permission flags (migration 0089).
	// CapabilitiesFor is the only reader that turns them into a decision.
	Sources SourcePermissions
}

// SourcePermissions are the per-KB flags a KB admin sets to decide what
// viewers (and editors) may do with the KB's sources. The zero value is the
// most restrictive setting, so a KnowledgeBase built without loading the
// flags fails closed — editors included. The database defaults differ
// (editor_manage_sources is true there); PGStore.GetKBByID always loads them.
type SourcePermissions struct {
	ViewerSeeSources      bool
	ViewerSelectSources   bool
	ViewerDownloadSources bool
	ViewerSeeCitations    bool
	EditorManageSources   bool
}

// KBAccessResult holds the resolved access information for a request.
type KBAccessResult struct {
	KB      *KnowledgeBase
	Role    string
	IsOwner bool
}

// Capabilities resolves the request's source capabilities from the role the
// middleware already resolved and the KB's flags. Nil-safe: a nil result or
// a result without a KB has no capability.
func (a *KBAccessResult) Capabilities() Capabilities {
	if a == nil || a.KB == nil {
		return Capabilities{}
	}
	return CapabilitiesFor(a.KB, a.Role)
}

// KBStore is the data-access interface used by Middleware. Implementations
// can be real database stores or mocks in tests.
type KBStore interface {
	GetKBByID(ctx context.Context, id string) (*KnowledgeBase, error)
	GetKBRole(ctx context.Context, kbID, userID string) (string, error)
}

// Middleware holds the dependencies for KB access checks.
type Middleware struct {
	store KBStore
}

// NewMiddleware creates a Middleware that uses store for KB lookups.
func NewMiddleware(store KBStore) *Middleware {
	return &Middleware{store: store}
}

// EffectiveRole implements the five-rule ladder from the design doc. Ordering
// matters: an explicit membership row (rule 2) beats the implicit roles a
// public KB grants (rules 3 and 4), otherwise an editor on a public KB would
// be demoted to view.
//
//  1. system role superadmin           -> owner
//  2. a row in kb_members               -> that role
//  3. IsGlobal and system role admin    -> admin
//  4. IsGlobal and IsPublished          -> view
//  5. otherwise                         -> "" (403)
//
// This is the single source of truth for resolving a caller's KB role.
// RequireKBRole calls it for the standard middleware chain; packages that
// need a second, handler-internal permission check (internal/files,
// internal/openaicompat, internal/academic) call it directly instead of
// hand-rolling their own owner/IsGlobal/superadmin special-cases — those
// would drift from this ladder.
//
// CapabilitiesFor (below) adds the per-KB source-permission flags on top of
// this function's result; it never re-derives the role.
//
// KEEP IN SYNC WITH VisibleKBsCTE (visible_sql.go), the SQL rendering of this
// ladder that row-filtering queries (internal/globalsearch) use. Change both
// in the same commit; TestVisibilityAgreesWithEffectiveRole in
// internal/globalsearch checks that they agree.
func EffectiveRole(kb *KnowledgeBase, sysRole, memberRole string) string {
	if sysRole == auth.RoleSuperAdmin {
		return RoleOwner
	}
	if Valid(memberRole) {
		return memberRole
	}
	if kb.IsGlobal {
		if sysRole == auth.RoleAdmin {
			return RoleAdmin
		}
		if kb.IsPublished {
			return RoleView
		}
	}
	return ""
}

// Capabilities is what a caller may do with a KB's sources, resolved from
// their effective KB role and the KB's SourcePermissions. The JSON shape is
// the capabilities object on the KB list and detail responses, so the UI
// reads the decision instead of re-deriving the ladder.
type Capabilities struct {
	// SeeSources: read the source lists (files, RSS feeds, Confluence and
	// git sources, crawl status).
	SeeSources bool `json:"seeSources"`
	// SelectSources: restrict a chat or research turn to chosen files.
	SelectSources bool `json:"selectSources"`
	// DownloadSources: download a source file and open the spreadsheet
	// source preview.
	DownloadSources bool `json:"downloadSources"`
	// SeeCitations: see an answer's citations.
	SeeCitations bool `json:"seeCitations"`
	// ManageSources: add, change, sync, delete and retry sources.
	ManageSources bool `json:"manageSources"`
}

// Capability names one field of Capabilities, for the route gates.
type Capability string

// The five source capabilities; the values match the JSON keys.
const (
	CapSeeSources      Capability = "seeSources"
	CapSelectSources   Capability = "selectSources"
	CapDownloadSources Capability = "downloadSources"
	CapSeeCitations    Capability = "seeCitations"
	CapManageSources   Capability = "manageSources"
)

// Has reports whether c is granted. An unknown capability is never granted.
func (c Capabilities) Has(capability Capability) bool {
	switch capability {
	case CapSeeSources:
		return c.SeeSources
	case CapSelectSources:
		return c.SelectSources
	case CapDownloadSources:
		return c.DownloadSources
	case CapSeeCitations:
		return c.SeeCitations
	case CapManageSources:
		return c.ManageSources
	}
	return false
}

// CapabilitiesFor turns a role resolved by EffectiveRole into the caller's
// source capabilities on kb. It takes the resolved role rather than the raw
// inputs on purpose: the role ladder lives in EffectiveRole alone, and this
// adds only the per-KB flags on top of its result.
//
//   - admin, owner: every capability, whatever the flags say. This covers a
//     KB admin (kb_members role admin), the owner, a superadmin (resolves to
//     owner) and a system admin on a public KB (resolves to admin). An
//     api-user system role resolves through the same ladder and has no
//     admin rung of its own, so it never gains admin capability from it.
//   - edit: sees, selects, downloads and sees citations; manages sources
//     only while EditorManageSources is on.
//   - view: each viewer capability follows its flag; never manages sources,
//     whatever the flags say.
//   - anything else (no access): nothing.
//
// Every caller of this function — the route gates (RequireCapability), the
// handler-internal checks in internal/files and internal/academic, the KB
// list and detail responses — goes through here; none restates the table.
//
// KEEP IN SYNC WITH SeeSourcesSQL (visible_sql.go), the SQL rendering of the
// seeSources rule that the header search (internal/globalsearch) filters file
// hits with. Change both in the same commit; TestVisibilityAgreesWithEffectiveRole
// in internal/globalsearch checks that they agree.
func CapabilitiesFor(kb *KnowledgeBase, role string) Capabilities {
	if kb == nil {
		return Capabilities{}
	}
	switch {
	case AtLeast(role, RoleAdmin):
		return Capabilities{
			SeeSources: true, SelectSources: true, DownloadSources: true,
			SeeCitations: true, ManageSources: true,
		}
	case role == RoleEdit:
		return Capabilities{
			SeeSources: true, SelectSources: true, DownloadSources: true,
			SeeCitations: true, ManageSources: kb.Sources.EditorManageSources,
		}
	case role == RoleView:
		return Capabilities{
			SeeSources:      kb.Sources.ViewerSeeSources,
			SelectSources:   kb.Sources.ViewerSelectSources,
			DownloadSources: kb.Sources.ViewerDownloadSources,
			SeeCitations:    kb.Sources.ViewerSeeCitations,
		}
	}
	return Capabilities{}
}

// HasCapability reports whether the KBAccessResult in ctx grants c. False
// when the request carries no access result, so a handler reached without
// RequireKBRole fails closed.
func HasCapability(ctx context.Context, c Capability) bool {
	return AccessFromContext(ctx).Capabilities().Has(c)
}

// RequireKBRole returns middleware that resolves the caller's effective role on
// the KB named by {id} and rejects the request unless it meets required.
// Stores a KBAccessResult in the request context via WithAccess.
func (m *Middleware) RequireKBRole(required string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()

			user := auth.UserFromContext(ctx)
			if user == nil {
				httputil.WriteJSONCtx(ctx, w, http.StatusUnauthorized,
					map[string]string{"error": "Authentication required"})
				return
			}

			kbID := r.PathValue("id")
			kb, err := m.store.GetKBByID(ctx, kbID)
			if err != nil {
				httputil.WriteJSONCtx(ctx, w, http.StatusInternalServerError,
					map[string]string{"error": "Internal Server Error"})
				return
			}
			if kb == nil {
				httputil.WriteJSONCtx(ctx, w, http.StatusNotFound,
					map[string]string{"error": "Knowledge base not found"})
				return
			}

			// Der Store wird auch fuer Superadmins befragt: sie loesen zwar zu
			// owner auf, aber eine vorhandene Zeile soll in KBAccessResult
			// sichtbar bleiben. Ein Query mehr, dafuer keine Sonderfaelle.
			memberRole, err := m.store.GetKBRole(ctx, kbID, user.ID)
			if err != nil {
				httputil.WriteJSONCtx(ctx, w, http.StatusInternalServerError,
					map[string]string{"error": "Internal Server Error"})
				return
			}

			role := EffectiveRole(kb, user.Role, memberRole)
			if !AtLeast(role, required) {
				// 403 und nicht 404: die Existenz der KB ist ueber die
				// bestehenden Endpunkte ohnehin erkennbar, und ein 404 hier
				// wuerde "nicht gefunden" von "kein Zugriff" ununterscheidbar
				// machen — schlecht fuer den Support.
				httputil.WriteJSONCtx(ctx, w, http.StatusForbidden,
					map[string]string{"error": "Insufficient permissions"})
				return
			}

			result := &KBAccessResult{KB: kb, Role: role, IsOwner: role == RoleOwner}
			next.ServeHTTP(w, r.WithContext(WithAccess(ctx, result)))
		})
	}
}

// RequireCapability returns middleware that refuses the request with 403
// unless the KBAccessResult RequireKBRole stored in the context grants c. It
// must run inside RequireKBRole; without an access result in the context it
// refuses with 500, because that is a wiring bug, not a permission question.
func RequireCapability(c Capability) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			access := AccessFromContext(ctx)
			if access == nil {
				httputil.WriteJSONCtx(ctx, w, http.StatusInternalServerError,
					map[string]string{"error": "Internal Server Error"})
				return
			}
			if !access.Capabilities().Has(c) {
				httputil.WriteJSONCtx(ctx, w, http.StatusForbidden,
					map[string]string{"error": "Insufficient permissions"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireKBCapability is RequireKBRole(required) followed by
// RequireCapability(c): the caller needs the KB role AND the capability.
// The role check keeps its 401/404/403 answers; the capability check adds
// a 403 when the KB's flags withhold c from that role.
func (m *Middleware) RequireKBCapability(required string, c Capability) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return m.RequireKBRole(required)(RequireCapability(c)(next))
	}
}

// RequireAnalyticsAccess is a standalone middleware (not a method) that checks:
//   - The user is authenticated.
//   - The KB (from {id} in the path) is global.
//   - The user has role admin or superadmin.
//
// It stores a KBAccessResult in context on success.
func (m *Middleware) RequireAnalyticsAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := auth.UserFromContext(r.Context())
		if user == nil {
			httputil.WriteJSONCtx(r.Context(), w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
			return
		}

		kbID := r.PathValue("id")
		kb, err := m.store.GetKBByID(r.Context(), kbID)
		if err != nil {
			httputil.WriteJSONCtx(r.Context(), w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
			return
		}
		if kb == nil {
			httputil.WriteJSONCtx(r.Context(), w, http.StatusNotFound, map[string]string{"error": "Knowledge base not found"})
			return
		}

		if !kb.IsGlobal {
			httputil.WriteJSONCtx(r.Context(), w, http.StatusForbidden, map[string]string{"error": "Analytics only available for global knowledge bases"})
			return
		}

		if user.Role != auth.RoleAdmin && user.Role != auth.RoleSuperAdmin {
			httputil.WriteJSONCtx(r.Context(), w, http.StatusForbidden, map[string]string{"error": "Insufficient permissions"})
			return
		}

		result := &KBAccessResult{
			KB:      kb,
			IsOwner: isOwner(kb, user.ID),
			Role:    RoleAdmin,
		}
		ctx := WithAccess(r.Context(), result)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// WithAccess returns a derived context that carries the given KBAccessResult.
// Other packages and tests should use this helper instead of constructing the
// key themselves — keeping the key unexported preserves type safety and makes
// the accessor pair (WithAccess / AccessFromContext) the only entry point.
func WithAccess(ctx context.Context, result *KBAccessResult) context.Context {
	return context.WithValue(ctx, accessKey{}, result)
}

// AccessFromContext retrieves the KBAccessResult stored by RequireKBRole
// or RequireAnalyticsAccess. Returns nil if none is present.
func AccessFromContext(ctx context.Context) *KBAccessResult {
	result, _ := ctx.Value(accessKey{}).(*KBAccessResult)
	return result
}

// isOwner returns true when the KB has a non-nil UserID that equals userID.
func isOwner(kb *KnowledgeBase, userID string) bool {
	return kb.UserID != nil && *kb.UserID == userID
}
