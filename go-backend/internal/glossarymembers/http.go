// HTTP layer for glossary sharing. Routes are registered in
// internal/app/routes.go, behind the translation permission and, per route,
// the glossary role gate (glossaryaccess.RequireGlossaryRole):
//
//	GET    /api/glossaries/{id}/members                      admin
//	PUT    /api/glossaries/{id}/members/{userId}             admin
//	DELETE /api/glossaries/{id}/members/{userId}             admin
//	POST   /api/glossaries/{id}/members/bulk                 admin
//	DELETE /api/glossaries/{id}/members/pending/{username}   admin
//	GET    /api/glossaries/{id}/invite-links                 admin
//	POST   /api/glossaries/{id}/invite-links                 admin
//	DELETE /api/glossaries/{id}/invite-links/{linkId}        admin
//	GET    /api/glossary-invites/{token}                     authenticated only + rate limit
//	POST   /api/glossary-invites/{token}/redeem              authenticated only + rate limit
//	POST   /api/glossaries/{id}/transfer-owner               viewer gate + owner check here
//	DELETE /api/glossaries/{id}/membership                   viewer gate (self)
//
// The member list sits behind admin, not viewer: on a global glossary every
// user resolves to viewer, and the roster is not theirs to read. The two
// token routes are not glossary-gated, because the caller has no role yet.
// Joining is POST-only so link previews in mail and chat clients cannot
// trigger a join by fetching the URL.
package glossarymembers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/glossaryaccess"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kbinvites"
)

// MaxBulkUsernames caps one bulk-add request, like kbmembers.
const MaxBulkUsernames = 500

// MaxLabelLen caps the human-readable link label, in runes.
const MaxLabelLen = 100

// MaxJSONBodyBytes caps the JSON body of every sharing route. The server's
// global request cap is the same 1 MiB; the handlers bound their own reads so
// they stay safe when mounted without it.
const MaxJSONBodyBytes = 1 << 20

const assignableMsg = `role must be "viewer", "editor" or "admin": ownership moves only via transfer`

// glossaryID is the glossary the request is about, as the gate parsed it:
// never the raw path value (a "urn:uuid:…" form passes uuid.Parse and would
// reach the database unparsed). ok is false for a request that did not pass
// RequireGlossaryRole, which is a wiring bug.
func glossaryID(r *http.Request) (string, bool) {
	a := glossaryaccess.AccessFromContext(r.Context())
	if a == nil || a.Glossary == nil {
		return "", false
	}
	return a.Glossary.ID, true
}

// uuidParam parses the path value name and returns its canonical form.
func uuidParam(r *http.Request, name string) (string, bool) { return uuidParamValue(r.PathValue(name)) }

func uuidParamValue(raw string) (string, bool) {
	parsed, err := uuid.Parse(raw)
	if err != nil {
		return "", false
	}
	return parsed.String(), true
}

// decodeBody reads the JSON body of at most MaxJSONBodyBytes into v. It reports
// false after writing the error: 413 for a body over the cap, 400 for one that
// does not decode.
func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxJSONBodyBytes)).Decode(v)
	if err == nil {
		return true
	}
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		httputil.WriteErrorCtx(r.Context(), w, http.StatusRequestEntityTooLarge, "request body too large")
		return false
	}
	httputil.WriteErrorCtx(r.Context(), w, http.StatusBadRequest, "invalid request body")
	return false
}

func ungated(w http.ResponseWriter, r *http.Request) {
	httputil.WriteInternalErrorCtx(r.Context(), w, errors.New("glossary sharing route reached without the access gate"))
}

// Handler serves the sharing endpoints.
type Handler struct{ store Store }

// NewHandler creates a Handler over store.
func NewHandler(store Store) *Handler { return &Handler{store: store} }

type listMembersResponse struct {
	Members []Member        `json:"members"`
	Pending []PendingInvite `json:"pending"`
}

