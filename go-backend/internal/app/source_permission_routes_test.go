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
//   - kbSourceListChain (viewer_/editor_see_sources): the sidebar source
//     lists.
//   - kbSourceDownloadChain (viewer_/editor_download_sources): the
//     spreadsheet source preview, both routes.
//   - kbManageSourcesChain (role only, edit and above): every add / change /
//     sync / delete / retry route, plus from-library (it adds sources).
//
// GET /api/files/{id}/download, DELETE /api/files/{id} and
// POST /api/files/{id}/retry have no {id} KB in the path; their gates are
// handler-internal and pinned in internal/files.
var sourceGateRoutes = map[string]string{
	"GET /api/kb/{id}/files":                "kbSourceListChain",
	"GET /api/kb/{id}/rss":                  "kbSourceListChain",
	"GET /api/kb/{id}/confluence-sources":   "kbSourceListChain",
	"GET /api/kb/{id}/git-repos":            "kbSourceListChain",
	"GET /api/kb/{id}/crawl/status/{jobId}": "kbSourceListChain",

	"GET /api/kb/{id}/files/{fileId}/tabular":      "kbSourceDownloadChain",
	"GET /api/kb/{id}/files/{fileId}/tabular/rows": "kbSourceDownloadChain",

	"POST /api/kb/{id}/files":                              "kbManageSourcesChain",
	"POST /api/kb/{id}/files/from-library":                 "kbManageSourcesChain",
	"POST /api/kb/{id}/files/retry-failed":                 "kbManageSourcesChain",
	"POST /api/kb/{id}/add-sources":                        "kbManageSourcesChain",
	"POST /api/kb/{id}/fetch-url":                          "kbManageSourcesChain",
	"POST /api/kb/{id}/text":                               "kbManageSourcesChain",
	"POST /api/kb/{id}/crawl":                              "kbManageSourcesChain",
	"POST /api/kb/{id}/rss":                                "kbManageSourcesChain",
	"PATCH /api/kb/{id}/rss/{feedId}":                      "kbManageSourcesChain",
	"DELETE /api/kb/{id}/rss/{feedId}":                     "kbManageSourcesChain",
	"POST /api/kb/{id}/rss/{feedId}/poll":                  "kbManageSourcesChain",
	"POST /api/kb/{id}/confluence-sources":                 "kbManageSourcesChain",
	"PATCH /api/kb/{id}/confluence-sources/{sourceId}":     "kbManageSourcesChain",
	"DELETE /api/kb/{id}/confluence-sources/{sourceId}":    "kbManageSourcesChain",
	"POST /api/kb/{id}/confluence-sources/{sourceId}/sync": "kbManageSourcesChain",
	"POST /api/kb/{id}/git-repos":                          "kbManageSourcesChain",
	"PATCH /api/kb/{id}/git-repos/{sourceId}":              "kbManageSourcesChain",
	"DELETE /api/kb/{id}/git-repos/{sourceId}":             "kbManageSourcesChain",
	"POST /api/kb/{id}/git-repos/{sourceId}/sync":          "kbManageSourcesChain",
}

// TestSourceRoutesAreOnTheirGateChain reads routes.go's actual registrations
// (routeChains) and compares each against sourceGateRoutes. It also fails
// when a route not in the table lands on one of the three chains, so the
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
		if strings.HasPrefix(chain, "kbSource") || chain == "kbManageSourcesChain" {
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
	"kbManageSourcesChain":  manageSourcesInner,
}

// allFlagsOn turns every source flag on.
var allFlagsOn = kbaccess.SourcePermissions{
	ViewerSeeSources: true, ViewerSelectSources: true, ViewerDownloadSources: true,
	ViewerSeeCitations: true, EditorSeeSources: true, EditorSelectSources: true,
	EditorDownloadSources: true, EditorSeeCitations: true,
}

// governingFlag returns a SourcePermissions with only the flag that governs
// chain for role switched to on — or every flag on except that one when on
// is false, so a test of "flag off" cannot pass because some other flag
// happened to be off too. In particular "off" leaves the OTHER role's flag
// for the same capability on, so a gate that read the wrong role's column
// fails.
func governingFlag(chain, role string, on bool) kbaccess.SourcePermissions {
	p := allFlagsOn
	if on {
		p = kbaccess.SourcePermissions{}
	}
	switch chain + "/" + role {
	case "kbSourceListChain/view":
		p.ViewerSeeSources = on
	case "kbSourceListChain/edit":
		p.EditorSeeSources = on
	case "kbSourceDownloadChain/view":
		p.ViewerDownloadSources = on
	case "kbSourceDownloadChain/edit":
		p.EditorDownloadSources = on
	}
	return p
}

// TestSourceGatePerRoute is the route test per gate: for every gated route,
// the chain routes.go mounts it on is run with a viewer and an editor, each
// with its governing flag on and off — the TestRetryForbiddenWithoutEdit
// pattern lifted to the middleware level. The caller's role comes from a
// kb_members row through the real RequireKBRole/EffectiveRole.
//
// Oracle: the expected status per (gate, caller, flag), written by hand from
// the spec:
//   - list/download gates: a viewer passes only with its viewer_* flag on,
//     an editor only with its editor_* flag on.
//   - manage gate: no flag applies. A viewer never passes, even with every
//     flag on; an editor always passes, even with every flag off.
func TestSourceGatePerRoute(t *testing.T) {
	want := map[string]map[string]int{ // chain -> "role/flags" -> status
		"kbSourceListChain": {
			"view/on": 200, "view/off": 403, "edit/on": 200, "edit/off": 403,
		},
		"kbSourceDownloadChain": {
			"view/on": 200, "view/off": 403, "edit/on": 200, "edit/off": 403,
		},
		"kbManageSourcesChain": {
			"view/all-flags": 403, "view/no-flags": 403, "edit/all-flags": 200, "edit/no-flags": 200,
		},
	}
	chains := routeChains(t)
	for pattern, chain := range sourceGateRoutes {
		if chains[pattern] != chain {
			continue // reported by TestSourceRoutesAreOnTheirGateChain
		}
		method, path, _ := strings.Cut(pattern, " ")
		for key, wantCode := range want[chain] {
			role, flagState, _ := strings.Cut(key, "/")
			var flags kbaccess.SourcePermissions
			switch flagState {
			case "all-flags":
				flags = allFlagsOn
			case "no-flags":
				flags = kbaccess.SourcePermissions{}
			default:
				flags = governingFlag(chain, role, flagState == "on")
			}
			t.Run(pattern+"/"+key, func(t *testing.T) {
				kbMw := kbaccess.NewMiddleware(kbStoreStub{
					kb:   &kbaccess.KnowledgeBase{ID: "kb1", Sources: flags},
					role: role,
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
				if rec.Code != wantCode {
					t.Fatalf("status %d, want %d", rec.Code, wantCode)
				}
				if called != (wantCode == http.StatusOK) {
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
