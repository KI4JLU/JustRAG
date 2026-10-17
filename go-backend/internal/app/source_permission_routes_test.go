package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// sourceGateRoutes is the gate table of the per-KB source permissions,
// written out by hand from the spec: which {id} route sits behind which
// capability. It is the oracle for the mount points below.
//
//   - kbSourceListChain (seeSources): the sidebar source lists.
//   - kbSourceDownloadChain (downloadSources): the spreadsheet source
//     preview, both routes.
//   - kbAddSourcesChain (addSources, gated at edit): every route that
//     creates a source.
//   - kbManageSourcesChain (manageSources, gated at edit): every change /
//     sync / poll / delete / retry route.
//
// GET /api/files/{id}/download, DELETE /api/files/{id} and
// POST /api/files/{id}/retry have no {id} KB in the path; their gates are
// handler-internal and pinned in internal/files. POST
// /api/academic-research/{researchId}/papers/add carries its KB in the body
// and is pinned in internal/academic.
var sourceGateRoutes = map[string]string{
	"GET /api/kb/{id}/files":                "kbSourceListChain",
	"GET /api/kb/{id}/rss":                  "kbSourceListChain",
	"GET /api/kb/{id}/confluence-sources":   "kbSourceListChain",
	"GET /api/kb/{id}/git-repos":            "kbSourceListChain",
	"GET /api/kb/{id}/crawl/status/{jobId}": "kbSourceListChain",

	"GET /api/kb/{id}/files/{fileId}/tabular":      "kbSourceDownloadChain",
	"GET /api/kb/{id}/files/{fileId}/tabular/rows": "kbSourceDownloadChain",

	"POST /api/kb/{id}/files":              "kbAddSourcesChain",
	"POST /api/kb/{id}/files/from-library": "kbAddSourcesChain",
	"POST /api/kb/{id}/add-sources":        "kbAddSourcesChain",
	"POST /api/kb/{id}/fetch-url":          "kbAddSourcesChain",
	"POST /api/kb/{id}/text":               "kbAddSourcesChain",
	"POST /api/kb/{id}/crawl":              "kbAddSourcesChain",
	"POST /api/kb/{id}/rss":                "kbAddSourcesChain",
	"POST /api/kb/{id}/confluence-sources": "kbAddSourcesChain",
	"POST /api/kb/{id}/git-repos":          "kbAddSourcesChain",

	"POST /api/kb/{id}/files/retry-failed":                 "kbManageSourcesChain",
	"PATCH /api/kb/{id}/rss/{feedId}":                      "kbManageSourcesChain",
	"DELETE /api/kb/{id}/rss/{feedId}":                     "kbManageSourcesChain",
	"POST /api/kb/{id}/rss/{feedId}/poll":                  "kbManageSourcesChain",
	"PATCH /api/kb/{id}/confluence-sources/{sourceId}":     "kbManageSourcesChain",
	"DELETE /api/kb/{id}/confluence-sources/{sourceId}":    "kbManageSourcesChain",
	"POST /api/kb/{id}/confluence-sources/{sourceId}/sync": "kbManageSourcesChain",
	"PATCH /api/kb/{id}/git-repos/{sourceId}":              "kbManageSourcesChain",
	"DELETE /api/kb/{id}/git-repos/{sourceId}":             "kbManageSourcesChain",
	"POST /api/kb/{id}/git-repos/{sourceId}/sync":          "kbManageSourcesChain",
}

// TestSourceRoutesAreOnTheirGateChain reads routes.go's actual registrations
// (routeChains) and compares each against sourceGateRoutes. It also fails
// when a route not in the table lands on one of the four chains, so the
// table and routes.go cannot drift apart in either direction.
func TestSourceRoutesAreOnTheirGateChain(t *testing.T) {
	chains := routeChains(t)
	for pattern, want := range sourceGateRoutes {
		got, ok := chains[pattern]
		if !ok {
			t.Errorf("%s is not registered in routes.go", pattern)
			continue
		}
		if got != want {
			t.Errorf("%s is on rc.%s, want rc.%s", pattern, got, want)
		}
	}
	for pattern, chain := range chains {
		if strings.HasPrefix(chain, "kbSource") || chain == "kbAddSourcesChain" || chain == "kbManageSourcesChain" {
			if _, ok := sourceGateRoutes[pattern]; !ok {
				t.Errorf("%s is on rc.%s but not in sourceGateRoutes — add it to the gate table (and API.md)", pattern, chain)
			}
		}
	}
}

