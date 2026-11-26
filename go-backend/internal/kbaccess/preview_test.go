package kbaccess_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// ResolveRole's origin names the rung of the ladder. Oracle: the ladder as
// documented on EffectiveRole (superadmin, member row, system admin on a
// public KB, published public KB), and EffectiveRole agrees on the role.
func TestResolveRoleOrigin(t *testing.T) {
	cases := []struct {
		name               string
		sysRole, member    string
		global, published  bool
		wantRole, wantFrom string
	}{
		{"superadmin wins over a row", auth.RoleSuperAdmin, kbaccess.RoleView, false, false, kbaccess.RoleOwner, kbaccess.OriginSuperadmin},
		{"member row", auth.RoleUser, kbaccess.RoleEdit, false, false, kbaccess.RoleEdit, kbaccess.OriginMember},
		{"member row on a public kb", auth.RoleUser, kbaccess.RoleEdit, true, true, kbaccess.RoleEdit, kbaccess.OriginMember},
		{"system admin on a public kb", auth.RoleAdmin, "", true, false, kbaccess.RoleAdmin, kbaccess.OriginSystemAdmin},
		{"anyone on a published public kb", auth.RoleUser, "", true, true, kbaccess.RoleView, kbaccess.OriginPublic},
		{"no role", auth.RoleUser, "", false, false, "", ""},
	}
	for _, c := range cases {
		kb := &kbaccess.KnowledgeBase{ID: kbID, IsGlobal: c.global, IsPublished: c.published}
		role, origin := kbaccess.ResolveRole(kb, c.sysRole, c.member)
		if role != c.wantRole || origin != c.wantFrom {
			t.Errorf("%s: ResolveRole = (%q, %q), want (%q, %q)", c.name, role, origin, c.wantRole, c.wantFrom)
		}
		if got := kbaccess.EffectiveRole(kb, c.sysRole, c.member); got != role {
			t.Errorf("%s: EffectiveRole = %q, ResolveRole = %q", c.name, got, role)
		}
	}
}

// Oracle: the preview contract on PreviewRoleHeader — only view and edit can
// be previewed, only by admin and owner, and the result is never above the
// caller's own role.
func TestPreviewedRole(t *testing.T) {
	cases := []struct {
		role, preview, want string
	}{
		{kbaccess.RoleOwner, kbaccess.RoleView, kbaccess.RoleView},
		{kbaccess.RoleOwner, kbaccess.RoleEdit, kbaccess.RoleEdit},
		{kbaccess.RoleAdmin, kbaccess.RoleView, kbaccess.RoleView},
		{kbaccess.RoleAdmin, "", kbaccess.RoleAdmin},
		{kbaccess.RoleEdit, kbaccess.RoleView, kbaccess.RoleEdit},
		{kbaccess.RoleView, kbaccess.RoleEdit, kbaccess.RoleView},
		{"", kbaccess.RoleView, ""},
	}
	for _, c := range cases {
		if got := kbaccess.PreviewedRole(c.role, c.preview); got != c.want {
			t.Errorf("PreviewedRole(%q, %q) = %q, want %q", c.role, c.preview, got, c.want)
		}
	}
	for _, v := range []string{"admin", "owner", "VIEW", "x"} {
		if _, err := kbaccess.ParsePreviewRole(v); !errors.Is(err, kbaccess.ErrInvalidPreviewRole) {
			t.Errorf("ParsePreviewRole(%q) err = %v, want ErrInvalidPreviewRole", v, err)
		}
	}
}

