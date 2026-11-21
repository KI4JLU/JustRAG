package chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/chatattach"
	"github.com/justrag/go-backend/internal/chatpolicy"
	"github.com/justrag/go-backend/internal/vector"
)

// ---------------------------------------------------------------------------
// Call-site wiring coverage for the OrchComparison branch of tryDeepChat.
//
// Drives tryDeepChat end to end (through the real RunComparisonChat and the
// post-dispatch SSE streamer) using ONLY seams that already exist elsewhere
// in this package — chatTestConfigStore + httptest (answer_tools_test.go,
// multipass_test.go), chatattach.NewInMemoryStore (comparison_chat_test.go),
// and a Search fake in the same shape as fakeSearcher
// (plan_execute_chat_test.go). The helpers are shared with
// post_metrics_test.go, http_send_early_open_test.go and
// orchestrator_policy_wiring_test.go.
// ---------------------------------------------------------------------------

// wiringSearcher routes by query string, so one fake can answer different
// searches (e.g. the comparison stage's peer search, query = section text)
// with different chunk sets.
type wiringSearcher struct {
	byQuery map[string][]vector.SearchChunk
}

func (s wiringSearcher) Search(_ context.Context, _, query string, _ int, _ vector.SearchOptions) (*vector.SearchResult, error) {
	return &vector.SearchResult{Chunks: s.byQuery[query]}, nil
}

func (s wiringSearcher) ExpandNeighbors(_ context.Context, chunks []vector.SearchChunk, _ int, _, _ string) []vector.SearchChunk {
	return chunks
}

var _ vector.Searcher = wiringSearcher{}

// wiringConfigResolver spins up an httptest server that answers both the
// non-streaming structured calls (comparison findings extraction, follow-up
// questions) and the final streaming answer completion, using the same
// request-shape detection multipassTestServer/chatTestConfigStore already
// establish for this package's tests. A single canned "{"findings":[]}"
// non-stream body is valid input to every non-stream parser this wiring
// path exercises (comparisonFindingsPayload unmarshal; GenerateFollowUpQuestions'
// best-effort string-array parse, which no-ops to an empty slice on a shape
// mismatch instead of erroring).
func wiringConfigResolver(t *testing.T) *ai.ConfigResolver {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var probe struct {
			Stream bool `json:"stream"`
		}
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &probe)
		if probe.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"summary text\"}}]}\n\n"))
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"findings\":[]}"}}]}`))
	}))
	t.Cleanup(srv.Close)
	store := &chatTestConfigStore{baseURL: srv.URL + "/v1/", model: "fake-model"}
	return ai.NewConfigResolver(store)
}

// wiringConfigResolverCapturing is wiringConfigResolver plus a raw-body
// recorder, used to tell RunAnswerWithTools' request shape (always sends
// tool_choice, even with an empty tool catalog — see answer_tools.go's
// runner.Run(ctx, messages, in.Tools, "auto")) apart from
// ai.StreamCompletionWithHistory's (never sets ToolChoice, so it is omitted
// by the json:"tool_choice,omitempty" tag).
func wiringConfigResolverCapturing(t *testing.T) (*ai.ConfigResolver, func() []string) {
	t.Helper()
	var mu sync.Mutex
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(raw))
		mu.Unlock()
		var probe struct {
			Stream bool `json:"stream"`
		}
		_ = json.Unmarshal(raw, &probe)
		if probe.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"summary text\"}}]}\n\n"))
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"findings\":[]}"}}]}`))
	}))
	t.Cleanup(srv.Close)
	store := &chatTestConfigStore{baseURL: srv.URL + "/v1/", model: "fake-model"}
	snapshot := func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), bodies...)
	}
	return ai.NewConfigResolver(store), snapshot
}

// noopToolDispatcher is a minimal ToolDispatcher — never actually invoked in
// the AnswerToolsStayOff test below (the mock model never returns tool_calls),
// present only so h.toolDispatcher != nil is satisfiable.
type noopToolDispatcher struct{}

func (noopToolDispatcher) Dispatch(context.Context, string, string, json.RawMessage) (DispatchedToolResult, error) {
	return DispatchedToolResult{}, nil
}

var _ ToolDispatcher = noopToolDispatcher{}

// wiringStore is a minimal Store that records every AddMessage call so the
// test can assert on the "ai" role message's TeamID/AgentID attribution.
type wiringStore struct {
	added []AddMessageParams
}

