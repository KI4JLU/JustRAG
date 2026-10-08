package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/ag-ui-protocol/ag-ui/sdks/community/go/pkg/core/types"
	"google.golang.org/adk/v2/runner"
	"google.golang.org/adk/v2/tool"
	"google.golang.org/genai"

	"github.com/justrag/go-backend/internal/adkbridge"
	"github.com/justrag/go-backend/internal/agui"
	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/confluence"
	"github.com/justrag/go-backend/internal/files"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/logctx"
	"github.com/justrag/go-backend/internal/mcp"
	"github.com/justrag/go-backend/internal/sessionmem"
	"github.com/justrag/go-backend/internal/siteconfig"
	"github.com/justrag/go-backend/internal/usage"
	"github.com/justrag/go-backend/internal/vector"
)

// agentChatApp is the ADK app name of the agent chat: the runner's, the
// agui handler's and the session/run rows'.
const agentChatApp = "agentchat"

// agentChatMaxBody matches agui's own body cap.
const agentChatMaxBody = 1 << 20

// agentKBSearchSchema is the answer-time kb_search input. AgentRetriever
// reads only the query: the production pipeline decides everything else.
const agentKBSearchSchema = `{"type":"object","properties":{"query":{"type":"string","description":"What to search the knowledge base for."}},"required":["query"]}`

// AgentChatDeps are the shared dependencies of the agent chat endpoint.
type AgentChatDeps struct {
	Store      *PGStore
	SiteConfig SiteConfigReader       // global reader
	KBConfig   KBConfigOverrideLister // per-KB overrides (as Handler.forKB)
	AI         *ai.ConfigResolver
	Search     *vector.SearchService
	Registry   *mcp.Registry // web_search, memory_*; may be nil
	Sessions   *adkbridge.PGSessionService
	Runs       *adkbridge.RunStore
	Usage      usage.Recorder // may be nil
	// SessionMemory, when set, enables the memory_* tools on KBs with
	// chat session memory on.
	SessionMemory sessionmem.Store
	Importer      *confluence.Importer // may be nil
	Library       LibraryAdder         // may be nil
	// Files counts a KB's files (empty KB → no_files); nil skips the check.
	Files *files.PGStore

	// Test seams: the answer model and the retrieval (PrepareChatContext).
	modelFor func(ctx context.Context, kbID string) (*adkbridge.Model, error)
	prepare  func(ctx context.Context, p ChatContextParams) (*ChatContext, error)
}

// AgentChatHandler serves POST /api/kb/{id}/agui/chat: the agentic chat as
// an AG-UI endpoint, behind the per-KB flag chat_agent_chat_enabled.
type AgentChatHandler struct{ d AgentChatDeps }

// NewAgentChatHandler returns the handler.
func NewAgentChatHandler(d AgentChatDeps) *AgentChatHandler { return &AgentChatHandler{d: d} }

