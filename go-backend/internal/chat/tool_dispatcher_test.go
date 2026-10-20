package chat

import (
	"encoding/json"
	"testing"

	"github.com/justrag/go-backend/internal/mcp"
)

// TestAnswerToolCatalog_ExcludesCodeExec verifies the answer-time catalog
// contains every built-in tool except code_exec.
func TestAnswerToolCatalog_ExcludesCodeExec(t *testing.T) {
	reg := mcp.NewRegistry()
	reg.RegisterBuiltin(mcp.Tool{Name: "calculator", Description: "math",
		InputSchema: json.RawMessage(`{"type":"object"}`)})
	reg.RegisterBuiltin(mcp.Tool{Name: "code_exec", Description: "exec",
		InputSchema: json.RawMessage(`{"type":"object"}`)})
	reg.RegisterBuiltin(mcp.Tool{Name: "kb_search", Description: "rag",
		InputSchema: json.RawMessage(`{"type":"object"}`)})
	d := &MCPDispatcher{Registry: reg}

	catalog := d.AnswerToolCatalog("kb-1")

	names := map[string]bool{}
	for _, tool := range catalog {
		names[tool.Function.Name] = true
		if tool.Type != "function" {
			t.Errorf("tool %s: type=%q want function", tool.Function.Name, tool.Type)
		}
		if tool.Function.Description == "" {
			t.Errorf("tool %s: description empty", tool.Function.Name)
		}
		if len(tool.Function.Parameters) == 0 {
			t.Errorf("tool %s: parameters empty", tool.Function.Name)
		}
	}
	if names["code_exec"] {
		t.Errorf("code_exec must not appear in the answer catalog")
	}
	if !names["calculator"] {
		t.Errorf("calculator missing from catalog: %+v", names)
	}
	if !names["kb_search"] {
		t.Errorf("kb_search missing from catalog: %+v", names)
	}
}

// TestAnswerToolCatalog_NilDispatcher tolerates a nil receiver — the
// handler wiring builds the catalog before checking the gate, and a nil
// dispatcher is a valid state in tests without MCP wiring.
func TestAnswerToolCatalog_NilDispatcher(t *testing.T) {
	var d *MCPDispatcher
	if got := d.AnswerToolCatalog("kb-1"); got != nil {
		t.Fatalf("nil dispatcher should return nil, got %+v", got)
	}
}

// TestAnswerToolCatalog_NilRegistry covers the second nil-guard branch:
// dispatcher is non-nil but its Registry field is unset. http_send.go
// wiring can construct an MCPDispatcher before the registry is plumbed
// in tests; the catalog method must not panic.
func TestAnswerToolCatalog_NilRegistry(t *testing.T) {
	d := &MCPDispatcher{Registry: nil}
	if got := d.AnswerToolCatalog("kb-1"); got != nil {
		t.Fatalf("nil registry should return nil, got %+v", got)
	}
}

// TestAnswerToolCatalog_EmptyRegistry returns an empty (non-nil-OK) slice.
func TestAnswerToolCatalog_EmptyRegistry(t *testing.T) {
	d := &MCPDispatcher{Registry: mcp.NewRegistry()}
	catalog := d.AnswerToolCatalog("kb-1")
	if catalog == nil {
		t.Fatal("empty registry: expected non-nil slice, got nil")
	}
	if len(catalog) != 0 {
		t.Fatalf("empty registry: got %d tools, want 0", len(catalog))
	}
}

// TestCatalogs_HideSQLQueryUnlessEnabled: sql_query refuses every call while
// the global-only chat_sql_query_enabled is off (its default), so neither the
// planner nor the answer model may be offered it — the tool-aware planner
// prompt names it for meta-questions, which would burn a plan step or an
// answer-tool round on a guaranteed error. No reader reads as off.
func TestCatalogs_HideSQLQueryUnlessEnabled(t *testing.T) {
	newDisp := func(reader SiteConfigReader) *MCPDispatcher {
		reg := mcp.NewRegistry()
		for _, name := range []string{"sql_query", "kb_search"} {
			reg.RegisterBuiltin(mcp.Tool{Name: name, Description: name,
				InputSchema: json.RawMessage(`{"type":"object"}`)})
		}
		d := NewMCPDispatcher(reg)
		d.SiteConfig = reader
		return d
	}
	listed := func(d *MCPDispatcher) (answer, plan map[string]bool) {
		answer, plan = map[string]bool{}, map[string]bool{}
		for _, tool := range d.AnswerToolCatalog("kb-1") {
			answer[tool.Function.Name] = true
		}
		for _, e := range d.PlanToolCatalog("kb-1") {
			plan[e.Name] = true
		}
		return answer, plan
	}

	for name, reader := range map[string]SiteConfigReader{
		"no reader":  nil,
		"flag off":   mapSiteConfig{"chat_sql_query_enabled": "false"},
		"flag unset": mapSiteConfig{},
	} {
		answer, plan := listed(newDisp(reader))
		if answer["sql_query"] || plan["sql_query"] {
			t.Errorf("%s: sql_query listed (answer=%v plan=%v)", name, answer, plan)
		}
		if !answer["kb_search"] || !plan["kb_search"] {
			t.Errorf("%s: kb_search missing (answer=%v plan=%v)", name, answer, plan)
		}
	}

	answer, plan := listed(newDisp(mapSiteConfig{"chat_sql_query_enabled": "true"}))
	if !answer["sql_query"] || !plan["sql_query"] {
		t.Errorf("flag on: sql_query must be listed (answer=%v plan=%v)", answer, plan)
	}
}
