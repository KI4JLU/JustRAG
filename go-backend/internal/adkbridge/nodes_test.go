package adkbridge

import (
	"slices"
	"testing"
)

func TestVisibleActionsFilterByRoleAllowlistAndPrivilege(t *testing.T) {
	acts := []Action{
		{ID: "web", Tool: "web_search", Label: "Web"},
		{ID: "conf", Tool: "confluence_import", Label: "Confluence"},
		{ID: "upload", FrontendTool: "upload_file", Label: "Upload"},
		{ID: "code", Tool: "code_exec", Label: "nope"},
	}
	allowed := []string{"web_search", "confluence_import", "code_exec"}
	for _, tc := range []struct {
		name string
		sc   Scope
		want []string
	}{
		// view role: no confluence_import (needs edit); AllowPrivileged shows code_exec.
		{"privileged", Scope{UserID: "u", KBID: "kb", Role: "view", AllowPrivileged: true}, []string{"web", "upload", "code"}},
		{"not_privileged", Scope{UserID: "u", KBID: "kb", Role: "view"}, []string{"web", "upload"}},
	} {
		var ids []string
		for _, a := range VisibleActions(tc.sc, acts, allowed) {
			ids = append(ids, a.ID)
		}
		if !slices.Equal(ids, tc.want) {
			t.Errorf("%s: offered %v, want %v", tc.name, ids, tc.want)
		}
	}
}