// gateInner maps a chain name to THE production composition routes.go
// installs for it (minus Authenticate, which the tests replace by injecting
// the user), so the per-route test below runs exactly what the route runs.
var gateInner = map[string]func(*kbaccess.Middleware) func(http.HandlerFunc) http.Handler{
	"kbSourceListChain":     sourceListInner,
	"kbSourceDownloadChain": sourceDownloadInner,
	"kbAddSourcesChain":     addSourcesInner,
	"kbManageSourcesChain":  manageSourcesInner,
}

// allFlagsOn turns every source flag on.
var allFlagsOn = kbaccess.SourcePermissions{
	ViewerSeeSources: true, ViewerDownloadSources: true, ViewerSeeCitations: true,
	EditorSeeSources: true, EditorAddSources: true, EditorDownloadSources: true,
	EditorSeeCitations: true,
}

// only returns a SourcePermissions with exactly the named flags on; allBut
// returns every flag on except the named ones, so a "flag off" case cannot
// pass because some unrelated flag happened to be off too — in particular
// it leaves the OTHER role's flags on, so a gate that read the wrong role's
// column fails.
func only(set func(*kbaccess.SourcePermissions)) kbaccess.SourcePermissions {
	var p kbaccess.SourcePermissions
	set(&p)
	return p
}

func allBut(clear func(*kbaccess.SourcePermissions)) kbaccess.SourcePermissions {
	p := allFlagsOn
	clear(&p)
	return p
}

// gateCase is one row of the per-route spec table.
type gateCase struct {
	label string
	role  string
	flags kbaccess.SourcePermissions
	want  int
}

// gateSpec is the expected status per (gate, caller, flags), written by
// hand from the spec (Sten, 2026-10-16):
//   - list: a viewer passes only with viewer_see_sources, an editor only
//     with editor_see_sources.
//   - download (level 2 of the pyramid): the role's own flag AND its see
//     flag; either off refuses.
//   - add: a viewer never, even with every flag on ("that would be a
//     promotion to editor"); an editor with editor_see_sources AND
//     editor_add_sources.
//   - manage ("edit sources", fixed by role): a viewer never, even with
//     every flag on; an editor exactly when editor_see_sources is on.
var gateSpec = map[string][]gateCase{
	"kbSourceListChain": {
		{"view/see-on", kbaccess.RoleView, only(func(p *kbaccess.SourcePermissions) { p.ViewerSeeSources = true }), 200},
		{"view/see-off", kbaccess.RoleView, allBut(func(p *kbaccess.SourcePermissions) { p.ViewerSeeSources = false }), 403},
		{"edit/see-on", kbaccess.RoleEdit, only(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources = true }), 200},
		{"edit/see-off", kbaccess.RoleEdit, allBut(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources = false }), 403},
	},
	"kbSourceDownloadChain": {
		{"view/see+download", kbaccess.RoleView, only(func(p *kbaccess.SourcePermissions) { p.ViewerSeeSources, p.ViewerDownloadSources = true, true }), 200},
		{"view/download-off", kbaccess.RoleView, allBut(func(p *kbaccess.SourcePermissions) { p.ViewerDownloadSources = false }), 403},
		{"view/download-on-see-off", kbaccess.RoleView, allBut(func(p *kbaccess.SourcePermissions) { p.ViewerSeeSources = false }), 403},
		{"edit/see+download", kbaccess.RoleEdit, only(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources, p.EditorDownloadSources = true, true }), 200},
		{"edit/download-off", kbaccess.RoleEdit, allBut(func(p *kbaccess.SourcePermissions) { p.EditorDownloadSources = false }), 403},
		{"edit/download-on-see-off", kbaccess.RoleEdit, allBut(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources = false }), 403},
	},
	"kbAddSourcesChain": {
		{"view/all-flags", kbaccess.RoleView, allFlagsOn, 403},
		{"view/no-flags", kbaccess.RoleView, kbaccess.SourcePermissions{}, 403},
		{"edit/see+add", kbaccess.RoleEdit, only(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources, p.EditorAddSources = true, true }), 200},
		{"edit/add-off", kbaccess.RoleEdit, allBut(func(p *kbaccess.SourcePermissions) { p.EditorAddSources = false }), 403},
		{"edit/add-on-see-off", kbaccess.RoleEdit, allBut(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources = false }), 403},
	},
	"kbManageSourcesChain": {
		{"view/all-flags", kbaccess.RoleView, allFlagsOn, 403},
		{"view/no-flags", kbaccess.RoleView, kbaccess.SourcePermissions{}, 403},
		{"edit/see-only", kbaccess.RoleEdit, only(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources = true }), 200},
		{"edit/see-off-add-on", kbaccess.RoleEdit, allBut(func(p *kbaccess.SourcePermissions) { p.EditorSeeSources = false }), 403},
		{"edit/no-flags", kbaccess.RoleEdit, kbaccess.SourcePermissions{}, 403},
	},
}

