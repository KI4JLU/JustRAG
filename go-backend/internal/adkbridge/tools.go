package adkbridge

import (
	"context"
	"encoding/json"
	"fmt"

	"google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/model"
	"google.golang.org/adk/v2/tool"
	"google.golang.org/adk/v2/tool/toolutils"
	"google.golang.org/genai"

	"github.com/justrag/go-backend/internal/mcp"
)

// DispatchFunc executes one tool call. It is the seam to our existing
// dispatchers (mcp.Registry.Dispatch, chat.RestrictedDispatcher, …), which
// keep enforcing allowlists at dispatch time — the catalog the model sees is
// a hint, not a control.
type DispatchFunc func(ctx context.Context, name string, args json.RawMessage) (mcp.ToolResult, error)

// ToolSpec describes one tool exposed to an ADK agent.
type ToolSpec struct {
	Name        string
	Description string
	InputSchema json.RawMessage
	// RequireApproval pauses the run before execution and asks the user to
	// confirm (ADK tool confirmation). Enforced here, in code, so a
	// prompt-injected model cannot skip it.
	RequireApproval bool
}

type dispatchTool struct {
	spec     ToolSpec
	dispatch DispatchFunc
}

// NewTool wraps a dispatcher-backed tool as an ADK function tool.
func NewTool(spec ToolSpec, dispatch DispatchFunc) tool.Tool {
	return &dispatchTool{spec: spec, dispatch: dispatch}
}

// RegistryTools exposes the named tools from an MCP registry for one KB.
// Unknown names are an error, not silently dropped.
func RegistryTools(reg *mcp.Registry, kbID string, names []string, approval func(name string) bool) ([]tool.Tool, error) {
	out := make([]tool.Tool, 0, len(names))
	for _, n := range names {
		t, ok := reg.Get(kbID, n)
		if !ok {
			return nil, fmt.Errorf("adkbridge: unknown tool %q", n)
		}
		spec := ToolSpec{Name: t.Name, Description: t.Description, InputSchema: t.InputSchema}
		if approval != nil {
			spec.RequireApproval = approval(n)
		}
		out = append(out, NewTool(spec, func(ctx context.Context, name string, args json.RawMessage) (mcp.ToolResult, error) {
			return reg.Dispatch(ctx, kbID, name, args)
		}))
	}
	return out, nil
}

func (t *dispatchTool) Name() string        { return t.spec.Name }
func (t *dispatchTool) Description() string { return t.spec.Description }
func (t *dispatchTool) IsLongRunning() bool { return false }

// ProcessRequest packs the declaration into the LLM request.
func (t *dispatchTool) ProcessRequest(_ agent.Context, req *model.LLMRequest) error {
	return toolutils.PackTool(req, t)
}

// Declaration is what the model sees.
func (t *dispatchTool) Declaration() *genai.FunctionDeclaration {
	d := &genai.FunctionDeclaration{Name: t.spec.Name, Description: t.spec.Description}
	if len(t.spec.InputSchema) > 0 {
		d.ParametersJsonSchema = t.spec.InputSchema
	}
	return d
}

// Run executes the tool. Dispatch errors are returned to the model as a
// result (so it can correct itself) rather than failing the run.
func (t *dispatchTool) Run(ctx agent.Context, args any) (map[string]any, error) {
	if t.spec.RequireApproval {
		if c := ctx.ToolConfirmation(); c != nil {
			if !c.Confirmed {
				return nil, fmt.Errorf("tool %q: %w", t.spec.Name, tool.ErrConfirmationRejected)
			}
		} else {
			if err := ctx.RequestConfirmation(fmt.Sprintf("Approve calling %s?", t.spec.Name), args); err != nil {
				return nil, err
			}
			ctx.Actions().SkipSummarization = true
			return nil, fmt.Errorf("tool %q: %w", t.spec.Name, tool.ErrConfirmationRequired)
		}
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, fmt.Errorf("adkbridge: marshal args for %q: %w", t.spec.Name, err)
	}
	res, err := t.dispatch(ctx, t.spec.Name, raw)
	if err != nil {
		return map[string]any{"error": err.Error()}, nil
	}
	out := map[string]any{"result": res.Text}
	if len(res.Chunks) > 0 {
		out["chunks"] = res.Chunks
	}
	if len(res.Structured) > 0 {
		out["structured"] = res.Structured
	}
	return out, nil
}