// ServeHTTP answers 403 without KB access and 404 {"error":"not_found"}
// while the flag is off for the KB — both before anything is read, written
// or sent to a model. Otherwise it builds the turn's flow and runner and
// hands the request to agui (see agui.NewHandler for its status codes).
func (h *AgentChatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	access := kbaccess.AccessFromContext(ctx)
	if access == nil || access.KB == nil {
		writeAgentChatError(w, http.StatusForbidden, "forbidden")
		return
	}
	kbID := access.KB.ID
	ctx = logctx.Attach(logctx.WithKB(ctx, kbID))
	reader, searcher := h.forKB(ctx, kbID)
	if !ChatAgentChatEnabled(ctx, reader) {
		writeAgentChatError(w, http.StatusNotFound, "not_found")
		return
	}

	// agui decodes the body itself; read it once here for forwardedProps
	// and hand agui an identical copy.
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, agentChatMaxBody))
	if err != nil {
		writeAgentChatError(w, http.StatusBadRequest, "bad_request")
		return
	}
	var in types.RunAgentInput
	decoded := json.Unmarshal(raw, &in) == nil
	if decoded && len(in.Resume) == 0 {
		// A new question gets the legacy chat's checks (Ruling P2-R13),
		// before anything is written or sent to a model. A body agui
		// cannot use is left for agui to refuse.
		if m, err := agui.Input(ctx, &in, nil); err == nil {
			userID := ""
			if u := auth.UserFromContext(ctx); u != nil {
				userID = u.ID
			}
			if msg := messageTextError(userID, contentTextOf(m)); msg != "" {
				httputil.WriteErrorCtx(ctx, w, http.StatusBadRequest, msg)
				return
			}
		}
	}
	props := agentChatProps{language: defaultLanguage}
	if decoded {
		props = agentChatPropsOf(&in)
	}

	if ChatSessionMemoryEnabled(ctx, reader) {
		ctx = sessionmem.WithWriteCounter(ctx, sessionmem.NewWriteCounter())
	}
	retriever := &AgentRetriever{AI: h.d.AI, Config: reader, Lang: props.language, prepare: h.d.prepare}
	if searcher != nil {
		retriever.Search = searcher
	}
	run, err := h.runner(ctx, kbID, reader, retriever, props.reasoning)
	if err != nil {
		logctx.From(ctx).Error("agentchat: build turn", "error", err)
		writeAgentChatError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	hooks := &agentChatHooks{store: h.d.Store, usage: h.d.Usage, retriever: retriever}
	r = r.WithContext(ctx)
	r.Body = io.NopCloser(bytes.NewReader(raw))
	agui.NewHandler(agui.Config{
		AppName:  agentChatApp,
		Runner:   run,
		Sessions: h.d.Sessions,
		Runs:     h.d.Runs,
		Scope:    h.scope(access),
		Hooks:    hooks,
	}).ServeHTTP(w, r)
}

// forKB overlays the KB's per-KB overrides on the global reader and the
// search service, as Handler.forKB does. searcher is nil without a
// search service.
func (h *AgentChatHandler) forKB(ctx context.Context, kbID string) (SiteConfigReader, vector.Searcher) {
	var reader SiteConfigReader = h.d.SiteConfig
	var searcher vector.Searcher
	if h.d.Search != nil {
		searcher = h.d.Search
	}
	if h.d.KBConfig == nil {
		return reader, searcher
	}
	overrides, err := h.d.KBConfig.ListKBOverrides(ctx, kbID)
	if err != nil {
		logctx.From(ctx).Warn("chat.kb_config.load_failed", "kb_id", kbID, "error", err)
		return reader, searcher
	}
	if len(overrides) == 0 {
		return reader, searcher
	}
	overlay := siteconfig.NewKBOverlay(h.d.SiteConfig, overrides)
	if h.d.Search != nil {
		searcher = h.d.Search.CloneWithSiteConfigReader(overlay)
	}
	return overlay, searcher
}

// scope builds the run scope from the authenticated request: the user from
// auth, the KB and role from kbaccess, the privilege flag from the GLOBAL
// reader (a KB override must not unlock privileged tools).
func (h *AgentChatHandler) scope(access *kbaccess.KBAccessResult) agui.ScopeFunc {
	return func(r *http.Request) (adkbridge.Scope, error) {
		user := auth.UserFromContext(r.Context())
		if user == nil || user.ID == "" {
			return adkbridge.Scope{}, agui.ErrUnauthorized
		}
		return adkbridge.Scope{
			UserID:          user.ID,
			KBID:            access.KB.ID,
			Role:            access.Role,
			IsGlobal:        access.KB.IsGlobal,
			AllowPrivileged: AgentsAllowPrivilegedTools(r.Context(), h.d.SiteConfig),
		}, nil
	}
}

