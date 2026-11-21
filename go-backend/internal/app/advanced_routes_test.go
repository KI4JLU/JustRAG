package app

import (
	"os"
	"regexp"
	"testing"
)

// The chain-composition tests in kbadmin_chain_test.go prove that
// kbAdvancedChain refuses a plain user. They cannot prove that the advanced
// surface is actually MOUNTED on it — they rebuild the chain rather than read
// the route table, so moving a route back to kbAdminChain in routes.go leaves
// them green. That is exactly the regression this file guards.
//
// Reading the source is deliberate. The alternative, standing up the real mux,
// needs the full infra dependency tree (Postgres pools, Redis, Asynq, an AI
// resolver) that NewServer wires, which is not available in a unit test. The
// route table is a flat list of literal calls, so a regex over it is exact
// rather than approximate: every registration in routes.go has the shape
// rc.mux.Handle("<METHOD> <PATH>", rc.<chain>(<handler>)).
var routeRe = regexp.MustCompile(`rc\.mux\.Handle\("([A-Z]+ [^"]+)",\s*rc\.(\w+)\(`)

func routeChains(t *testing.T) map[string]string {
	t.Helper()
	src, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}
	matches := routeRe.FindAllStringSubmatch(string(src), -1)
	// Sanity floor: if the regex ever stops matching the file's shape it
	// would silently return an empty map and every assertion below would
	// pass vacuously. routes.go registers on the order of a hundred routes.
	if len(matches) < 100 {
		t.Fatalf("routeChains matched only %d routes in routes.go — the regex no longer fits the file", len(matches))
	}
	out := make(map[string]string, len(matches))
	for _, m := range matches {
		out[m[1]] = m[2]
	}
	return out
}

// advancedRoutes is the KB "advanced settings" surface: every endpoint
// KbSettingsPanel's tabs call, plus the per-KB re-embed sweep its Save
// flow offers. All of them require the system role admin (or superadmin), on
// every KB.
var advancedRoutes = []string{
	// RAG Settings tab — the 52-key per-KB site_config registry.
	"GET /api/kb/{id}/settings",
	"PUT /api/kb/{id}/settings",
	"DELETE /api/kb/{id}/settings/{key}",
	// The re-ingest the settings Save flow offers after a requiresReingest
	// key changes. Its only caller is that flow.
	"POST /api/kb/{id}/reembed",
	// Workflow tab — projection, preset preview, preset apply.
	"GET /api/kb/{id}/workflow",
	"GET /api/kb/{id}/workflow/preset",
	"POST /api/kb/{id}/workflow/preset",
	// Evals tab.
	"GET /api/kb/{id}/eval/golden-sets",
	"POST /api/kb/{id}/eval/golden-sets",
	"POST /api/kb/{id}/eval/golden-sets/generate",
	"GET /api/kb/{id}/eval/golden-sets/jobs",
	"GET /api/kb/{id}/eval/golden-sets/{gsId}",
	"DELETE /api/kb/{id}/eval/golden-sets/{gsId}",
	"POST /api/kb/{id}/eval/runs",
	"GET /api/kb/{id}/eval/runs",
	"GET /api/kb/{id}/eval/runs/{runId}",
	"GET /api/kb/{id}/eval/runs/{runId}/export",
	"DELETE /api/kb/{id}/eval/runs/{runId}",
}

func TestAdvancedSurfaceIsOnKbAdvancedChain(t *testing.T) {
	chains := routeChains(t)
	for _, pattern := range advancedRoutes {
		got, ok := chains[pattern]
		if !ok {
			t.Errorf("%s is not registered in routes.go — if it was renamed, move the new pattern onto kbAdvancedChain and update this list", pattern)
			continue
		}
		if got != "kbAdvancedChain" {
			t.Errorf("%s is on rc.%s, want rc.kbAdvancedChain — this route is part of the KB advanced settings surface and must require the system role admin (or superadmin)", pattern, got)
		}
	}
}

// TestNoAgentTeamRoutes pins the removal of the user-created agents and
// teams: none of their routes may come back by accident. Oracle: the route
// table in routes.go.
func TestNoAgentTeamRoutes(t *testing.T) {
	agentRoute := regexp.MustCompile(`^[A-Z]+ /api/(agents|agent-teams)(/|$)|^[A-Z]+ /api/kb/\{id\}/(agents|teams)(/|$)`)
	for pattern := range routeChains(t) {
		if agentRoute.MatchString(pattern) {
			t.Errorf("%s is registered — the agents and teams routes were removed", pattern)
		}
	}
}
