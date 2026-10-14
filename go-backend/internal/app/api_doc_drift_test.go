package app

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/contentgen"
)

// apiDocPath is the repository-root API.md, the route reference the
// frontend developer works from.
const apiDocPath = "../../../API.md"

// handleRe matches a route registration with a literal "METHOD /path"
// pattern. The optional tail catches the one computed pattern, the text
// artifact loop in registerContentRoutes ("…/generate/"+spec.Type).
var handleRe = regexp.MustCompile(`\.Handle(?:Func)?\(\s*"([A-Z]+) (/[^"]*)"(\s*\+\s*spec\.Type)?`)

// docRowRe matches a route-table row in API.md: | METHOD | `path` | ….
var docRowRe = regexp.MustCompile("^\\|\\s*([A-Z]+)\\s*\\|\\s*`([^`]+)`")

// docBaseRe matches the line that sets a section's path prefix.
var docBaseRe = regexp.MustCompile("routes below are under `(/[^`]*)`")

var pathParamRe = regexp.MustCompile(`\{[^}]+\}`)

// routesNotInAPIDoc are registered patterns API.md deliberately does not
// list as such.
var routesNotInAPIDoc = map[string]string{
	"GET /": "serves the single-page frontend itself",
	// One ServeMux pattern dispatched at request time
	// (dispatchResearchAction); API.md lists the three real routes.
	"GET /api/research/{}/{}": "documented as its expansions",
}

// docOnlyRoutes are API.md entries served by a dispatcher pattern rather
// than a registration of their own.
var docOnlyRoutes = []string{
	"GET /api/research/{}/status",
	"GET /api/research/{}/report",
	"GET /api/research/deep/{}",
}

func normalizeRoute(method, path string) string {
	if i := strings.IndexByte(path, '?'); i >= 0 {
		path = path[:i]
	}
	path = strings.ReplaceAll(path, "{$}", "")
	if len(path) > 1 {
		path = strings.TrimSuffix(path, "/")
	}
	return method + " " + pathParamRe.ReplaceAllString(path, "{}")
}

// registeredRoutes reads every route pattern registered in this package's
// non-test sources. The pprof server (/debug/pprof/*) is a separate
// listener, not part of the HTTP API.
func registeredRoutes(t *testing.T) map[string]bool {
	t.Helper()
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range handleRe.FindAllStringSubmatch(string(src), -1) {
			method, path := m[1], m[2]
			if strings.HasPrefix(path, "/debug/") {
				continue
			}
			if m[3] != "" {
				for _, spec := range contentgen.TextArtifacts {
					out[normalizeRoute(method, path+spec.Type)] = true
				}
				continue
			}
			out[normalizeRoute(method, path)] = true
		}
	}
	return out
}

// documentedRoutes reads API.md's route tables, prefixing each path with
// its section's base ("All routes below are under `/api`.").
func documentedRoutes(t *testing.T) map[string]bool {
	t.Helper()
	doc, err := os.ReadFile(apiDocPath)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	base := ""
	for _, line := range strings.Split(string(doc), "\n") {
		if strings.HasPrefix(line, "## ") {
			base = ""
		}
		if m := docBaseRe.FindStringSubmatch(line); m != nil {
			base = m[1]
		}
		m := docRowRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		path := m[2]
		if base != "" && path != base && !strings.HasPrefix(path, base+"/") {
			path = base + path
		}
		out[normalizeRoute(m[1], path)] = true
	}
	return out
}

// TestAPIDocListsEveryRoute keeps API.md in step with the router: every
// registered route has a table row, and every row names a real route.
func TestAPIDocListsEveryRoute(t *testing.T) {
	code := registeredRoutes(t)
	doc := documentedRoutes(t)
	if len(code) < 100 || len(doc) < 100 {
		t.Fatalf("parsed %d registered and %d documented routes; the parser no longer matches the sources", len(code), len(doc))
	}

	var undocumented, stale []string
	for r := range code {
		if _, skip := routesNotInAPIDoc[r]; !skip && !doc[r] {
			undocumented = append(undocumented, r)
		}
	}
	for r := range doc {
		if !code[r] && !slices.Contains(docOnlyRoutes, r) {
			stale = append(stale, r)
		}
	}
	slices.Sort(undocumented)
	slices.Sort(stale)
	if len(undocumented) > 0 {
		t.Errorf("%d registered routes have no row in API.md (add them to the matching section):\n  %s",
			len(undocumented), strings.Join(undocumented, "\n  "))
	}
	if len(stale) > 0 {
		t.Errorf("%d API.md rows name no registered route (removed or renamed?):\n  %s",
			len(stale), strings.Join(stale, "\n  "))
	}
}
