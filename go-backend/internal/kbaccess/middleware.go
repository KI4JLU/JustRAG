package kbaccess

import (
	"context"
	"fmt"
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
	// Shared: somebody besides the owner is a member (SharedSQL).
	Shared bool
	// Sources holds the KB's source-permission flags (migration 0089).
	// CapabilitiesFor is the only reader that turns them into a decision.
	Sources SourcePermissions
}

// SourcePermissions are the per-KB flags a KB admin sets to decide what
// viewers and editors may do with the KB's sources: the Viewer* flags apply
// to the view role, the Editor* flags to the edit role. There is no viewer
// add flag: adding sources would promote a viewer to an editor, so a viewer
// never adds. The zero value is the most restrictive setting, so a
// KnowledgeBase built without loading the flags fails closed — editors
// included. The database defaults differ (the editor_* columns default to
// true there); PGStore.GetKBByID always loads them.
type SourcePermissions struct {
	ViewerSeeSources      bool
	ViewerPreviewSources  bool
	ViewerDownloadSources bool
	ViewerSeeCitations    bool
	EditorSeeSources      bool
	EditorAddSources      bool
	EditorPreviewSources  bool
	EditorDownloadSources bool
	EditorSeeCitations    bool
}

// KBAccessResult holds the resolved access information for a request.
type KBAccessResult struct {
	KB *KnowledgeBase
	// Role is the role the request is served as: the caller's effective
	// role, or the previewed role when the request previews one.
	Role    string
	IsOwner bool
	// PreviewRole is the role the caller previews (PreviewRoleHeader), ""
	// outside a preview. When set, Role equals it.
	PreviewRole string
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
	role, _ := ResolveRole(kb, sysRole, memberRole)
	return role
}

// Where an effective role comes from, one value per rung of the ladder in
// EffectiveRole. The UI shows it next to the role ("öffentlich",
// "Systemadmin"), so the JSON values are a contract.
const (
	OriginSuperadmin  = "superadmin"
	OriginMember      = "member"
	OriginSystemAdmin = "systemAdmin"
	OriginPublic      = "public"
)

// ResolveRole is EffectiveRole plus the rung that decided it (Origin*
// constants; "" when the caller has no role). EffectiveRole is this
// function's first result — the ladder exists once.
func ResolveRole(kb *KnowledgeBase, sysRole, memberRole string) (role, origin string) {
	if sysRole == auth.RoleSuperAdmin {
		return RoleOwner, OriginSuperadmin
	}
	if Valid(memberRole) {
		return memberRole, OriginMember
	}
	if kb.IsGlobal {
		if sysRole == auth.RoleAdmin {
			return RoleAdmin, OriginSystemAdmin
		}
		if kb.IsPublished {
			return RoleView, OriginPublic
		}
	}
	return "", ""
}

// Capabilities is what a caller may do with a KB's sources, resolved from
// their effective KB role and the KB's SourcePermissions. The JSON shape is
// the capabilities object on the KB list and detail responses, so the UI
// reads the decision instead of re-deriving the ladder.
type Capabilities struct {
	// SeeSources: read the source lists (files, RSS feeds, Confluence and
	// git sources, crawl status).
	SeeSources bool `json:"seeSources"`
	// AddSources: add sources — upload, text, URL, crawl, add from the
	// library, create an RSS feed / Confluence source / git repository,
	// add academic papers, and the agent chat's KB-writing actions. Edit
	// role and above only (a viewer never adds); requires SeeSources.
	AddSources bool `json:"addSources"`
	// PreviewSources: open a source file in the in-app preview (PDF, media,
	// document text, spreadsheet tables) without a download action. Granted
	// by the preview flag or the download flag, and requires SeeSources.
	// Not a protection: the preview hands the file to the browser, where
	// developer tools can save it. It only keeps the download out of the UI.
	PreviewSources bool `json:"previewSources"`
	// DownloadSources: download a source file. Includes PreviewSources.
	// Requires SeeSources.
	DownloadSources bool `json:"downloadSources"`
	// SeeCitations: see an answer's citations.
	SeeCitations bool `json:"seeCitations"`
	// ManageSources: change, sync, poll, delete and retry sources. No flag
	// of its own: edit and above, and (below KB admin) only together with
	// SeeSources. Adding is AddSources.
	ManageSources bool `json:"manageSources"`
}