// ListMembers handles GET /api/glossaries/{id}/members.
func (h *Handler) ListMembers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	members, err := h.store.ListMembers(ctx, id)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to list members: %w", err))
		return
	}
	pending, err := h.store.ListPendingInvites(ctx, id)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to list pending invites: %w", err))
		return
	}
	if members == nil {
		members = []Member{}
	}
	if pending == nil {
		pending = []PendingInvite{}
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, listMembersResponse{Members: members, Pending: pending})
}

type setRoleRequest struct {
	Role string `json:"role"`
}

// SetMemberRole handles PUT /api/glossaries/{id}/members/{userId}. The
// member must already exist: adding goes through the bulk route.
func (h *Handler) SetMemberRole(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var body setRoleRequest
	if !decodeBody(w, r, &body) {
		return
	}
	// Checked before the store so the caller gets a comprehensible message.
	if !glossaryaccess.Assignable(body.Role) {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, assignableMsg)
		return
	}
	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	userID, ok := uuidParam(r, "userId")
	if !ok {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "member not found")
		return
	}
	if _, err := h.store.GetRole(ctx, id, userID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "member not found")
			return
		}
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to check membership: %w", err))
		return
	}
	var grantedBy string
	if u := auth.UserFromContext(ctx); u != nil {
		grantedBy = u.ID
	}
	err := h.store.SetRole(ctx, id, userID, body.Role, grantedBy)
	switch {
	case errors.Is(err, ErrOwnerImmutable):
		httputil.WriteErrorCtx(ctx, w, http.StatusConflict, "the owner's role cannot be changed")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to set role: %w", err))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// RemoveMember handles DELETE /api/glossaries/{id}/members/{userId}.
func (h *Handler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	userID, ok := uuidParam(r, "userId")
	if !ok {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "member not found")
		return
	}
	err := h.store.RemoveMember(ctx, id, userID)
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "member not found")
	case errors.Is(err, ErrOwnerImmutable):
		httputil.WriteErrorCtx(ctx, w, http.StatusConflict, "the owner cannot be removed")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to remove member: %w", err))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// RevokePendingInvite handles DELETE /api/glossaries/{id}/members/pending/{username}.
func (h *Handler) RevokePendingInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	err := h.store.RemovePendingInvite(ctx, id, r.PathValue("username"))
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "pending invite not found")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to remove pending invite: %w", err))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

type bulkAddRequest struct {
	Usernames []string `json:"usernames"`
	Role      string   `json:"role"`
}

// BulkAddResult is the per-username outcome returned to the UI.
type BulkAddResult struct {
	Shared           []string `json:"shared"`
	Pending          []string `json:"pending"`
	AlreadyHadAccess []string `json:"alreadyHadAccess"`
}

// normalizeUsernames trims, lower-cases, drops empties and dedupes, keeping
// the first-seen order.
func normalizeUsernames(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, raw := range in {
		name := strings.ToLower(strings.TrimSpace(raw))
		if name == "" {
			continue
		}
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	return out
}

// BulkAdd handles POST /api/glossaries/{id}/members/bulk, the one way to add
// people, one name or many. For each username: a known account gets a
// membership row with the role (shared); someone who already is a member is
// reported (alreadyHadAccess) and left unchanged; an unknown username is
// parked as a pending invite (pending) and applied at their first login.
func (h *Handler) BulkAdd(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var body bulkAddRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if !glossaryaccess.Assignable(body.Role) {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, assignableMsg)
		return
	}
	usernames := normalizeUsernames(body.Usernames)
	if len(usernames) == 0 {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "no usernames provided")
		return
	}
	if len(usernames) > MaxBulkUsernames {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest,
			fmt.Sprintf("too many usernames (max %d)", MaxBulkUsernames))
		return
	}

	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	var inviterID string
	if u := auth.UserFromContext(ctx); u != nil {
		inviterID = u.ID
	}
	result := BulkAddResult{Shared: []string{}, Pending: []string{}, AlreadyHadAccess: []string{}}
	for _, username := range usernames {
		userID, found, err := h.store.UserIDByUsername(ctx, username)
		if err != nil {
			httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to look up users: %w", err))
			return
		}
		if !found {
			if err := h.store.UpsertPendingInvite(ctx, id, username, body.Role, inviterID); err != nil {
				httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to record pending invite: %w", err))
				return
			}
			result.Pending = append(result.Pending, username)
			continue
		}
		added, err := h.store.AddMember(ctx, id, userID, body.Role, inviterID)
		if err != nil {
			httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to add member: %w", err))
			return
		}
		if added {
			result.Shared = append(result.Shared, username)
		} else {
			result.AlreadyHadAccess = append(result.AlreadyHadAccess, username)
		}
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, result)
}

