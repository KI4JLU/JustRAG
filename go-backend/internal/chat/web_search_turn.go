package chat

import (
	"context"
	"strings"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/logctx"
)

// webSearchToolName is the built-in MCP tool the per-turn web-search
// capability exposes to the answer LLM (internal/mcp/builtin/web_search.go).
const webSearchToolName = "web_search"

// webSearchPromptHint is appended to the answer system prompt on a turn the
// user switched web search on. The tool being in the catalog is not enough:
// the answer LLM is told to prefer the KB and otherwise never reaches for a
// tool the corpus does not need, so the opt-in has to be spelled out.
const webSearchPromptHint = "\n\n" +
	"The user has enabled web search for this turn. Use the web_search tool for " +
	"anything the knowledge base does not cover or that may be outdated — current " +
	"events, external facts, recent versions — and cite what you found as coming " +
	"from the web, separate from the knowledge-base sources."

// answerTurnTools decides whether the answer LLM gets tools on this turn and
// which. Two ways in:
//
//   - chat_answer_tools_enabled (admin, global): the full per-KB answer
//     catalog, exactly as before. If the user also asked for web search and
//     the catalog does not carry web_search, it is added.
//   - body.WebSearch (user, per turn) with the global flag OFF: a dispatcher
//     restricted to web_search only — the user's explicit request is the
//     authorization for the one privileged tool, nothing else opens up.
//
// ok=false means the legacy tool-less stream runs. teamAuthored keeps the
// team-synthesis exclusion of the caller (see http_send.go) in force for the
// web-search path too.
func (h *Handler) answerTurnTools(ctx context.Context, kbID string, webSearch, teamAuthored bool) (dispatcher ToolDispatcher, catalog []ai.ChatTool, promptHint string, ok bool) {
	if h.toolDispatcher == nil || teamAuthored {
		return nil, nil, "", false
	}
	mcpDisp, _ := h.toolDispatcher.(*MCPDispatcher)

	if ChatAnswerToolsEnabled(ctx, h.siteConfigReader) {
		if mcpDisp != nil {
			catalog = mcpDisp.AnswerToolCatalog(kbID)
		}
		if webSearch {
			if !hasTool(catalog, webSearchToolName) && mcpDisp != nil {
				// The KB catalog can hide web_search (per-KB tool config); the
				// user's opt-in puts it back for this turn.
				restricted := NewRestrictedDispatcher(mcpDisp, []string{webSearchToolName}, true)
				catalog = append(catalog, restricted.AnswerToolCatalog(kbID)...)
			}
			if hasTool(catalog, webSearchToolName) {
				promptHint = webSearchPromptHint
			} else {
				logctx.From(ctx).Warn("chat.send: web search requested but web_search tool is not registered", "kb_id", kbID)
			}
		}
		return h.toolDispatcher, catalog, promptHint, true
	}

	if !webSearch || mcpDisp == nil {
		return nil, nil, "", false
	}
	restricted := NewRestrictedDispatcher(mcpDisp, []string{webSearchToolName}, true)
	catalog = restricted.AnswerToolCatalog(kbID)
	if len(catalog) == 0 {
		// Not registered (no research.WebClient) — fall back to the plain
		// stream rather than failing the turn; the trajectory says why.
		logctx.From(ctx).Warn("chat.send: web search requested but web_search tool is not registered", "kb_id", kbID)
		return nil, nil, "", false
	}
	return restricted, catalog, webSearchPromptHint, true
}

// webSearchUnavailable returns "" when a turn with web search can run, else
// the reason as a user-facing message. Checked up front, before the turn is
// persisted or streamed, so a missing configuration is a clear 4xx on the
// send — not a tool error the model paraphrases into a vague answer. Mirrors
// the checks research.WebClient.Search makes when the tool actually runs.
func (h *Handler) webSearchUnavailable(ctx context.Context) string {
	mcpDisp, _ := h.toolDispatcher.(*MCPDispatcher)
	if mcpDisp == nil || mcpDisp.Registry == nil {
		return "Web search is not available: the tool dispatcher is not wired on this server."
	}
	if _, ok := mcpDisp.Registry.Get("", webSearchToolName); !ok {
		return "Web search is not available: the web_search tool is not registered on this server."
	}
	if !readBool(ctx, h.siteConfigReader, "web_search_enabled", false) {
		return "Web search is disabled on this server (site setting web_search_enabled)."
	}
	var missing []string
	if readString(ctx, h.siteConfigReader, "google_search_api_key") == "" {
		missing = append(missing, "google_search_api_key")
	}
	if readString(ctx, h.siteConfigReader, "google_search_cx") == "" {
		missing = append(missing, "google_search_cx")
	}
	if len(missing) > 0 {
		return "Web search is not configured on this server: missing " + strings.Join(missing, " and ") + " in the admin settings."
	}
	return ""
}

func hasTool(catalog []ai.ChatTool, name string) bool {
	for _, t := range catalog {
		if t.Function.Name == name {
			return true
		}
	}
	return false
}
