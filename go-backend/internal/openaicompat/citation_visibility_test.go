package openaicompat_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/openaicompat"
	"github.com/justrag/go-backend/internal/vector"
)

// The fake model's answer with and without its marker (hand-written oracle).
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

// The key owner's capability is resolved by the handler itself (no
// RequireKBRole on this route): a viewer without seeCitations gets no
// context.citations, no annotations and no markers, in both modes; with the
// flag, or as KB admin, all three are there.
func TestChatCompletions_CitationVisibility(t *testing.T) {
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
		for _, stream := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s, stream=%v", c.name, stream), func(t *testing.T) {
				store := &mockStore{kbByID: &kbaccess.KnowledgeBase{ID: testKBID, Sources: c.flags}, kbRole: c.role}
				h := openaicompat.NewHandler(store, citingResolver(t), oneChunkSearcher{})
				req := newRequest(http.MethodPost, "/openai/v1/chat/completions", map[string]any{
					"model":    "kb-" + testKBID,
					"stream":   stream,
					"messages": []map[string]string{{"role": "user", "content": "Frist?"}},
				})
				req = req.WithContext(auth.WithUser(req.Context(), &auth.Claims{ID: testUserID, Role: "user"}))
				rr := httptest.NewRecorder()
				h.ChatCompletions(rr, req)
				if rr.Code != http.StatusOK {
					t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
				}
				body := rr.Body.String()
				answer := completionText(t, body, stream)
				leaks := strings.Contains(body, "geheim.pdf") || strings.Contains(body, "Quelltext") ||
					strings.Contains(body, `"annotations"`) || strings.Contains(body, `"citations"`)
				if c.visible {
					if !leaks || answer != citedAnswer {
						t.Fatalf("want citations: answer %q body %s", answer, body)
					}
				} else if leaks || answer != strippedAnswer {
					t.Fatalf("want no citations: answer %q body %s", answer, body)
				}
			})
		}
	}
}

func completionText(t *testing.T, body string, stream bool) string {
	t.Helper()
	type msg struct {
		Content string `json:"content"`
	}
	if !stream {
		var resp struct {
			Choices []struct {
				Message msg `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(body), &resp); err != nil || len(resp.Choices) == 0 {
			t.Fatalf("body %s: %v", body, err)
		}
		return resp.Choices[0].Message.Content
	}
	var b strings.Builder
	for _, line := range strings.Split(body, "\n") {
		data, ok := strings.CutPrefix(line, "data: ")
		if !ok || data == "[DONE]" {
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta msg `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(data), &chunk) == nil && len(chunk.Choices) > 0 {
			b.WriteString(chunk.Choices[0].Delta.Content)
		}
	}
	return b.String()
}