type transferOwnerRequest struct {
	UserID string `json:"userId"`
}

// TransferOwner handles POST /api/glossaries/{id}/transfer-owner. Registered
// on the viewer gate, the owner check happens here. The target must already
// be a member; the old owner becomes admin. A concurrent transfer that already
// moved the ownership makes this one a 409.
func (h *Handler) TransferOwner(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	access := glossaryaccess.AccessFromContext(ctx)
	// The row, not the effective role: only an actual owner row may hand the
	// glossary on.
	if access == nil || access.Role != glossaryaccess.RoleOwner {
		httputil.WriteErrorCtx(ctx, w, http.StatusForbidden, "only the owner may transfer ownership")
		return
	}
	actor := auth.UserFromContext(ctx)
	if actor == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	var body transferOwnerRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if body.UserID == "" {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid request body")
		return
	}
	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	target, ok := uuidParamValue(body.UserID)
	if !ok {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid request body")
		return
	}
	targetRole, err := h.store.GetRole(ctx, id, target)
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "the new owner must already be a member of this glossary")
		return
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to check target membership: %w", err))
		return
	case targetRole == glossaryaccess.RoleOwner:
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "that user is already the owner")
		return
	}
	// The acting user goes into the transaction: two concurrent transfers by
	// the same owner both pass the checks above, and the second must not demote
	// the owner the first one made.
	err = h.store.TransferOwner(ctx, id, actor.ID, target)
	switch {
	case errors.Is(err, ErrNotOwner):
		httputil.WriteErrorCtx(ctx, w, http.StatusConflict, "you are no longer the owner of this glossary")
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "target user not found")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to transfer ownership: %w", err))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// Leave handles DELETE /api/glossaries/{id}/membership: the caller removing
// their own membership. The owner cannot leave.
func (h *Handler) Leave(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)
	if user == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	err := h.store.Leave(ctx, id, user.ID)
	switch {
	case errors.Is(err, ErrOwnerImmutable):
		httputil.WriteErrorCtx(ctx, w, http.StatusConflict,
			"the owner cannot leave: transfer ownership or delete the glossary")
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "not a member of this glossary")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to leave: %w", err))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

type listLinksResponse struct {
	Links []Link `json:"links"`
}

// ListLinks handles GET /api/glossaries/{id}/invite-links.
func (h *Handler) ListLinks(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	links, err := h.store.ListLinks(ctx, id)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to list invite links: %w", err))
		return
	}
	if links == nil {
		links = []Link{}
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, listLinksResponse{Links: links})
}

type createLinkRequest struct {
	Role  string `json:"role"`
	Label string `json:"label"`
}

// CreateLink handles POST /api/glossaries/{id}/invite-links.
func (h *Handler) CreateLink(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var body createLinkRequest
	if !decodeBody(w, r, &body) {
		return
	}
	if !glossaryaccess.Assignable(body.Role) {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, assignableMsg)
		return
	}
	if utf8.RuneCountInString(body.Label) > MaxLabelLen {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest,
			fmt.Sprintf("label must be at most %d characters", MaxLabelLen))
		return
	}
	var label *string
	if body.Label != "" {
		label = &body.Label
	}
	var createdBy string
	if u := auth.UserFromContext(ctx); u != nil {
		createdBy = u.ID
	}
	token, err := kbinvites.NewToken()
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}
	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	link, err := h.store.CreateLink(ctx, id, token, body.Role, label, createdBy)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to create invite link: %w", err))
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusCreated, link)
}

