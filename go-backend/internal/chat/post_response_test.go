package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/prompts"
)

// stubSiteConfigFactcheckOnly turns the factcheck on and the citation
// validator off, so the post-response fan-out runs exactly the follow-up
// and factcheck LLM calls.
type stubSiteConfigFactcheckOnly struct{}

func (stubSiteConfigFactcheckOnly) GetSiteConfigValue(_ context.Context, key string) (*string, error) {
	v := ""
	switch key {
	case "factcheck_in_chat":
		v = "true"
	case "citation_validation_enabled":
		v = "false"
	default:
		return nil, nil
	}
	return &v, nil
}

// followUpsVsFactcheckServer answers the follow-up prompt at once and holds
// every other completion (the factcheck) until release is closed.
func followUpsVsFactcheckServer(t *testing.T, release <-chan struct{}) *httptest.Server {
	t.Helper()
	followUpSystem := prompts.FollowUpQuestionsSystem("de")
	mux := http.NewServeMux()
	mux.HandleFunc("/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		content := `{"verified":true,"score":1,"issues":[]}`
		isFollowUp := len(req.Messages) > 0 && req.Messages[0].Content == followUpSystem
		if isFollowUp {
			content = `["a?"]`
		} else {
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": content}}},
		})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// TestRunPostResponseTasks_FollowUpsEmittedBeforeFactcheckEnds pins the
// latency contract: with a streaming emit, the followUpQuestions frame goes
// out the moment the follow-up call returns, not after the factcheck.
func TestRunPostResponseTasks_FollowUpsEmittedBeforeFactcheckEnds(t *testing.T) {
	releaseFactcheck := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseFactcheck) }) }

	srv := followUpsVsFactcheckServer(t, releaseFactcheck)
	// Registered after the server so it runs first (cleanups are LIFO):
	// srv.Close waits for the held factcheck request.
	t.Cleanup(release)
	h := NewHandler(newMockStore(), ai.NewConfigResolver(&chatTestConfigStore{baseURL: srv.URL, model: "fake-model"}), nil,
		WithSiteConfigReader(stubSiteConfigFactcheckOnly{}),
	)

	gotFollowUps := make(chan []string, 1)
	var (
		mu     sync.Mutex
		frames int
	)
	emit := func(pl map[string]any) {
		mu.Lock()
		defer mu.Unlock()
		if fu, ok := pl["followUpQuestions"]; ok {
			frames++
			if qs, ok := fu.([]string); ok && frames == 1 {
				gotFollowUps <- qs
			}
		}
	}

	type result struct{ followUps []string }
	done := make(chan result, 1)
	go func() {
		fu, _, _ := h.runPostResponseTasks(context.Background(), "q", "a", "ctx", "kb-1", "de", "ai-msg-1", nil, emit, nil)
		done <- result{fu}
	}()

	select {
	case qs := <-gotFollowUps:
		if !reflect.DeepEqual(qs, []string{"a?"}) {
			t.Fatalf("followUpQuestions frame = %v, want [a?]", qs)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("followUpQuestions frame waited for the factcheck")
	}
	release()

	select {
	case res := <-done:
		if !reflect.DeepEqual(res.followUps, []string{"a?"}) {
			t.Fatalf("returned follow-ups = %v, want [a?]", res.followUps)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("runPostResponseTasks did not return after the factcheck was released")
	}
	mu.Lock()
	defer mu.Unlock()
	if frames != 1 {
		t.Fatalf("followUpQuestions frames emitted = %d, want exactly 1", frames)
	}
}

// TestRunPostResponseTasks_NilEmitStillReturnsFollowUps keeps the
// non-streaming contract: no emit, follow-ups come back as the return value.
func TestRunPostResponseTasks_NilEmitStillReturnsFollowUps(t *testing.T) {
	releaseFactcheck := make(chan struct{})
	close(releaseFactcheck)
	srv := followUpsVsFactcheckServer(t, releaseFactcheck)
	h := NewHandler(newMockStore(), ai.NewConfigResolver(&chatTestConfigStore{baseURL: srv.URL, model: "fake-model"}), nil,
		WithSiteConfigReader(stubSiteConfigFactcheckOnly{}),
	)
	fu, _, _ := h.runPostResponseTasks(context.Background(), "q", "a", "ctx", "kb-1", "de", "ai-msg-1", nil, nil, nil)
	if !reflect.DeepEqual(fu, []string{"a?"}) {
		t.Fatalf("follow-ups = %v, want [a?]", fu)
	}
}
