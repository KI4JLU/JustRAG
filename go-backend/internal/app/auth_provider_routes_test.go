package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/config"
	"github.com/justrag/go-backend/internal/database"
	"github.com/justrag/go-backend/internal/redisclient"
)

// TestAuthProviderRoutesAreSuperadminOnly pins the chain behind
// /api/admin/auth-providers. Whoever configures a login provider decides
// which identities the app trusts: an OIDC issuer or LDAP server the caller
// runs can vouch for any username, so on adminChain a plain admin could log
// in as a superadmin through a provider of their own. It drives the real
// registerAuthProviderRoutes, so it fails if any of the four registrations
// moves back to adminChain.
func TestAuthProviderRoutesAreSuperadminOnly(t *testing.T) {
	const secret = "test-secret-at-least-32-characters-long-x"
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	blacklist := auth.NewBlacklist((&redisclient.Client{Client: rdb}).NewBlacklistAdapter(), false)
	authMw := auth.NewMiddleware(secret, blacklist)
	rc := &routeCtx{
		mux:             http.NewServeMux(),
		infra:           &serverInfra{db: &database.DB{}, rdb: &redisclient.Client{Client: rdb}},
		cfg:             &config.Config{JWTSecret: secret},
		authMw:          authMw,
		adminChain:      auth.RoleChain(authMw, auth.RoleAdmin, auth.RoleSuperAdmin),
		superadminChain: auth.RoleChain(authMw, auth.RoleSuperAdmin),
		apiKeyChain:     auth.RoleChain(authMw, auth.RoleAdmin, auth.RoleSuperAdmin, auth.RoleAPIUser),
	}
	registerAuthProviderRoutes(rc)

	routes := []struct{ method, path string }{
		{http.MethodGet, "/api/admin/auth-providers"},
		{http.MethodPost, "/api/admin/auth-providers"},
		{http.MethodPatch, "/api/admin/auth-providers/p-1"},
		{http.MethodDelete, "/api/admin/auth-providers/p-1"},
	}
	serve := func(method, path, role string) (code int, panicked bool) {
		defer func() {
			// No DB in this test: a request that gets past the chain reaches
			// the real store and panics on the nil pool.
			if recover() != nil {
				panicked = true
			}
		}()
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer "+mintJWT(t, secret, "u-"+role, role))
		rec := httptest.NewRecorder()
		rc.mux.ServeHTTP(rec, req)
		return rec.Code, false
	}

	for _, r := range routes {
		if code, panicked := serve(r.method, r.path, auth.RoleAdmin); panicked || code != http.StatusForbidden {
			t.Errorf("%s %s as admin: got %d (reached handler: %v), want 403", r.method, r.path, code, panicked)
		}
		if code, panicked := serve(r.method, r.path, auth.RoleSuperAdmin); !panicked && (code == http.StatusForbidden || code == http.StatusUnauthorized) {
			t.Errorf("%s %s as superadmin: rejected with %d, want it to reach the handler", r.method, r.path, code)
		}
	}
}
