package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/agent/workflowagent"
	"google.golang.org/adk/v2/session"
	"google.golang.org/adk/v2/tool"
	"google.golang.org/adk/v2/workflow"

	"github.com/justrag/go-backend/internal/adkbridge"
	"github.com/justrag/go-backend/internal/agui"
	"github.com/justrag/go-backend/internal/logctx"
)

// Session state keys the retrieve node writes (non-temp, so they survive a
// pause): the dead-end nodes recompute the offered actions from them
// server-side, never from the client.
const (
	AgentChatStateQuestion = "agentchat.question"
	AgentChatStateReason   = "agentchat.reason"
)

// deadEndPlaceholderText answers a dead end until suggest/act land (Task 6).
const deadEndPlaceholderText = "Dazu habe ich in der Wissensbasis nichts gefunden."

// FileCounter reports how many files a KB holds.
type FileCounter func(ctx context.Context, kbID string) (int, error)

// AgentFlowDeps are the per-turn dependencies of NewAgentFlow.
type AgentFlowDeps struct {
	Model     *adkbridge.Model
	Retriever *AgentRetriever
	// Tools are the answer-time tools (kb_search via Retriever, web_search,
	// memory_* ...).
	Tools []tool.Tool
	// FileCounter, when set, routes a KB with no files to no_files before
	// retrieval. nil skips the check.
	FileCounter FileCounter
	Actions     []adkbridge.Action // dead-end suggestions (Task 6)
	Allowed     []string           // tool names allowlisted for suggestions
	ActDispatch map[string]adkbridge.DispatchFunc
}

// NewAgentFlow returns the per-turn workflow agent:
//
//	Start → retrieve ─found→ answer → sources
//	                 └no_evidence|no_files→ dead end
//
// The dead-end branch is a fixed answer for now; Task 6 replaces it with
// suggest ⏸ → act → answer (see deadEndEdges).
func NewAgentFlow(deps AgentFlowDeps) (agent.Agent, error) {
	if deps.Model == nil || deps.Retriever == nil {
		return nil, errors.New("chat: agent flow needs a model and a retriever")
	}
	retriever := deps.Retriever
	answerAgent, err := llmagent.New(llmagent.Config{
		Name:        "answer",
		Description: "Answers the question from the retrieved knowledge-base context.",
		Model:       deps.Model,
		InstructionProvider: func(agent.ReadonlyContext) (string, error) {
			return retriever.SystemPrompt(), nil
		},
		Tools: deps.Tools,
	})
	if err != nil {
		return nil, fmt.Errorf("chat: answer agent: %w", err)
	}
	answer, err := workflow.NewAgentNode(answerAgent, workflow.NodeConfig{})
	if err != nil {
		return nil, fmt.Errorf("chat: answer node: %w", err)
	}
	retrieve := agentRetrieveNode(retriever, deps.FileCounter)
	sources := agentSourcesNode(retriever)

	edges := workflow.Concat(
		workflow.Chain(workflow.Start, retrieve),
		[]workflow.Edge{{From: retrieve, To: answer, Route: workflow.StringRoute(adkbridge.RouteFound)}},
		workflow.Chain(answer, sources),
		deadEndEdges(retrieve),
	)
	return workflowagent.New(workflowagent.Config{
		Name:        "agentchat",
		Description: "Agentic chat turn: retrieval floor, then answer.",
		Edges:       edges,
	})
}

// deadEndEdges wires the no_evidence and no_files routes.
func deadEndEdges(retrieve workflow.Node) []workflow.Edge {
	deadEnd := workflow.NewFunctionNode("dead_end",
		func(agent.Context, string) (string, error) { return deadEndPlaceholderText, nil },
		workflow.NodeConfig{})
	return []workflow.Edge{{From: retrieve, To: deadEnd,
		Route: workflow.MultiRoute[string]{adkbridge.RouteNoEvidence, adkbridge.RouteNoFiles}}}
}

// agentRetrieveNode runs the production retrieval floor for the question
// (the node input) and routes found / no_evidence / no_files. Its output is
// the question, which the answer node receives as user content.
func agentRetrieveNode(r *AgentRetriever, files FileCounter) workflow.Node {
	return workflow.NewEmittingFunctionNode("retrieve",
		func(ctx agent.Context, q string, emit func(*session.Event) error) (string, error) {
			route, err := agentRetrieveRoute(ctx, r, files, q)
			if err != nil {
				return "", err
			}
			ev := session.NewEvent(ctx, ctx.InvocationID())
			ev.Routes = []string{route}
			ev.Actions.StateDelta = map[string]any{AgentChatStateQuestion: q, AgentChatStateReason: route}
			if err := emit(ev); err != nil {
				return "", err
			}
			return q, nil
		}, workflow.NodeConfig{})
}

func agentRetrieveRoute(ctx context.Context, r *AgentRetriever, files FileCounter, q string) (string, error) {
	sc, ok := adkbridge.ScopeFrom(ctx)
	if !ok {
		return "", adkbridge.ErrNoScope
	}
	if sc.KBID == "" {
		if len(sc.LibraryFileIDs) > 0 {
			return "", adkbridge.ErrLibraryScopeUnsupported
		}
		return adkbridge.RouteNoFiles, nil
	}
	// The node dispatches kb_search itself, outside the bridge's tool
	// policy, so it enforces kb_search's role floor (fails closed on an
	// empty or unknown role) — as adkbridge.RetrieveNode does.
	if need := adkbridge.PolicyFor("kb_search").RequiresRole; !adkbridge.RoleAtLeast(sc.Role, need) {
		return "", fmt.Errorf("%w: kb_search requires role %s", adkbridge.ErrForbiddenTool, need)
	}
	if files != nil {
		n, err := files(ctx, sc.KBID)
		switch {
		case err != nil:
			// Fail soft: an empty KB then routes no_evidence via retrieval.
			logctx.From(ctx).Warn("agentchat: file count failed", "kb_id", sc.KBID, "error", err)
		case n == 0:
			return adkbridge.RouteNoFiles, nil
		}
	}
	args, err := json.Marshal(map[string]any{"query": q})
	if err != nil {
		return "", err
	}
	res, err := r.Dispatch(ctx, sc.KBID, "kb_search", args)
	if err != nil {
		return "", err
	}
	if len(res.Chunks) == 0 {
		return adkbridge.RouteNoEvidence, nil
	}
	return adkbridge.RouteFound, nil
}

// agentSourcesNode emits the turn's final numbered sources ([]ChatSource
// JSON) as the justrag.sources.v1 CUSTOM event and
// passes the answer text through, so it stays the run's final output.
func agentSourcesNode(r *AgentRetriever) workflow.Node {
	return workflow.NewEmittingFunctionNode("sources",
		func(ctx agent.Context, answer string, emit func(*session.Event) error) (string, error) {
			ev := session.NewEvent(ctx, ctx.InvocationID())
			ev.CustomMetadata = agui.CustomMetadata(agui.SourcesEvent, r.Sources())
			if err := emit(ev); err != nil {
				return "", err
			}
			return answer, nil
		}, workflow.NodeConfig{})
}