// The middleware serves a preview as the previewed role, refuses it to
// non-admins and malformed values, and lets it write only through
// RequireKBUse. Oracle: the status codes and roles stated on resolveKB and
// RequireKBUse.
func TestRequireKBRolePreview(t *testing.T) {
	cases := []struct {
		name       string
		sysRole    string
		member     string
		global     bool
		preview    string
		method     string
		gate       string // "view", "edit", "admin", "use", "operable"
		wantStatus int
		wantRole   string
	}{
		{"owner previews view, read", auth.RoleUser, kbaccess.RoleOwner, false, "view", http.MethodGet, "view", 200, kbaccess.RoleView},
		{"admin previews edit, read edit route", auth.RoleUser, kbaccess.RoleAdmin, false, "edit", http.MethodGet, "edit", 200, kbaccess.RoleEdit},
		{"preview view refused on edit route", auth.RoleUser, kbaccess.RoleOwner, false, "view", http.MethodGet, "edit", 403, ""},
		{"preview edit refused on admin route", auth.RoleUser, kbaccess.RoleOwner, false, "edit", http.MethodGet, "admin", 403, ""},
		{"preview may not write on view route", auth.RoleUser, kbaccess.RoleOwner, false, "view", http.MethodPut, "view", 403, ""},
		{"preview edit may not write on edit route", auth.RoleUser, kbaccess.RoleOwner, false, "edit", http.MethodPost, "edit", 403, ""},
		{"preview may write on a use route", auth.RoleUser, kbaccess.RoleOwner, false, "view", http.MethodPost, "use", 200, kbaccess.RoleView},
		{"editor may not preview", auth.RoleUser, kbaccess.RoleEdit, false, "view", http.MethodGet, "view", 403, ""},
		{"invalid preview value", auth.RoleUser, kbaccess.RoleOwner, false, "admin", http.MethodGet, "view", 400, ""},
		{"superadmin previews view", auth.RoleSuperAdmin, "", false, "view", http.MethodGet, "view", 200, kbaccess.RoleView},
		{"system admin previews public kb", auth.RoleAdmin, "", true, "view", http.MethodGet, "view", 200, kbaccess.RoleView},
		{"no operable pass in a preview", auth.RoleAdmin, "", true, "view", http.MethodGet, "operable", 403, ""},
		{"no header, use route", auth.RoleUser, kbaccess.RoleView, false, "", http.MethodPost, "use", 200, kbaccess.RoleView},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mw := kbaccess.NewMiddleware(&mockStore{
				kb:   &kbaccess.KnowledgeBase{ID: kbID, IsGlobal: c.global, IsPublished: true},
				role: c.member,
			})
			var got *kbaccess.KBAccessResult
			next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got = kbaccess.AccessFromContext(r.Context())
			})
			var h http.Handler
			switch c.gate {
			case "use":
				h = mw.RequireKBUse()(next)
			case "operable":
				h = mw.RequireOperableKB()(next)
			default:
				h = mw.RequireKBRole(c.gate)(next)
			}
			req := httptest.NewRequest(c.method, "/api/kb/"+kbID, nil)
			req.SetPathValue("id", kbID)
			if c.preview != "" {
				req.Header.Set(kbaccess.PreviewRoleHeader, c.preview)
			}
			req = req.WithContext(claimsCtx(req.Context(), auth.Claims{ID: userID, Role: c.sysRole}))
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)
			if rr.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", rr.Code, c.wantStatus, rr.Body)
			}
			if c.wantStatus != http.StatusOK {
				return
			}
			if got.Role != c.wantRole {
				t.Errorf("role = %q, want %q", got.Role, c.wantRole)
			}
			if got.PreviewRole != c.preview {
				t.Errorf("PreviewRole = %q, want %q", got.PreviewRole, c.preview)
			}
			if got.IsOwner && c.preview != "" {
				t.Error("IsOwner set in a preview")
			}
		})
	}
}

// A stored preview role caps the capabilities of a chat's reader, and never
// raises them. Oracle: CapabilitiesFor's documented table (view follows the
// viewer_* flags; admin has everything).
func TestResolvePreviewCapabilities(t *testing.T) {
	kb := &kbaccess.KnowledgeBase{ID: kbID}
	ctx := context.Background()
	caps, err := kbaccess.ResolvePreviewCapabilities(ctx, &mockStore{kb: kb, role: kbaccess.RoleOwner}, kbID, userID, auth.RoleUser, kbaccess.RoleView)
	if err != nil || caps.SeeCitations || caps.SeeSources {
		t.Errorf("owner previewing view: caps = %+v, err = %v; want none", caps, err)
	}
	caps, err = kbaccess.ResolvePreviewCapabilities(ctx, &mockStore{kb: kb, role: kbaccess.RoleOwner}, kbID, userID, auth.RoleUser, "")
	if err != nil || !caps.SeeCitations {
		t.Errorf("owner without preview: caps = %+v, err = %v; want all", caps, err)
	}
	flags := &kbaccess.KnowledgeBase{ID: kbID, Sources: kbaccess.SourcePermissions{EditorSeeCitations: true}}
	caps, err = kbaccess.ResolvePreviewCapabilities(ctx, &mockStore{kb: flags, role: kbaccess.RoleView}, kbID, userID, auth.RoleUser, kbaccess.RoleEdit)
	if err != nil || caps.SeeCitations {
		t.Errorf("viewer with a stored edit preview: caps = %+v, err = %v; want the viewer's (none)", caps, err)
	}
	// An admin demoted to editor since keeps the stored viewer cap: the
	// editor's citations stay hidden in their viewer preview chat.
	caps, err = kbaccess.ResolvePreviewCapabilities(ctx, &mockStore{kb: flags, role: kbaccess.RoleEdit}, kbID, userID, auth.RoleUser, kbaccess.RoleView)
	if err != nil || caps.SeeCitations {
		t.Errorf("demoted to editor, stored view preview: caps = %+v, err = %v; want the viewer's (none)", caps, err)
	}
	if _, err := kbaccess.ResolvePreviewCapabilities(ctx, &mockStore{kb: kb, role: kbaccess.RoleOwner}, kbID, userID, auth.RoleUser, "owner"); !errors.Is(err, kbaccess.ErrInvalidPreviewRole) {
		t.Errorf("invalid stored preview: err = %v, want ErrInvalidPreviewRole", err)
	}
}