// TestSourceGatePerRoute is the route test per gate: for every gated route,
// the chain routes.go mounts it on is run with every gateSpec case — the
// TestRetryForbiddenWithoutEdit pattern lifted to the middleware level. The
// caller's role comes from a kb_members row through the real
// RequireKBRole/EffectiveRole.
//
// Oracle: gateSpec (hand-written from the spec) and a handler-called flag,
// so a refusal provably never reaches the handler — no add route can run
// its side effects behind a 403.
func TestSourceGatePerRoute(t *testing.T) {
	chains := routeChains(t)
	for pattern, chain := range sourceGateRoutes {
		if chains[pattern] != chain {
			continue // reported by TestSourceRoutesAreOnTheirGateChain
		}
		method, path, _ := strings.Cut(pattern, " ")
		for _, tc := range gateSpec[chain] {
			t.Run(pattern+"/"+tc.label, func(t *testing.T) {
				kbMw := kbaccess.NewMiddleware(kbStoreStub{
					kb:   &kbaccess.KnowledgeBase{ID: "kb1", Sources: tc.flags},
					role: tc.role,
				})
				called := false
				h := gateInner[chain](kbMw)(func(w http.ResponseWriter, _ *http.Request) {
					called = true
					w.WriteHeader(http.StatusOK)
				})
				req := httptest.NewRequest(method, strings.ReplaceAll(path, "{id}", "kb1"), nil)
				req.SetPathValue("id", "kb1")
				req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "u1", Role: auth.RoleUser}))
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, req)
				if rec.Code != tc.want {
					t.Fatalf("status %d, want %d", rec.Code, tc.want)
				}
				if called != (tc.want == http.StatusOK) {
					t.Fatalf("handler called = %v with status %d", called, rec.Code)
				}
			})
		}
	}
}

// TestSourceGateAdminsAndImplicitViewers covers the callers without a
// kb_members row of their own, on a published public KB with every flag
// off: a system admin (rule 3 → KB admin) passes every gate, an implicit
// viewer (rule 4) and an api-user — whose system role adds no KB rights —
// pass none of them.
//
// Oracle: the spec sentences "a global-KB system admin always has every
// capability" and "the api-user system role governs only use of the outgoing
// API", written as status codes.
func TestSourceGateAdminsAndImplicitViewers(t *testing.T) {
	cases := []struct {
		sysRole string
		want    int
	}{
		{auth.RoleAdmin, http.StatusOK},
		{auth.RoleSuperAdmin, http.StatusOK},
		{auth.RoleUser, http.StatusForbidden},
		{auth.RoleAPIUser, http.StatusForbidden},
	}
	for chain, inner := range gateInner {
		for _, c := range cases {
			t.Run(chain+"/"+c.sysRole, func(t *testing.T) {
				kbMw := kbaccess.NewMiddleware(kbStoreStub{
					kb: &kbaccess.KnowledgeBase{ID: "kb1", IsGlobal: true, IsPublished: true},
				})
				h := inner(kbMw)(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
				req := httptest.NewRequest(http.MethodGet, "/api/kb/kb1/files", nil)
				req.SetPathValue("id", "kb1")
				req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: "u1", Role: c.sysRole}))
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, req)
				if rec.Code != c.want {
					t.Fatalf("status %d, want %d", rec.Code, c.want)
				}
			})
		}
	}
}
