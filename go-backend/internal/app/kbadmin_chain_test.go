package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// kbStoreStub lets us script the KB row and the caller's kb_members role
// per test. Implements kbaccess.KBStore.
type kbStoreStub struct {
	kb   *kbaccess.KnowledgeBase
	role string
}

func (s kbStoreStub) GetKBByID(_ context.Context, _ string) (*kbaccess.KnowledgeBase, error) {
	return s.kb, nil
}

func (s kbStoreStub) GetKBRole(_ context.Context, _, _ string) (string, error) {
	return s.role, nil
}

// buildAdminChain mirrors routes.go's kbAdminChain composition without the
// outer Authenticate wrapper. The test injects the user into the request
// context directly via auth.WithUser, so Authenticate (which only sets a
// user from a valid JWT) is not needed and would reject every request with
// 401. kbAdminChain is the plain four-role gate — no system-role term — and
// carries the per-KB decisions any KB admin may make (rename, membership,
// categories, canonicalize, community build, tabular rematerialize).
func buildAdminChain(kbMw *kbaccess.Middleware) func(http.HandlerFunc) http.Handler {
	return func(h http.HandlerFunc) http.Handler {
		return kbMw.RequireKBRole(kbaccess.RoleAdmin)(http.HandlerFunc(h))
	}
}

// buildAdvancedChain calls THE production composition (kbAdvancedInner in
// routes.go), not a copy of it, minus only the outer Authenticate wrapper the
// tests supply themselves (see buildAdminChain).
//
// It used to rebuild the same nesting inline, and that made every test below
// vacuous with respect to the one thing they exist to protect: adding
// auth.RoleUser to routes.go's role list left the whole suite green, because
// these tests were asserting against their own mirror rather than the chain the
// server installs. Do not reintroduce a local copy — if the composition is
// worth pinning, the tests have to touch the real one.
func buildAdvancedChain(authMw *auth.Middleware, kbMw *kbaccess.Middleware) func(http.HandlerFunc) http.Handler {
	return kbAdvancedInner(authMw, kbMw)
}

// TestKbAdminChain_PlainUserWithKbAdminRolePasses pins the boundary between
// the two chains, and it is deliberately a pair with
// TestKbAdvancedChain_PlainUserRefused below.
//
// History, because this test has changed meaning twice and the next reader
// deserves the decision rather than the accident: kbTuningChain once required
// a system role in {api-user, admin, superadmin} on top of the KB role.
// Commit 9a4f83a folded that chain into kbAdminChain and dropped the system
// role term, and this test was written to pin the drop. That went too far —
// it made every KB owner, i.e. every ordinary user who ever created a KB, an
// operator of the 52-key per-KB site_config registry, of eval runs, and of
// the workflow presets. The system-role requirement is now restored on that
// advanced surface as kbAdvancedChain.
//
// What survives the restore, and what this test pins, is that kbAdminChain
// itself stays free of any system-role term: a plain user who is a KB admin
// still reaches the ordinary per-KB decisions. The gate came back on the
// advanced surface only, not on the four-role model as a whole.
func TestKbAdminChain_PlainUserWithKbAdminRolePasses(t *testing.T) {
	kbMw := kbaccess.NewMiddleware(kbStoreStub{
		kb:   &kbaccess.KnowledgeBase{ID: "kb1", IsGlobal: false},
		role: kbaccess.RoleAdmin,
	})
	chain := buildAdminChain(kbMw)

	handlerCalled := false
	h := chain(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPatch, "/api/kb/kb1", nil)
	req.SetPathValue("id", "kb1")
	req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "user-1", Role: auth.RoleUser}))

	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("got %d want 200 (handlerCalled=%v)", w.Code, handlerCalled)
	}
	if !handlerCalled {
		t.Fatal("expected handler to be called")
	}
}

// TestKbAdvancedChain_PlainUserRefused is the restored gate, stated as an
// intent: the KB "advanced settings" surface (RAG settings, Agenten & Teams,
// Evals, Workflow, and the per-KB re-embed sweep the settings Save flow
// offers) requires the system role admin (or superadmin); no KB role is the
// permission for it.
//
// The caller here is the strongest possible plain user — 'owner' on the KB,
// which is what every user who creates a KB gets — and is still refused. That
// is the whole point: the KB role is not the permission for this surface. If
// this test ever goes green after someone puts an advanced route back on
// kbAdminChain, the surface is open to every KB creator again.
func TestKbAdvancedChain_PlainUserRefused(t *testing.T) {
	authMw := auth.NewMiddleware("test-secret-at-least-32-characters-long", nil)
	kbMw := kbaccess.NewMiddleware(kbStoreStub{
		kb:   &kbaccess.KnowledgeBase{ID: "kb1", IsGlobal: false},
		role: kbaccess.RoleOwner,
	})
	chain := buildAdvancedChain(authMw, kbMw)

	handlerCalled := false
	h := chain(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/kb/kb1/settings", nil)
	req.SetPathValue("id", "kb1")
	req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "user-1", Role: auth.RoleUser}))

	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("got %d want 403 (handlerCalled=%v)", w.Code, handlerCalled)
	}
	if handlerCalled {
		t.Fatal("expected handler NOT to be called")
	}
}

