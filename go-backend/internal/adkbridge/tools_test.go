package adkbridge

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"google.golang.org/adk/v2/session"
	"google.golang.org/adk/v2/tool"
	"google.golang.org/genai"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/chatpolicy"
	"github.com/justrag/go-backend/internal/mcp"
)

type recorder struct {
	kbID string
	args map[string]any
	n    int
}

func (r *recorder) dispatch(_ context.Context, kbID, _ string, args json.RawMessage) (mcp.ToolResult, error) {
	r.n++
	r.kbID = kbID
	_ = json.Unmarshal(args, &r.args)
	return mcp.ToolResult{Text: "ok"}, nil
}

func runWithScope(t *testing.T, sc Scope, turns [][]ai.StreamChunk, tools ...tool.Tool) {
	t.Helper()
	r := newRunner(t, &fakeClient{turns: turns}, tools, session.InMemoryService())
	ctx := WithScope(context.Background(), sc)
	for _, err := range r.Run(ctx, sc.UserID, "s1", genai.NewContentFromText("go", genai.RoleUser), runCfg()) {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestDispatchOverridesModelKBID(t *testing.T) {
	rec := &recorder{}
	search := NewTool(ToolSpec{Name: "kb_search", Policy: PolicyFor("kb_search")}, rec.dispatch)
	runWithScope(t, Scope{UserID: "u", KBID: "kb-mine", ChatID: "chat-1", Role: "view"},
		[][]ai.StreamChunk{toolTurn("c1", "kb_search", `{"query":"q","kb_id":"kb-victim","chat_id":"other"}`), textTurn("done")},
		search)
	if rec.n != 1 || rec.kbID != "kb-mine" || rec.args["kb_id"] != "kb-mine" || rec.args["chat_id"] != "chat-1" {
		t.Fatalf("n=%d dispatched kb=%q args=%v", rec.n, rec.kbID, rec.args)
	}
}

func TestDispatchWithoutScopeFails(t *testing.T) {
	rec := &recorder{}
	tl := NewTool(ToolSpec{Name: "kb_search", Policy: PolicyFor("kb_search")}, rec.dispatch).(*dispatchTool)
	if _, err := tl.dispatchChecked(context.Background(), map[string]any{"query": "q"}); err != ErrNoScope {
		t.Fatalf("err = %v", err)
	}
}

func TestRoleGateBlocksKBWriteForViewer(t *testing.T) {
	rec := &recorder{}
	imp := NewTool(ToolSpec{Name: "confluence_import", Policy: PolicyFor("confluence_import")}, rec.dispatch).(*dispatchTool)
	ctx := WithScope(context.Background(), Scope{UserID: "u", KBID: "kb", Role: "view"})
	if _, err := imp.dispatchChecked(ctx, map[string]any{"spaceKey": "X"}); err == nil || !strings.Contains(err.Error(), "requires role edit") {
		t.Fatalf("err = %v", err)
	}
	if rec.n != 0 {
		t.Fatal("dispatched despite role gate")
	}
}

func TestPrivilegedToolNeedsFlag(t *testing.T) {
	rec := &recorder{}
	ce := NewTool(ToolSpec{Name: "code_exec", Policy: PolicyFor("code_exec")}, rec.dispatch).(*dispatchTool)
	ctx := WithScope(context.Background(), Scope{UserID: "u", KBID: "kb", Role: "owner"})
	if _, err := ce.dispatchChecked(ctx, map[string]any{}); err == nil {
		t.Fatal("privileged tool ran without AllowPrivileged")
	}
	if rec.n != 0 {
		t.Fatal("dispatched despite privilege gate")
	}
}

func TestPolicyDefaults(t *testing.T) {
	for name, want := range map[string]ToolPolicy{
		"kb_search":         {SideEffect: SideEffectNone, RequiresRole: "view", Approval: ApprovalNever},
		"web_search":        {SideEffect: SideEffectExternalRead, RequiresRole: "view", Approval: ApprovalAlways},
		"confluence_import": {SideEffect: SideEffectKBWrite, RequiresRole: "edit", Approval: ApprovalAlways},
		"library_add_to_kb": {SideEffect: SideEffectKBWrite, RequiresRole: "edit", Approval: ApprovalAlways},
		"unknown_remote":    {SideEffect: SideEffectExternalWrite, RequiresRole: "edit", Approval: ApprovalAlways},
	} {
		if got := PolicyFor(name); got != want {
			t.Errorf("%s: got %+v want %+v", name, got, want)
		}
	}
}

func TestRoleAtLeast(t *testing.T) {
	cases := []struct {
		have, need string
		ok         bool
	}{{"view", "view", true}, {"view", "edit", false}, {"owner", "admin", true}, {"", "view", false}, {"bogus", "view", false}}
	for _, c := range cases {
		if RoleAtLeast(c.have, c.need) != c.ok {
			t.Errorf("RoleAtLeast(%q,%q) != %v", c.have, c.need, c.ok)
		}
	}
}

func TestRoleAtLeastFailsClosedOnUnknownNeed(t *testing.T) {
	if RoleAtLeast("owner", "") || RoleAtLeast("owner", "bogus") {
		t.Fatal("unknown need must never be met")
	}
}

func TestZeroPolicyDefaultsToPolicyFor(t *testing.T) {
	d := NewTool(ToolSpec{Name: "confluence_import"}, (&recorder{}).dispatch).(*dispatchTool)
	if d.spec.Policy != PolicyFor("confluence_import") {
		t.Fatalf("policy = %+v", d.spec.Policy)
	}
}

func TestToolWithoutPolicyStillRequestsApproval(t *testing.T) {
	rec := &recorder{}
	imp := NewTool(ToolSpec{Name: "confluence_import"}, rec.dispatch)
	runWithScope(t, Scope{UserID: "u", KBID: "kb", Role: "owner"},
		[][]ai.StreamChunk{toolTurn("c1", "confluence_import", `{"spaceKey":"X"}`), textTurn("done")}, imp)
	if rec.n != 0 {
		t.Fatal("dispatched without approval")
	}
}

func TestUnknownApprovalValueTreatedAsAlways(t *testing.T) {
	rec := &recorder{}
	tl := NewTool(ToolSpec{Name: "x", Policy: ToolPolicy{SideEffect: SideEffectNone, RequiresRole: "view", Approval: "bogus"}}, rec.dispatch)
	runWithScope(t, Scope{UserID: "u", KBID: "kb", Role: "owner"},
		[][]ai.StreamChunk{toolTurn("c1", "x", `{}`), textTurn("done")}, tl)
	if rec.n != 0 {
		t.Fatal("dispatched despite unrecognised approval value")
	}
}

// plannedKBWriteTools have policies but are not registered built-ins yet.
var plannedKBWriteTools = map[string]bool{"confluence_import": true, "library_add_to_kb": true}

// TestBuiltinPoliciesCoverKnownTools pins builtinPolicies against
// chatpolicy.KnownAnswerTools, which internal/mcp/builtin's cross-check test
// pins against the real registry (both directions). Going through chatpolicy
// avoids importing internal/chat or internal/app.
func TestBuiltinPoliciesCoverKnownTools(t *testing.T) {
	known := map[string]bool{}
	for _, n := range chatpolicy.KnownAnswerTools {
		known[n] = true
		if _, ok := builtinPolicies[n]; !ok {
			t.Errorf("built-in %q has no entry in builtinPolicies", n)
		}
	}
	for n := range builtinPolicies {
		if !known[n] && !plannedKBWriteTools[n] {
			t.Errorf("builtinPolicies key %q names no built-in tool", n)
		}
	}
}
