package publicapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/chat"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/publicapi"
	"github.com/justrag/go-backend/internal/vector"
)

// The answer the fake model gives, with and without its citation markers
// (hand-written oracle).
const (
	citedAnswer    = "Die Frist beträgt 3 Tage [1]."
	strippedAnswer = "Die Frist beträgt 3 Tage."
)

type fakeAIConfig struct{ baseURL string }

func (s fakeAIConfig) GetActiveAIProvider(context.Context) (*ai.AIProviderInfo, error) {
	return &ai.AIProviderInfo{ID: "p1", Name: "test", APIKey: "k", BaseURL: s.baseURL}, nil
}
func (s fakeAIConfig) GetAIProviderByID(context.Context, string) (*ai.AIProviderInfo, error) {
	return &ai.AIProviderInfo{ID: "p1", Name: "test", APIKey: "k", BaseURL: s.baseURL}, nil
}
func (s fakeAIConfig) GetAIModelsByProvider(context.Context, string) ([]ai.AIModelInfo, error) {
	return []ai.AIModelInfo{{Name: "fake-model"}}, nil
}
func (s fakeAIConfig) GetKBModelOverrides(context.Context, string) (*ai.KBModelOverrides, error) {
	return nil, nil
}

// citingResolver serves the cited answer, split mid-marker when streamed.
func citingResolver(t *testing.T) *ai.ConfigResolver {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var probe struct {
			Stream bool `json:"stream"`
		}
		_ = json.NewDecoder(r.Body).Decode(&probe)
		if probe.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			for _, d := range []string{"Die Frist beträgt 3 Tage [", "1]."} {
				b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]string{"content": d}}}})
				_, _ = w.Write([]byte("data: " + string(b) + "\n\n"))
			}
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
			return
		}
		b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": citedAnswer}}}})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(b)
	}))
	t.Cleanup(srv.Close)
	return ai.NewConfigResolver(fakeAIConfig{baseURL: srv.URL + "/v1/"})
}

type oneChunkSearcher struct{}

func (oneChunkSearcher) Search(context.Context, string, string, int, vector.SearchOptions) (*vector.SearchResult, error) {
	return &vector.SearchResult{Chunks: []vector.SearchChunk{{ID: "c1", FileID: "file-1", FileName: "geheim.pdf", Content: "Quelltext"}}}, nil
}
func (oneChunkSearcher) ExpandNeighbors(_ context.Context, c []vector.SearchChunk, _ int, _, _ string) []vector.SearchChunk {
	return c
}

// recordingStore remembers the AI message the handler persists.
type recordingStore struct {
	mockStore
	stored *chat.AddMessageParams
}

func (s *recordingStore) AddMessage(_ context.Context, p chat.AddMessageParams) (*chat.MessageRow, error) {
	if p.Role == "ai" {
		cp := p
		s.stored = &cp
	}
	return &chat.MessageRow{ID: p.Role + "-msg"}, nil
}

func withAccess(r *http.Request, role string, flags kbaccess.SourcePermissions) *http.Request {
	ctx := auth.WithUser(r.Context(), testUser())
	ctx = kbaccess.WithAccess(ctx, &kbaccess.KBAccessResult{KB: &kbaccess.KnowledgeBase{ID: "kb-1", Sources: flags}, Role: role})
	return r.WithContext(ctx)
}