// TestKbAdvancedChain table-drives the gate: the system role admin (or
// superadmin) is the whole permission — on a global or shared KB whatever the
// KB role, and on their own — and no KB role stands in for it, not even for
// an api-user. Somebody else's private KB nobody shares stays closed (its
// evals would read its content).
func TestKbAdvancedChain(t *testing.T) {
	ownerID := "user-1"
	private := &kbaccess.KnowledgeBase{ID: "kb1", UserID: &ownerID}
	shared := &kbaccess.KnowledgeBase{ID: "kb1", UserID: &ownerID, Shared: true}
	global := &kbaccess.KnowledgeBase{ID: "kb1", IsGlobal: true, IsPublished: true}
	cases := []struct {
		name     string
		kb       *kbaccess.KnowledgeBase
		sysRole  string
		userID   string
		kbRole   string // the caller's kb_members role, "" for none
		wantCode int
	}{
		// A system admin on a shared or global KB, whatever their role in it.
		{"admin+shared+no-kb-row", shared, auth.RoleAdmin, "other", "", http.StatusOK},
		{"admin+shared+kb-view", shared, auth.RoleAdmin, "other", kbaccess.RoleView, http.StatusOK},
		{"admin+global+no-kb-row", global, auth.RoleAdmin, "other", "", http.StatusOK},
		{"superadmin+shared", shared, auth.RoleSuperAdmin, "other", "", http.StatusOK},

		// A system admin's own private KB, shared or not (developer ruling
		// 2026-11-05).
		{"admin+own-unshared", private, auth.RoleAdmin, ownerID, kbaccess.RoleOwner, http.StatusOK},
		{"superadmin+own-unshared", private, auth.RoleSuperAdmin, ownerID, kbaccess.RoleOwner, http.StatusOK},

		// Somebody else's private KB nobody shares: closed, superadmin
		// included, whatever other KB role.
		{"admin+unshared+no-kb-row", private, auth.RoleAdmin, "other", "", http.StatusForbidden},
		{"superadmin+unshared", private, auth.RoleSuperAdmin, "other", "", http.StatusForbidden},

		// Any KB role without the system role: refused. An api-user is no
		// operator either (developer ruling 2026-11-05).
		{"api-user+shared+kb-owner", shared, auth.RoleAPIUser, ownerID, kbaccess.RoleOwner, http.StatusForbidden},
		{"api-user+global", global, auth.RoleAPIUser, "other", "", http.StatusForbidden},
		{"plain-user+shared+kb-owner", shared, auth.RoleUser, ownerID, kbaccess.RoleOwner, http.StatusForbidden},
		{"plain-user+global+kb-admin", global, auth.RoleUser, "other", kbaccess.RoleAdmin, http.StatusForbidden},
	}

	authMw := auth.NewMiddleware("test-secret-at-least-32-characters-long", nil)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			kbMw := kbaccess.NewMiddleware(kbStoreStub{kb: c.kb, role: c.kbRole})
			chain := buildAdvancedChain(authMw, kbMw)

			handlerCalled := false
			h := chain(func(w http.ResponseWriter, r *http.Request) {
				handlerCalled = true
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, "/api/kb/kb1/settings", nil)
			req.SetPathValue("id", "kb1")
			req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: c.userID, Role: c.sysRole}))

			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)

			if w.Code != c.wantCode {
				t.Fatalf("got %d want %d (handlerCalled=%v)", w.Code, c.wantCode, handlerCalled)
			}
		})
	}
}

// A system admin needs no KB role, but the KB must exist: a missing one is
// a 404, not a handler call on nothing.
func TestKbAdvancedChain_SystemAdminMissingKB404(t *testing.T) {
	authMw := auth.NewMiddleware("test-secret-at-least-32-characters-long", nil)
	chain := buildAdvancedChain(authMw, kbaccess.NewMiddleware(kbStoreStub{kb: nil}))
	h := chain(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler must not run for a missing KB")
	})
	req := httptest.NewRequest(http.MethodGet, "/api/kb/kb1/settings", nil)
	req.SetPathValue("id", "kb1")
	req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "u", Role: auth.RoleAdmin}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("got %d want 404", w.Code)
	}
}

