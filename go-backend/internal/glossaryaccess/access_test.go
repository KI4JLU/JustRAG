package glossaryaccess

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
)

func TestEffectiveRole(t *testing.T) {
	private := &Glossary{ID: "g", Visibility: VisibilityPrivate}
	global := &Glossary{ID: "g", Visibility: VisibilityGlobal}
	tests := []struct {
		name       string
		g          *Glossary
		memberRole string
		want       string
	}{
		{"private without row", private, "", ""},
		{"private owner", private, RoleOwner, RoleOwner},
		{"private editor", private, RoleEditor, RoleEditor},
		{"global without row is viewer", global, "", RoleViewer},
		{"global editor row beats the implicit viewer", global, RoleEditor, RoleEditor},
		{"global owner row", global, RoleOwner, RoleOwner},
		{"unknown stored role falls through on private", private, "superadmin", ""},
		{"unknown stored role falls through on global", global, "view", RoleViewer},
		{"nil glossary", nil, "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := EffectiveRole(tc.g, tc.memberRole); got != tc.want {
				t.Errorf("EffectiveRole = %q, want %q", got, tc.want)
			}
		})
	}
}

type fakeStore struct {
	g       *Glossary
	role    string
	gErr    error
	roleErr error
}

func (f fakeStore) GetGlossary(context.Context, string) (*Glossary, error) { return f.g, f.gErr }
func (f fakeStore) GetMemberRole(context.Context, string, string) (string, error) {
	return f.role, f.roleErr
}

const testID = "3f2b8c1e-0b1d-4a55-9d3e-7c1a2b3c4d5e"

func serve(t *testing.T, store Store, sysRole string, required string, id string, anonymous bool) (*httptest.ResponseRecorder, *Access) {
	t.Helper()
	var got *Access
	h := NewMiddleware(store).RequireGlossaryRole(required)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = AccessFromContext(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	mux := http.NewServeMux()
	mux.Handle("GET /g/{id}", h)
	req := httptest.NewRequest(http.MethodGet, "/g/"+id, nil)
	if !anonymous {
		req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "u1", Role: sysRole}))
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec, got
}

func TestRequireGlossaryRole(t *testing.T) {
	global := &Glossary{ID: testID, Visibility: VisibilityGlobal}
	private := &Glossary{ID: testID, Visibility: VisibilityPrivate}
	tests := []struct {
		name      string
		store     fakeStore
		sysRole   string
		required  string
		id        string
		anonymous bool
		wantCode  int
		wantRole  string
	}{
		{"anonymous", fakeStore{g: global}, "user", RoleViewer, testID, true, http.StatusUnauthorized, ""},
		{"malformed id", fakeStore{g: global}, "user", RoleViewer, "urn:uuid:nope", false, http.StatusNotFound, ""},
		{"missing glossary", fakeStore{}, "user", RoleViewer, testID, false, http.StatusNotFound, ""},
		{"private stranger", fakeStore{g: private}, "user", RoleViewer, testID, false, http.StatusForbidden, ""},
		{"superadmin is a stranger on a private glossary", fakeStore{g: private}, auth.RoleSuperAdmin, RoleViewer, testID, false, http.StatusForbidden, ""},
		{"system admin is a stranger on a private glossary", fakeStore{g: private}, auth.RoleAdmin, RoleViewer, testID, false, http.StatusForbidden, ""},
		{"global reads as viewer", fakeStore{g: global}, "user", RoleViewer, testID, false, http.StatusNoContent, RoleViewer},
		{"global viewer cannot edit", fakeStore{g: global}, "user", RoleEditor, testID, false, http.StatusForbidden, ""},
		{"editor edits", fakeStore{g: private, role: RoleEditor}, "user", RoleEditor, testID, false, http.StatusNoContent, RoleEditor},
		{"editor cannot administer", fakeStore{g: private, role: RoleEditor}, "user", RoleAdmin, testID, false, http.StatusForbidden, ""},
		{"admin administers", fakeStore{g: private, role: RoleAdmin}, "user", RoleAdmin, testID, false, http.StatusNoContent, RoleAdmin},
		{"store error", fakeStore{gErr: errors.New("boom")}, "user", RoleViewer, testID, false, http.StatusInternalServerError, ""},
		{"role store error", fakeStore{g: global, roleErr: errors.New("boom")}, "user", RoleViewer, testID, false, http.StatusInternalServerError, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec, access := serve(t, tc.store, tc.sysRole, tc.required, tc.id, tc.anonymous)
			if rec.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.wantCode, rec.Body.String())
			}
			if tc.wantRole != "" && (access == nil || access.Role != tc.wantRole) {
				t.Errorf("access = %+v, want role %q", access, tc.wantRole)
			}
			// Member says whether a membership row stands behind the role: a viewer
			// through a global glossary has none, so there is nothing to leave.
			if tc.wantRole != "" && access != nil && access.Member != (tc.store.role != "") {
				t.Errorf("Member = %v, want %v", access.Member, tc.store.role != "")
			}
		})
	}
}
