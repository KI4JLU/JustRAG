// HTTP layer for KB invite links. Routes are registered in
// internal/app/routes.go:
//
//	GET    /api/kb/{id}/invite-links             kbAdminChain
//	POST   /api/kb/{id}/invite-links             kbAdminChain
//	DELETE /api/kb/{id}/invite-links/{linkId}    kbAdminChain
//	GET    /api/invites/{token}                  authenticated only + rate limit
//	POST   /api/invites/{token}/redeem           authenticated only + rate limit
//
// The two token routes sit on the plain authenticated chain on purpose: the
// caller has no role on the KB yet, so RequireKBRole would reject them before
// they could join. The web app shows the GET's answer as a modal and joins
// only when the person accepts. Joining is POST-only so link previews in mail
// and chat clients cannot trigger a join by fetching the URL.

package kbinvites

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"unicode/utf8"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/logctx"
)

// MaxLabelLen caps the human-readable link label.
const MaxLabelLen = 100

// AuditLogger records operator actions. Matches the interface used by
// internal/kbvisibility and internal/adminkboverview.
type AuditLogger interface {
	LogAuditAction(ctx context.Context, operatorID, action, targetType, targetID string, diff any) error
}

// Handler serves the invite-link endpoints.
type Handler struct {
	store Store
	audit AuditLogger
}

// NewHandler creates a Handler over store, auditing through audit.
func NewHandler(store Store, audit AuditLogger) *Handler {
	return &Handler{store: store, audit: audit}
}

type listLinksResponse struct {
	Links []Link `json:"links"`
}

// ListLinks handles GET /api/kb/{id}/invite-links.
func (h *Handler) ListLinks(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	links, err := h.store.List(ctx, r.PathValue("id"))
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

// CreateLink handles POST /api/kb/{id}/invite-links.
func (h *Handler) CreateLink(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var body createLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, "invalid request body")
		return
	}
	// Assignable rules out 'owner' and any unknown value in one step, exactly
	// as kbmembers.SetMemberRole does.
	if !kbaccess.Assignable(body.Role) {
		httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest,
			`role must be "view", "edit" or "admin"`)
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

	token, err := NewToken()
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, err)
		return
	}

	kbID := r.PathValue("id")
	link, err := h.store.Create(ctx, kbID, token, body.Role, label, createdBy)
	if err != nil {
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to create invite link: %w", err))
		return
	}

	h.log(ctx, createdBy, "kb_invite_link_create", kbID, map[string]any{"linkId": link.ID, "role": body.Role})
	httputil.WriteJSONCtx(ctx, w, http.StatusCreated, link)
}

// DeleteLink handles DELETE /api/kb/{id}/invite-links/{linkId}. It revokes
// the link (Store.Revoke): the row stays so the token keeps resolving.
func (h *Handler) DeleteLink(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	kbID, linkID := r.PathValue("id"), r.PathValue("linkId")

	err := h.store.Revoke(ctx, kbID, linkID)
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "invite link not found")
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to revoke invite link: %w", err))
	default:
		var operator string
		if u := auth.UserFromContext(ctx); u != nil {
			operator = u.ID
		}
		h.log(ctx, operator, "kb_invite_link_revoke", kbID, map[string]any{"linkId": linkID})
		w.WriteHeader(http.StatusNoContent)
	}
}

// Outcomes of opening an invite link, as Preview reports them.
const (
	// StatusInvite: the caller can join; the web app asks them to accept.
	StatusInvite = "invite"
	// StatusMember: the caller already has a membership, or implicit
	// access at least as strong as the link's role (a system admin on a
	// public KB, any user on a published public KB opening a view link).
	// The link changes nothing for them, revoked or not.
	StatusMember = "member"
	// StatusRevoked: the link was revoked and the caller is not a member.
	StatusRevoked = "revoked"
)

// decide is the one place that turns a resolved token into an outcome;
// Preview reports it and Redeem acts on it. access is the caller's
// effective role on the KB ("" for none), through the real ladder.
func decide(t LinkTarget, sysRole string) (status, access string) {
	kb := &kbaccess.KnowledgeBase{ID: t.KBID, IsGlobal: t.IsGlobal, IsPublished: t.IsPublished}
	access = kbaccess.EffectiveRole(kb, sysRole, t.MemberRole)
	switch {
	case t.MemberRole != "" || (access != "" && kbaccess.AtLeast(access, t.LinkRole)):
		return StatusMember, access
	case t.Revoked:
		return StatusRevoked, access
	default:
		return StatusInvite, access
	}
}