// Capability names one field of Capabilities, for the route gates.
type Capability string

// The six source capabilities; the values match the JSON keys.
const (
	CapSeeSources      Capability = "seeSources"
	CapAddSources      Capability = "addSources"
	CapPreviewSources  Capability = "previewSources"
	CapDownloadSources Capability = "downloadSources"
	CapSeeCitations    Capability = "seeCitations"
	CapManageSources   Capability = "manageSources"
)

// Has reports whether c is granted. An unknown capability is never granted.
func (c Capabilities) Has(capability Capability) bool {
	switch capability {
	case CapSeeSources:
		return c.SeeSources
	case CapAddSources:
		return c.AddSources
	case CapPreviewSources:
		return c.PreviewSources
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
// The capabilities form a pyramid:
//
//   - level 0, using the KB's sources in a chat: every caller with KB
//     access. Not a capability; restricting a turn to chosen files
//     (selectedFileIds / fileIds) is part of it and not gated either.
//   - level 1, independent of each other: seeSources (the source lists) and
//     seeCitations (an answer's citations).
//   - level 2, each requiring seeSources: previewSources, downloadSources,
//     addSources and manageSources. A flag on level 2 grants nothing while
//     seeSources is off — an editor with editor_add_sources but not
//     editor_see_sources can neither add nor manage. downloadSources
//     includes previewSources: the download flag grants the preview too.
//
// Per role:
//
//   - admin, owner: every capability, whatever the flags say. This covers a
//     KB admin (kb_members role admin), the owner, a superadmin (resolves to
//     owner) and a system admin on a public KB (resolves to admin). An
//     api-user system role resolves through the same ladder and has no
//     admin rung of its own, so it never gains admin capability from it.
//   - edit: seeSources and seeCitations follow their editor_* flags;
//     downloadSources and addSources follow theirs AND seeSources;
//     previewSources is (preview OR download) AND seeSources;
//     manageSources is seeSources (the role grants it, the pyramid
//     requires the list).
//   - view: seeSources, seeCitations, previewSources and downloadSources as
//     for edit with the viewer_* flags; never addSources or manageSources, whatever the
//     flags say (adding or deleting would make the viewer an editor).
//   - anything else (no access): nothing.
//
// Every caller of this function — the route gates (RequireCapability), the
// handler-internal checks in internal/files and internal/academic, the agent
// chat's run scope (adkbridge.Scope.Capabilities), the KB list and detail
// responses — goes through here; none restates the table or the pyramid.
//
// KEEP IN SYNC WITH SeeSourcesSQL (visible_sql.go), the SQL rendering of the
// seeSources rule that the header search (internal/globalsearch) filters file
// hits with. Change both in the same commit; TestVisibilityAgreesWithEffectiveRole
// in internal/globalsearch checks that they agree.
func CapabilitiesFor(kb *KnowledgeBase, role string) Capabilities {
	if kb == nil {
		return Capabilities{}
	}
	var see, add, preview, download, citations bool
	switch {
	case AtLeast(role, RoleAdmin):
		return Capabilities{
			SeeSources: true, AddSources: true, PreviewSources: true, DownloadSources: true,
			SeeCitations: true, ManageSources: true,
		}
	case role == RoleEdit:
		see, add = kb.Sources.EditorSeeSources, kb.Sources.EditorAddSources
		preview, download = kb.Sources.EditorPreviewSources, kb.Sources.EditorDownloadSources
		citations = kb.Sources.EditorSeeCitations
	case role == RoleView:
		see = kb.Sources.ViewerSeeSources
		preview, download = kb.Sources.ViewerPreviewSources, kb.Sources.ViewerDownloadSources
		citations = kb.Sources.ViewerSeeCitations
	default:
		return Capabilities{}
	}
	return Capabilities{
		SeeSources:      see,
		SeeCitations:    citations,
		PreviewSources:  see && (preview || download),
		DownloadSources: see && download,
		AddSources:      see && add && role == RoleEdit,
		ManageSources:   see && role == RoleEdit,
	}
}

// ResolveCapabilities resolves a user's capabilities on kbID for a request
// that does not pass through RequireKBRole for that KB — a chat's stored
// messages (GET /api/chats/{id}/messages is not KB-scoped) or a turn the KB
// router moved to another KB. Same two steps as the middleware:
// EffectiveRole, then CapabilitiesFor; no ladder of its own. A KB that does
// not exist, or one the user has no role on, grants nothing.
func ResolveCapabilities(ctx context.Context, store KBStore, kbID, userID, sysRole string) (Capabilities, error) {
	return ResolvePreviewCapabilities(ctx, store, kbID, userID, sysRole, "")
}

// ResolvePreviewCapabilities is ResolveCapabilities for a chat started in a
// preview ("" for none) (chats.preview_role): the capabilities of the lower
// of the user's current role and the stored preview (StoredPreviewRole), so
// the chat never shows more than it did when it was started, nor more than
// the user holds now. An invalid preview fails closed (no capability).
func ResolvePreviewCapabilities(ctx context.Context, store KBStore, kbID, userID, sysRole, preview string) (Capabilities, error) {
	preview, err := ParsePreviewRole(preview)
	if err != nil {
		return Capabilities{}, err
	}
	kb, err := store.GetKBByID(ctx, kbID)
	if err != nil {
		return Capabilities{}, fmt.Errorf("kbaccess: load kb: %w", err)
	}
	if kb == nil {
		return Capabilities{}, nil
	}
	memberRole, err := store.GetKBRole(ctx, kbID, userID)
	if err != nil {
		return Capabilities{}, fmt.Errorf("kbaccess: load kb role: %w", err)
	}
	return CapabilitiesFor(kb, StoredPreviewRole(EffectiveRole(kb, sysRole, memberRole), preview)), nil
}

// HasCapability reports whether the KBAccessResult in ctx grants c. False
// when the request carries no access result, so a handler reached without
// RequireKBRole fails closed.
func HasCapability(ctx context.Context, c Capability) bool {
	return AccessFromContext(ctx).Capabilities().Has(c)
}

// SharedSQL is KnowledgeBase.Shared over a knowledge_bases row aliased kb:
// a kb_members row other than the owner's. Every reader of the flag selects
// this one expression (PGStore.GetKBByID, the admin KB overview).
const SharedSQL = `EXISTS (SELECT 1 FROM kb_members sm WHERE sm.kb_id = kb.id AND sm.role <> 'owner')`

// SystemAdminMayOperate reports whether a system admin whose kb_members role
// on kb is memberRole ("" for none) may operate its advanced settings (RAG
// settings, agents and teams, evals, workflow): on a global KB, a shared one,
// or their own. Somebody else's private KB nobody shares stays its owner's
// alone — evals read its content. memberRole is the raw row, not the
// effective role, which makes a superadmin the owner of every KB.
func SystemAdminMayOperate(kb *KnowledgeBase, memberRole string) bool {
	return kb.IsGlobal || kb.Shared || memberRole == RoleOwner
}

func isSystemAdmin(role string) bool {
	return role == auth.RoleAdmin || role == auth.RoleSuperAdmin
}

// RequireKBRole returns middleware that resolves the caller's effective role on
// the KB named by {id} and rejects the request unless it meets required.
// Stores a KBAccessResult in the request context via WithAccess.
//
// A request that previews a role (PreviewRoleHeader) is checked against the
// previewed role and may only read: any other method is refused with 403.
// RequireKBUse is the gate for the routes a preview may write through.
func (m *Middleware) RequireKBRole(required string) func(http.Handler) http.Handler {
	return m.resolveKB(false, func(_ string, _ *KnowledgeBase, _, role string) bool {
		return AtLeast(role, required)
	})
}

// RequireKBUse is RequireKBRole(RoleView) for the routes that use a KB rather
// than change it — sending a chat message, generating content, exporting,
// research — and therefore stay open in a preview: the previewing admin asks
// questions as the previewed role, and those create real chats (stored with
// the preview role, see internal/chat). Nothing on such a route may change
// the KB, its settings, or the caller's membership, subscription or filters.
func (m *Middleware) RequireKBUse() func(http.Handler) http.Handler {
	return m.resolveKB(true, func(_ string, _ *KnowledgeBase, _, role string) bool {
		return AtLeast(role, RoleView)
	})
}

// RequireOperableKB admits a system admin (admin, superadmin) to a KB they may
// operate (SystemAdminMayOperate), whatever their KB role, and nobody else:
// kbAdvancedChain. 404 for a missing KB, 403 otherwise; the access result is
// stored as RequireKBRole stores it.
func (m *Middleware) RequireOperableKB() func(http.Handler) http.Handler {
	return m.resolveKB(false, func(sysRole string, kb *KnowledgeBase, memberRole, _ string) bool {
		return isSystemAdmin(sysRole) && SystemAdminMayOperate(kb, memberRole)
	})
}

// RequireKBRoleOrOperable is RequireKBRole(required) that also admits a system
// admin to a KB they may operate (RequireOperableKB).
func (m *Middleware) RequireKBRoleOrOperable(required string) func(http.Handler) http.Handler {
	return m.resolveKB(false, func(sysRole string, kb *KnowledgeBase, memberRole, role string) bool {
		return AtLeast(role, required) || (isSystemAdmin(sysRole) && SystemAdminMayOperate(kb, memberRole))
	})
}

// resolveKB loads the KB named by {id} (404 when missing), resolves the
// caller's effective role and serves next when allow says so (403 otherwise).
// allow sees the caller's raw kb_members role and the effective one.
//
// A request carrying PreviewRoleHeader is resolved as the previewed role:
// 400 for a value that is no previewable role, 403 when the caller may not
// preview (MayPreview), and otherwise allow sees the previewed role as both
// the kb_members role and the effective one, and no system role — so a
// system admin's operate-any-KB pass (RequireOperableKB) does not apply in a
// preview either. Unless previewWrites is set, the preview may only read.
func (m *Middleware) resolveKB(previewWrites bool, allow func(sysRole string, kb *KnowledgeBase, memberRole, role string) bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()

			user := auth.UserFromContext(ctx)
			if user == nil {
				httputil.WriteJSONCtx(ctx, w, http.StatusUnauthorized,
					map[string]string{"error": "Authentication required"})
				return
			}

			// Validated before any lookup, so a malformed header is a 400
			// whatever the KB.
			preview, err := ParsePreviewRole(r.Header.Get(PreviewRoleHeader))
			if err != nil {
				httputil.WriteJSONCtx(ctx, w, http.StatusBadRequest,
					map[string]string{"error": "Invalid preview role"})
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
			sysRole := user.Role
			if preview != "" {
				if !MayPreview(role) {
					httputil.WriteJSONCtx(ctx, w, http.StatusForbidden,
						map[string]string{"error": "Insufficient permissions"})
					return
				}
				if !previewWrites && !previewWriteAllowed(r.Method) {
					httputil.WriteJSONCtx(ctx, w, http.StatusForbidden,
						map[string]string{"error": "Not available in a preview"})
					return
				}
				role = PreviewedRole(role, preview)
				sysRole, memberRole = "", role
			}
			if !allow(sysRole, kb, memberRole, role) {
				// 403 und nicht 404: die Existenz der KB ist ueber die
				// bestehenden Endpunkte ohnehin erkennbar, und ein 404 hier
				// wuerde "nicht gefunden" von "kein Zugriff" ununterscheidbar
				// machen — schlecht fuer den Support.
				httputil.WriteJSONCtx(ctx, w, http.StatusForbidden,
					map[string]string{"error": "Insufficient permissions"})
				return
			}

			result := &KBAccessResult{KB: kb, Role: role, IsOwner: role == RoleOwner, PreviewRole: preview}
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

		// Analytics are a system admin's view, which no previewed role has.
		if r.Header.Get(PreviewRoleHeader) != "" {
			httputil.WriteJSONCtx(r.Context(), w, http.StatusForbidden, map[string]string{"error": "Not available in a preview"})
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