func (s *wiringStore) GetChats(context.Context, string, string) ([]ChatRow, error) { return nil, nil }
func (s *wiringStore) GetChatByID(context.Context, string) (*ChatRow, error)       { return nil, nil }
func (s *wiringStore) CreateChat(context.Context, string, string, string) (*ChatRow, error) {
	return nil, nil
}
func (s *wiringStore) DeleteChat(context.Context, string) error { return nil }
func (s *wiringStore) GetChatMessages(context.Context, string) ([]MessageRow, error) {
	return nil, nil
}
func (s *wiringStore) GetMessageAncestors(context.Context, string, string) ([]MessageRow, error) {
	return nil, nil
}
func (s *wiringStore) AddMessage(_ context.Context, p AddMessageParams) (*MessageRow, error) {
	s.added = append(s.added, p)
	return &MessageRow{ID: p.Role + "-msg-id", ChatID: p.ChatID, Role: p.Role, Content: p.Content}, nil
}
func (s *wiringStore) UpdateMessageFeedback(context.Context, string, string, string, *string, *string) error {
	return nil
}
func (s *wiringStore) UpdateMessageVerification(context.Context, string, *MessageVerification) error {
	return nil
}
func (s *wiringStore) UpdateMessageContent(context.Context, string, string) error { return nil }
func (s *wiringStore) UpdateMessageTraceID(context.Context, string, string) error { return nil }
func (s *wiringStore) UpdateMessageTrajectory(context.Context, string, []TrajectoryEvent) error {
	return nil
}
func (s *wiringStore) GetKBSystemPrompt(context.Context, string) (*string, error) { return nil, nil }
func (s *wiringStore) GetChatSystemPrompt(context.Context, string, string) (*string, error) {
	return nil, nil
}
func (s *wiringStore) KBHasRole(context.Context, string, string) (bool, error) { return false, nil }
func (s *wiringStore) CreateChatWithRole(context.Context, string, string, string, string) (*ChatRow, error) {
	return nil, nil
}
func (s *wiringStore) UpdateChatTitle(context.Context, string, string, string) error {
	return nil
}

func (s *wiringStore) BranchChat(context.Context, string, string, string) (*BranchResult, error) {
	return nil, nil
}

func (s *wiringStore) StarterContext(context.Context, string, int) (StarterSource, error) {
	return StarterSource{}, nil
}

var _ Store = (*wiringStore)(nil)

// wiringSiteConfig turns off every side quest tryDeepChat/runPostResponseTasks
// could otherwise take (factcheck's own LLM call, every other orchestrator
// flag) so the only two model round-trips in play are the comparison
// findings extraction and the final streamed summary — both served by
// wiringConfigResolver.
func wiringSiteConfig() *fakeSiteConfigReader {
	return &fakeSiteConfigReader{values: map[string]*string{
		"chat_compare_enabled": strPtr("true"),
		"factcheck_in_chat":    strPtr("false"),
	}}
}

func wiringBody(attachmentID string) sendMessageRequest {
	return sendMessageRequest{
		Message:         "Bitte vergleichen",
		AttachmentID:    attachmentID,
		ComparisonModes: []string{"contradiction"},
	}
}

func wiringCtx(userID string) context.Context {
	return auth.WithUser(context.Background(), &auth.Claims{ID: userID, Role: "user"})
}

// TestTryDeepChat_ComparisonPlainPath_IgnoresKbSystemPrompt pins that the
// comparison summary stays byte-identical to its pre-2026-08 behaviour
// (669ae5e): it must NOT carry kbSystemPrompt. Oracle: every request body the
// fake model provider received.
func TestTryDeepChat_ComparisonPlainPath_IgnoresKbSystemPrompt(t *testing.T) {
	attStore := chatattach.NewInMemoryStore(time.Hour)
	attID, err := attStore.Put(context.Background(), chatattach.Attachment{
		UserID: "u1", KbID: "kb1", Sections: []string{"Section A"},
	})
	if err != nil {
		t.Fatalf("attStore.Put: %v", err)
	}

	resolver, snapshot := wiringConfigResolverCapturing(t)
	h := &Handler{
		store:            &wiringStore{},
		aiResolver:       resolver,
		siteConfigReader: wiringSiteConfig(),
		attachmentStore:  attStore,
		searchService: wiringSearcher{byQuery: map[string][]vector.SearchChunk{
			"Section A": {{ID: "c1", FileID: "f1", FileName: "f1.md", Content: "peer content"}},
		}},
	}

	const sentinel = "SENTINEL-KB-SYSTEM-PROMPT-MARKER"
	ctx := wiringCtx("u1")
	r := httptest.NewRequest(http.MethodPost, "/api/kb/kb1/chat", nil)
	w := httptest.NewRecorder()

	handled := h.tryDeepChat(ctx, w, r, "chat1", "kb1", "de", "", "Bitte vergleichen", "", "",
		sentinel, "", wiringBody(attID), turnAnchor{}, GraphTraversalDecision{}, nil, nil, nil, turnPolicy{gate: chatpolicy.Decision{RuleIndex: -1}}, nil)
	if !handled {
		t.Fatalf("tryDeepChat did not handle the comparison turn; body: %s", w.Body.String())
	}

	for _, body := range snapshot() {
		if strings.Contains(body, sentinel) {
			t.Errorf("plain comparison path leaked kbSystemPrompt into a model request — must stay byte-identical to pre-2026-08 behaviour: %s", body)
		}
	}
}

func (s *wiringStore) GetAllChats(context.Context, string, string, int) ([]ChatListRow, error) {
	return nil, nil
}

func (s *wiringStore) SetChatPinned(context.Context, string, string, bool, *string) error { return nil }

func (s *wiringStore) SetPinnedOrder(context.Context, string, *string, []string) error { return nil }