// runner builds the turn's flow (model, tools, dead-end actions) and its
// runner. Everything is per request: the retriever holds the turn's sources.
func (h *AgentChatHandler) runner(ctx context.Context, kbID string, reader SiteConfigReader, retriever *AgentRetriever, effort string) (*runner.Runner, error) {
	model, err := h.model(ctx, kbID, effort)
	if err != nil {
		return nil, err
	}
	act := ActDispatchers(h.d.Registry, h.d.Importer, h.d.Library)
	// Offer exactly what can execute.
	allowed := make([]string, 0, len(act))
	for name := range act {
		allowed = append(allowed, name)
	}
	slices.Sort(allowed)
	var counter FileCounter
	if h.d.Files != nil {
		counter = FileCounterFromLimits(h.d.Files)
	}
	flow, err := NewAgentFlow(AgentFlowDeps{
		Model:       model,
		Retriever:   retriever,
		Tools:       h.answerTools(ctx, kbID, reader, retriever),
		FileCounter: counter,
		Allowed:     allowed,
		ActDispatch: act,
	})
	if err != nil {
		return nil, err
	}
	return runner.New(runner.Config{AppName: agentChatApp, Agent: flow, SessionService: h.d.Sessions, AutoCreateSession: true})
}

func (h *AgentChatHandler) model(ctx context.Context, kbID, effort string) (*adkbridge.Model, error) {
	if h.d.modelFor != nil {
		return h.d.modelFor(ctx, kbID)
	}
	return adkbridge.NewModelFactory(h.d.AI).For(ctx, kbID, "", effort)
}

// answerTools are the answer agent's tools: kb_search over the turn's
// retriever (production pipeline, numbered into the turn's sources), the
// built-in web_search when registered, and memory_read/memory_write when
// session memory is on for the KB.
func (h *AgentChatHandler) answerTools(ctx context.Context, kbID string, reader SiteConfigReader, retriever *AgentRetriever) []tool.Tool {
	out := []tool.Tool{adkbridge.NewTool(adkbridge.ToolSpec{
		Name:        "kb_search",
		Description: "Search this knowledge base again, e.g. for a follow-up aspect of the question. Results are numbered like the context; cite them as [n].",
		InputSchema: json.RawMessage(agentKBSearchSchema),
		Policy:      adkbridge.PolicyFor("kb_search"),
	}, retriever.Dispatch)}
	var names []string
	if t, ok := registryHas(h.d.Registry, "web_search"); ok && t.Origin == "builtin" {
		names = append(names, "web_search")
	}
	if h.d.SessionMemory != nil && ChatSessionMemoryEnabled(ctx, reader) {
		for _, n := range []string{"memory_read", "memory_write"} {
			if _, ok := registryHas(h.d.Registry, n); ok {
				names = append(names, n)
			}
		}
	}
	if len(names) == 0 {
		return out
	}
	more, err := adkbridge.RegistryTools(h.d.Registry, kbID, names)
	if err != nil {
		logctx.From(ctx).Warn("agentchat: registry tools", "tools", names, "error", err)
		return out
	}
	return append(out, more...)
}

// agentChatProps are the forwardedProps the agent chat reads.
type agentChatProps struct {
	reasoning string // low | medium | high; "" = none
	language  string // a supported language, default otherwise
}

// agentChatPropsOf reads forwardedProps. Anything malformed or unknown
// falls back to the defaults.
func agentChatPropsOf(in *types.RunAgentInput) agentChatProps {
	out := agentChatProps{language: defaultLanguage}
	fp, _ := in.ForwardedProps.(map[string]any)
	switch v, _ := fp["reasoning"].(string); v {
	case "low", "medium", "high":
		out.reasoning = v
	}
	if v, _ := fp["language"].(string); supportedLanguages[v] {
		out.language = v
	}
	return out
}

// contentTextOf joins the text parts of a message (as agui does for the
// user text it hands TurnStarted).
func contentTextOf(c *genai.Content) string {
	var b strings.Builder
	for _, p := range c.Parts {
		if p != nil {
			b.WriteString(p.Text)
		}
	}
	return b.String()
}

func writeAgentChatError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