// previewResponse is what the join modal shows. Role is the caller's
// effective role on the KB right now ("" for none): with it the web app
// decides whether it can open the KB. A revoked link the caller has no
// access to answers with the status and the KB's name only — the name says
// which invitation ended; the KB's id, the role the link granted and every
// other detail stay with the KB's members.
type previewResponse struct {
	Status      string  `json:"status"`
	KBID        string  `json:"kbId,omitempty"`
	KBName      string  `json:"kbName"`
	Description *string `json:"description,omitempty"`
	LinkRole    string  `json:"linkRole,omitempty"`
	Role        string  `json:"role"`
	IsFavorite  bool    `json:"isFavorite"`
	InOverview  bool    `json:"inOverview"`
	// CanSubscribe: the KB can be put into the caller's overview by a
	// subscription (PUT /api/kb/{id}/subscription) — a published public KB.
	// A KB that is neither in the overview nor subscribable cannot be saved
	// there from the dialog (implicit access to a private or staged KB).
	CanSubscribe bool `json:"canSubscribe"`
	*TopicDetails
}

// Preview handles GET /api/invites/{token}: what opening the link means for
// the caller, without changing anything.
func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	u := auth.UserFromContext(ctx)
	if u == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}

	t, err := h.store.Resolve(ctx, r.PathValue("token"), u.ID)
	switch {
	case errors.Is(err, ErrNotFound):
		httputil.WriteErrorCtx(ctx, w, http.StatusNotFound, "invalid invite link")
		return
	case err != nil:
		httputil.WriteInternalErrorCtx(ctx, w, fmt.Errorf("failed to resolve invite link: %w", err))
		return
	}

	status, access := decide(t, u.Role)
	res := previewResponse{Status: status, KBName: t.KBName, Role: access}
	if status != StatusRevoked || access != "" {
		res.KBID = t.KBID
		res.LinkRole = t.LinkRole
		res.IsFavorite = t.IsFavorite
		res.InOverview = t.InOverview
		res.CanSubscribe = t.IsGlobal && t.IsPublished
		res.Description = t.Description
		// Decoration for the dialog: without it the dialog still works, so a
		// failure is logged, not answered with an error.
		if d, err := h.store.Details(ctx, t.KBID); err != nil {
			logctx.From(ctx).Warn("invite preview: topic details failed", "kb_id", t.KBID, "error", err)
		} else {
			res.TopicDetails = &d
		}
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, res)
}

// Redeem handles POST /api/invites/{token}/redeem: the caller accepted the
// invitation. A revoked link is 410 for everyone, members included (Preview
// still tells a member they are in); someone the link changes nothing for
// (StatusMember) gets AlreadyMember back and nothing is written.
func (h *Handler) Redeem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	u := auth.UserFromContext(ctx)
	if u == nil {
		httputil.WriteErrorCtx(ctx, w, http.StatusUnauthorized, "authentication required")
		return
	}
	token := r.PathValue("token")

	t, err := h.store.Resolve(ctx, token, u.ID)
	if err != nil {
		h.writeRedeemError(w, r, err)
		return
	}
	if t.Revoked {
		h.writeRedeemError(w, r, ErrRevoked)
		return
	}
	switch status, access := decide(t, u.Role); status {
	case StatusMember:
		httputil.WriteJSONCtx(ctx, w, http.StatusOK, RedeemResult{
			LinkID: t.LinkID, KBID: t.KBID, KBName: t.KBName, Role: access, AlreadyMember: true,
		})
		return
	}

	// Resolve and Redeem are two statements: a membership or a revocation
	// that lands in between is still caught, by Redeem's own transaction.
	res, err := h.store.Redeem(ctx, token, u.ID)
	if err != nil {
		h.writeRedeemError(w, r, err)
		return
	}
	if !res.AlreadyMember {
		h.log(ctx, u.ID, "kb_invite_link_redeem", res.KBID, map[string]any{"linkId": res.LinkID, "role": res.Role})
	}
	httputil.WriteJSONCtx(ctx, w, http.StatusOK, res)
}

func (h *Handler) writeRedeemError(w http.ResponseWriter, r *http.Request, err error) {
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

// log records an audit entry without ever failing the request.
func (h *Handler) log(ctx context.Context, operatorID, action, kbID string, diff any) {
	if h.audit == nil || operatorID == "" {
		return
	}
	if err := h.audit.LogAuditAction(ctx, operatorID, action, "knowledge_base", kbID, diff); err != nil {
		logctx.From(ctx).Warn("audit log failed", "action", action, "error", err)
	}
}