// POST /api/v1/kb/{id}/chat, both modes: a key owner without seeCitations
// gets no source data and no markers; with the flag (or as KB admin) both
// are there. The persisted message is complete in every case.
func TestSendMessage_CitationVisibility(t *testing.T) {
	cases := []struct {
		name    string
		role    string
		flags   kbaccess.SourcePermissions
		visible bool
	}{
		{"viewer, flag off", kbaccess.RoleView, kbaccess.SourcePermissions{}, false},
		{"viewer, flag on", kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeCitations: true}, true},
		{"admin, flags off", kbaccess.RoleAdmin, kbaccess.SourcePermissions{}, true},
	}
	for _, c := range cases {
		for _, stream := range []string{"true", "false"} {
			t.Run(c.name+", stream="+stream, func(t *testing.T) {
				chatRow := makeChat("chat-1", "kb-1", "user-1")
				store := &recordingStore{mockStore: mockStore{chatRow: &chatRow}}
				h := publicapi.NewHandler(store, citingResolver(t), oneChunkSearcher{})
				req := httptest.NewRequest(http.MethodPost, "/api/v1/kb/kb-1/chat?stream="+stream, strings.NewReader(`{"message":"Frist?"}`))
				req.SetPathValue("id", "kb-1")
				rr := httptest.NewRecorder()
				h.SendMessage(rr, withAccess(req, c.role, c.flags))
				if rr.Code != http.StatusOK {
					t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
				}
				body := rr.Body.String()
				answer := answerOf(t, body, stream == "true")
				leaks := strings.Contains(body, "geheim.pdf") || strings.Contains(body, "file-1") || strings.Contains(body, "Quelltext")
				if c.visible {
					if !leaks || answer != citedAnswer {
						t.Fatalf("want citations: answer %q body %s", answer, body)
					}
				} else if leaks || answer != strippedAnswer || !strings.Contains(body, `"sources":[]`) {
					t.Fatalf("want no citations: answer %q body %s", answer, body)
				}
				if store.stored == nil || store.stored.Content != citedAnswer || len(store.stored.Sources) != 1 {
					t.Fatalf("persisted = %+v, want the full answer and its source", store.stored)
				}
			})
		}
	}
}

func answerOf(t *testing.T, body string, stream bool) string {
	t.Helper()
	if !stream {
		var resp map[string]any
		if err := json.Unmarshal([]byte(body), &resp); err != nil {
			t.Fatal(err)
		}
		s, _ := resp["answer"].(string)
		return s
	}
	var b strings.Builder
	for _, line := range strings.Split(body, "\n") {
		data, ok := strings.CutPrefix(line, "data: ")
		if !ok || data == "[DONE]" {
			continue
		}
		var fr map[string]any
		if json.Unmarshal([]byte(data), &fr) == nil {
			if s, ok := fr["content"].(string); ok {
				b.WriteString(s)
			}
		}
	}
	return b.String()
}

// GET /api/v1/kb/{id}/chats/{chatId}/messages strips stored sources at read
// time for a key owner without seeCitations, and returns them with it.
func TestGetMessages_CitationVisibility(t *testing.T) {
	sources, _ := json.Marshal([]chat.ChatSource{{Index: 1, FileName: "geheim.pdf", FileID: "file-1", Content: "Quelltext"}})
	for _, visible := range []bool{false, true} {
		chatRow := makeChat("chat-1", "kb-1", "user-1")
		store := &mockStore{chatRow: &chatRow, messages: []chat.MessageRow{{ID: "a1", ChatID: "chat-1", Role: "ai", Content: citedAnswer, Sources: sources}}}
		h := publicapi.NewHandler(store, nil, nil)
		req := newRequest(http.MethodGet, "/api/v1/kb/kb-1/chats/chat-1/messages")
		req.SetPathValue("id", "kb-1")
		req.SetPathValue("chatId", "chat-1")
		rr := httptest.NewRecorder()
		h.GetMessages(rr, withAccess(req, kbaccess.RoleView, kbaccess.SourcePermissions{ViewerSeeCitations: visible}))
		body := rr.Body.String()
		if got := strings.Contains(body, "geheim.pdf") && strings.Contains(body, "[1]"); got != visible {
			t.Fatalf("visible=%v: body %s", visible, body)
		}
		if !visible && !strings.Contains(body, strippedAnswer) {
			t.Fatalf("hidden: want the stripped answer: %s", body)
		}
	}
}
