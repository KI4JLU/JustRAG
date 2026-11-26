package kbaccess

import (
	"errors"
	"fmt"
	"net/http"
)

// PreviewRoleHeader names the request header a KB admin or owner sends to see
// a KB the way a lower role sees it ("preview as viewer / editor"). The
// value is the role to preview, RoleView or RoleEdit.
//
// The preview only ever takes rights away: resolveKB honours it for a caller
// whose effective role is admin or better, and then serves the request as if
// the caller held the previewed role. Everything downstream — RequireKBRole,
// CapabilitiesFor, the citation filters, the source gates — reads that
// lowered role and needs no preview logic of its own.
const PreviewRoleHeader = "X-KB-Preview-Role"

// ErrInvalidPreviewRole is returned by ParsePreviewRole for a value that is
// not a role a preview can show.
var ErrInvalidPreviewRole = errors.New("kbaccess: invalid preview role")

// ParsePreviewRole validates a preview role as sent in PreviewRoleHeader or
// stored on a chat (chats.preview_role). "" means no preview. Only RoleView
// and RoleEdit can be previewed: previewing admin or owner would show an
// admin nothing new.
func ParsePreviewRole(v string) (string, error) {
	switch v {
	case "":
		return "", nil
	case RoleView, RoleEdit:
		return v, nil
	}
	return "", fmt.Errorf("kbaccess: preview role %q: %w", v, ErrInvalidPreviewRole)
}

// MayPreview reports whether a caller with the effective role role may
// preview the KB as another role: KB admins and owners (which includes a
// superadmin and a system admin on a public KB, see EffectiveRole).
func MayPreview(role string) bool {
	return AtLeast(role, RoleAdmin)
}

// PreviewedRole is the role a request is served as when a caller whose
// effective role is role previews preview: preview when the caller may
// preview, otherwise role unchanged. preview must come from ParsePreviewRole.
// The result is never above role.
func PreviewedRole(role, preview string) string {
	if preview == "" || !MayPreview(role) || !AtLeast(role, preview) {
		return role
	}
	return preview
}

// StoredPreviewRole is the role a chat started in a preview
// (chats.preview_role) is served as: the lower of the caller's current role
// and the stored preview. Unlike PreviewedRole it does not ask whether the
// caller may still preview — the stored cap stays a cap, so an admin demoted
// to editor since keeps the viewer view of their viewer preview chat instead
// of gaining editor rights on it. preview must come from ParsePreviewRole.
func StoredPreviewRole(role, preview string) string {
	if preview == "" || !AtLeast(role, preview) {
		return role
	}
	return preview
}

// WithPreview returns a copy of a served as the stored preview of a chat
// (chats.preview_role, a role ParsePreviewRole accepted) whose later turn
// arrives without PreviewRoleHeader: Role capped by StoredPreviewRole,
// PreviewRole set when that lowered it. Nil-safe; "" returns a unchanged.
func (a *KBAccessResult) WithPreview(preview string) *KBAccessResult {
	if a == nil || preview == "" {
		return a
	}
	role := StoredPreviewRole(a.Role, preview)
	if role == a.Role {
		return a
	}
	return &KBAccessResult{KB: a.KB, Role: role, IsOwner: role == RoleOwner, PreviewRole: preview}
}

// previewWriteAllowed reports whether a request in a preview may use
// method. Reads always may; anything else needs a route that opted in
// (RequireKBUse), because a preview must not change the KB, its settings or
// the caller's own relation to it.
func previewWriteAllowed(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	return false
}