// TestKbAgentListChain: the agent list stays readable with KB role view (the
// chat's agent picker) and opens to system admins on every KB they operate,
// shared or global (the RAG-Settings page's agent tab), but not on a private
// KB nobody shares that is not theirs.
func TestKbAgentListChain(t *testing.T) {
	private := &kbaccess.KnowledgeBase{ID: "kb1"}
	shared := &kbaccess.KnowledgeBase{ID: "kb1", Shared: true}
	cases := []struct {
		name     string
		kb       *kbaccess.KnowledgeBase
		sysRole  string
		kbRole   string
		wantCode int
	}{
		{"user+kb-view", private, auth.RoleUser, kbaccess.RoleView, http.StatusOK},
		{"user+no-kb-row", shared, auth.RoleUser, "", http.StatusForbidden},
		{"api-user+no-kb-row", shared, auth.RoleAPIUser, "", http.StatusForbidden},
		{"admin+shared+no-kb-row", shared, auth.RoleAdmin, "", http.StatusOK},
		{"admin+unshared+no-kb-row", private, auth.RoleAdmin, "", http.StatusForbidden},
		{"admin+unshared+kb-owner", private, auth.RoleAdmin, kbaccess.RoleOwner, http.StatusOK},
		{"superadmin+unshared", private, auth.RoleSuperAdmin, "", http.StatusOK},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			kbMw := kbaccess.NewMiddleware(kbStoreStub{kb: c.kb, role: c.kbRole})
			h := kbAgentListInner(kbMw)(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
			req := httptest.NewRequest(http.MethodGet, "/api/kb/kb1/agents", nil)
			req.SetPathValue("id", "kb1")
			req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "u", Role: c.sysRole}))
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != c.wantCode {
				t.Fatalf("got %d want %d", w.Code, c.wantCode)
			}
		})
	}
}

// TestKbAdminChain_EditRoleRejected ensures the edit/admin separation line
// holds: a kb_members row of 'edit' is not enough for the KB-admin tier.
func TestKbAdminChain_EditRoleRejected(t *testing.T) {
	kbMw := kbaccess.NewMiddleware(kbStoreStub{
		kb:   &kbaccess.KnowledgeBase{ID: "kb1", IsGlobal: false},
		role: kbaccess.RoleEdit,
	})
	chain := buildAdminChain(kbMw)

	handlerCalled := false
	h := chain(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPatch, "/api/kb/kb1", nil)
	req.SetPathValue("id", "kb1")
	req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "user-1", Role: auth.RoleUser}))

	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("got %d want 403 (handlerCalled=%v)", w.Code, handlerCalled)
	}
	if handlerCalled {
		t.Fatal("expected handler NOT to be called")
	}
}

// TestTabularRematerializeIsOnKbAdminChain pins the mount point for the
// per-KB tabular rematerialize endpoint (task 9): it must sit on
// kbAdminChain alongside its siblings canonicalize and communities/build,
// not on kbAdvancedChain (that surface requires a system role in addition to
// KB role admin, and rematerialize — like canonicalize/communities — is an
// ordinary per-KB admin decision) and not on some looser chain. Reads
// routes.go's actual registration via the routeChains helper in
// advanced_routes_test.go rather than rebuilding the chain locally, so
// moving the route in routes.go turns this test red.
func TestTabularRematerializeIsOnKbAdminChain(t *testing.T) {
	chains := routeChains(t)
	const pattern = "POST /api/kb/{id}/tabular/rematerialize"
	got, ok := chains[pattern]
	if !ok {
		t.Fatalf("%s is not registered in routes.go", pattern)
	}
	if got != "kbAdminChain" {
		t.Errorf("%s is on rc.%s, want rc.kbAdminChain", pattern, got)
	}
}

// TestKbAdminChain table-drives the rest of the kbaccess.EffectiveRole
// ladder as observed through kbAdminChain (required role: admin).
func TestKbAdminChain(t *testing.T) {
	ownerID := "user-1"
	cases := []struct {
		name     string
		sysRole  string
		userID   string
		kbOwner  *string
		kbRole   string // the caller's kb_members role, "" for none
		wantCode int
	}{
		{"owner-role+plain-user", auth.RoleUser, ownerID, &ownerID, kbaccess.RoleOwner, http.StatusOK},
		{"superadmin", auth.RoleSuperAdmin, "other", &ownerID, "", http.StatusOK},
		{"admin-role+plain-user", auth.RoleUser, "other", &ownerID, kbaccess.RoleAdmin, http.StatusOK},
		{"edit-role+plain-user", auth.RoleUser, "other", &ownerID, kbaccess.RoleEdit, http.StatusForbidden},
		{"view-role+plain-user", auth.RoleUser, "other", &ownerID, kbaccess.RoleView, http.StatusForbidden},
		{"non-member+plain-user", auth.RoleUser, "other", &ownerID, "", http.StatusForbidden},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			kbMw := kbaccess.NewMiddleware(kbStoreStub{
				kb:   &kbaccess.KnowledgeBase{ID: "kb1", UserID: c.kbOwner, IsGlobal: false},
				role: c.kbRole,
			})
			chain := buildAdminChain(kbMw)

			handlerCalled := false
			h := chain(func(w http.ResponseWriter, r *http.Request) {
				handlerCalled = true
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodPatch, "/api/kb/kb1", nil)
			req.SetPathValue("id", "kb1")
			req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: c.userID, Role: c.sysRole}))

			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)

			if w.Code != c.wantCode {
				t.Fatalf("got %d want %d (handlerCalled=%v)", w.Code, c.wantCode, handlerCalled)
			}
		})
	}
}
