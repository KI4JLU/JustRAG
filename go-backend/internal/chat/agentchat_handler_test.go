package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/types"

	"github.com/justrag/go-backend/internal/adkbridge"
	"github.com/justrag/go-backend/internal/mcp"
	"github.com/justrag/go-backend/internal/sessionmem"
)

func TestAgentChatPropsOf(t *testing.T) {
	cases := []struct {
		body            string
		reasoning, lang string
	}{
		{`{"forwardedProps":{"reasoning":"high","language":"en"}}`, "high", "en"},
		{`{"forwarded_props":{"reasoning":"low"}}`, "low", "de"},
		{`{"forwardedProps":{"reasoning":"max","language":"fr"}}`, "", "de"},
		{`{"forwardedProps":{"reasoning":true}}`, "", "de"},
		{`{"forwardedProps":"medium"}`, "", "de"},
		{`{}`, "", "de"},
	}
	for _, c := range cases {
		var in types.RunAgentInput
		if err := json.Unmarshal([]byte(c.body), &in); err != nil {
			t.Fatalf("%s: %v", c.body, err)
		}
		got := agentChatPropsOf(&in)
		if got.reasoning != c.reasoning || got.language != c.lang {
			t.Errorf("%s: got %+v, want reasoning %q language %q", c.body, got, c.reasoning, c.lang)
		}
	}
}

// Ruling P2-R15: the answer agent gets only approval-free tools. A tool
// confirmation inside the workflow's answer node cannot be resumed (ADK
// v2.5.0), so web_search — and any approval-always or unknown tool — must
// not be offered even when registered.
func TestAnswerToolsAreApprovalFree(t *testing.T) {
	reg := mcp.NewRegistry()
	noop := mcp.ToolHandlerFunc(func(context.Context, json.RawMessage) (mcp.ToolResult, error) { return mcp.ToolResult{}, nil })
	schema := json.RawMessage(`{"type":"object"}`)
	for _, n := range []string{"web_search", "memory_read", "memory_write"} {
		reg.RegisterBuiltin(mcp.Tool{Name: n, Description: n, InputSchema: schema, Handler: noop})
	}
	h := NewAgentChatHandler(AgentChatDeps{Registry: reg, SessionMemory: sessionmem.NewInMemoryStore()})
	reader := mapSiteConfig{"chat_session_memory_enabled": "true"}
	var got []string
	for _, tl := range h.answerTools(context.Background(), "kb1", reader, &AgentRetriever{}) {
		got = append(got, tl.Name())
		if p := adkbridge.PolicyFor(tl.Name()); p.Approval != adkbridge.ApprovalNever {
			t.Errorf("answer tool %s needs approval %s", tl.Name(), p.Approval)
		}
	}
	if strings.Join(got, ",") != "kb_search,memory_read,memory_write" {
		t.Fatalf("answer tools = %v, want kb_search,memory_read,memory_write", got)
	}
}

type mapSiteConfig map[string]string

func (m mapSiteConfig) GetSiteConfigValue(_ context.Context, key string) (*string, error) {
	if v, ok := m[key]; ok {
		return &v, nil
	}
	return nil, nil
}
