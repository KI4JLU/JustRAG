package kb

import (
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// The row's role fields follow kbaccess.ResolveRole, a preview caps role and
// capabilities, and a caller who may not preview keeps their own. Oracle:
// the ladder documented on kbaccess.EffectiveRole and CapabilitiesFor's
// table (view without flags has no capability; owner has all).
func TestKBRowResolveRole(t *testing.T) {
	str := func(s string) *string { return &s }
	cases := []struct {
		name                                string
		row                                 KBRow
		sysRole, preview                    string
		wantRole, wantOrigin, wantPreviewed string
		wantSeeSources                      bool
	}{
		{"owner", KBRow{ID: "kb", MyRole: str("owner")}, auth.RoleUser, "", kbaccess.RoleOwner, kbaccess.OriginMember, "", true},
		{"implicit viewer on a published public kb", KBRow{ID: "kb", IsGlobal: true, IsPublished: true}, auth.RoleUser, "", kbaccess.RoleView, kbaccess.OriginPublic, "", false},
		{"system admin on a public kb", KBRow{ID: "kb", IsGlobal: true}, auth.RoleAdmin, "", kbaccess.RoleAdmin, kbaccess.OriginSystemAdmin, "", true},
		{"owner previews view", KBRow{ID: "kb", MyRole: str("owner")}, auth.RoleUser, kbaccess.RoleView, kbaccess.RoleView, kbaccess.OriginMember, kbaccess.RoleView, false},
		{"editor cannot preview", KBRow{ID: "kb", MyRole: str("edit")}, auth.RoleUser, kbaccess.RoleView, kbaccess.RoleEdit, kbaccess.OriginMember, "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := c.row
			r.ResolvePreview(c.sysRole, c.preview)
			if r.EffectiveRole != c.wantRole || r.RoleOrigin != c.wantOrigin || r.PreviewRole != c.wantPreviewed {
				t.Errorf("role %q origin %q preview %q, want %q %q %q",
					r.EffectiveRole, r.RoleOrigin, r.PreviewRole, c.wantRole, c.wantOrigin, c.wantPreviewed)
			}
			if r.Capabilities == nil || r.Capabilities.SeeSources != c.wantSeeSources {
				t.Errorf("capabilities = %+v, want seeSources %v", r.Capabilities, c.wantSeeSources)
			}
		})
	}
}