// RevokeLink handles DELETE /api/glossaries/{id}/invite-links/{linkId}. It
// revokes rather than deletes: the token keeps resolving, and existing
// members stay.
func (h *Handler) RevokeLink(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, ok := glossaryID(r)
	if !ok {
		ungated(w, r)
		return
	}
	linkID, ok := uuidParam(r, "linkId")
	if !ok {
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "invite link not found")
		return
	}
	err := h.store.RevokeLink(ctx, id, linkID)
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "invite link not found")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to revoke invite link: %w", err))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// Outcomes of opening an invite link, as Preview reports them.
const (
	// StatusInvite: the caller can join; the web app asks them to accept.
	StatusInvite = "invite"
	// StatusMember: the caller already has a membership, or implicit access
	// (a global glossary reads as viewer) at least as strong as the link's
	// role. The link changes nothing for them, revoked or not.
	StatusMember = "member"
	// StatusRevoked: the link was revoked and the caller is not a member.
	StatusRevoked = "revoked"
)

// decide turns a resolved token into an outcome; Preview reports it and
// Redeem acts on it. access is the caller's effective role through the real
// ladder.
func decide(t LinkTarget) (status, access string) {
	g := &glossaryaccess.Glossary{ID: t.GlossaryID, Visibility: t.Visibility}
	access = glossaryaccess.EffectiveRole(g, t.MemberRole)
	switch {
	case t.MemberRole != "" || (access != "" && glossaryaccess.AtLeast(access, t.LinkRole)):
		return StatusMember, access
	case t.Revoked:
		return StatusRevoked, access
	default:
		return StatusInvite, access
	}
}

type previewResponse struct {
	Status       string `json:"status"`
	GlossaryID   string `json:"glossaryId,omitempty"`
	GlossaryName string `json:"glossaryName"`
	Description  string `json:"description,omitempty"`
	LinkRole     string `json:"linkRole,omitempty"`
	Role         string `json:"role"`
}

// Preview handles GET /api/glossary-invites/{token}: what opening the link
// means for the caller, without changing anything. A revoked link the caller
// has no access to answers with the status and the glossary's name only.
func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u := auth.UserFromContext(ctx)
	if u == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	t, err := h.store.ResolveLink(ctx, r.PathValue("token"), u.ID)
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "invalid invite link")
		return
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to resolve invite link: %w", err))
		return
	}
	status, access := decide(t)
	res := previewResponse{Status: status, GlossaryName: t.GlossaryName, Role: access}
	if status != StatusRevoked || access != "" {
		res.GlossaryID = t.GlossaryID
		res.LinkRole = t.LinkRole
		res.Description = t.Description
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, res)
}

// Redeem handles POST /api/glossary-invites/{token}/redeem: the caller
// accepted the invitation. A revoked link is 410 for everyone, members
// included; someone the link changes nothing for gets AlreadyMember back and
// nothing is written.
func (h *Handler) Redeem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u := auth.UserFromContext(ctx)
	if u == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	token := r.PathValue("token")
	t, err := h.store.ResolveLink(ctx, token, u.ID)
	if err != nil {
		writeRedeemError(w, r, err)
		return
	}
	if t.Revoked {
		writeRedeemError(w, r, ErrRevoked)
		return
	}
	if status, access := decide(t); status == StatusMember {
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, RedeemResult{
			LinkID: t.LinkID, GlossaryID: t.GlossaryID, GlossaryName: t.GlossaryName, Role: access, AlreadyMember: true,
		})
		return
	}
	// Resolve and redeem are two statements: a membership or a revocation that
	// lands in between is still caught by RedeemLink's own transaction.
	res, err := h.store.RedeemLink(ctx, token, u.ID)
	if err != nil {
		writeRedeemError(w, r, err)
		return
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, res)
}

func writeRedeemError(w http.ResponseWriter, r *http.Request, err error) {
	ctx := r.Context()
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "invalid invite link")
	case errors.Is(err, ErrRevoked):
		httputil.WriteCodedErrorCtx(ctx, w, http.StatusGone, "invite_revoked", "invite link was revoked")
	default:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to redeem invite link: %w", err))
	}
}
