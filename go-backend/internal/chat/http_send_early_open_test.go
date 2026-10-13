package chat

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/vector"
)

// failingUserMessageStore fails the user-message insert, the second of the
// two late errors SendMessage can hit after the early-open point.
type failingUserMessageStore struct{ *mockStore }

func (s failingUserMessageStore) AddMessage(ctx context.Context, p AddMessageParams) (*MessageRow, error) {
	if p.Role == "user" {
		return nil, errors.New("insert failed")
	}
	return s.mockStore.AddMessage(ctx, p)
}

// gradedSearcher returns one chunk the CRAG grader already called relevant,
// so a crag_enabled turn emits exactly one trajectory event (crag_proceed)
// without any grader call.
type gradedSearcher struct{}

func (gradedSearcher) Search(_ context.Context, _, _ string, _ int, _ vector.SearchOptions) (*vector.SearchResult, error) {
	return &vector.SearchResult{Graded: true, Chunks: []vector.SearchChunk{
		{ID: "c1", FileID: "f1", FileName: "f1.md", Content: "some content", Grade: ai.GradeRelevant},
	}}, nil
}

func (gradedSearcher) ExpandNeighbors(_ context.Context, chunks []vector.SearchChunk, _ int, _, _ string) []vector.SearchChunk {
	return chunks
}

// streamTurn runs one streamed standard-path turn ("hello", one source)
// against the canned fake model and returns the recorder.
func streamTurn(t *testing.T, earlyOpen bool, store Store, extra map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	values := map[string]*string{
		"citation_validation_enabled": strPtr("false"),
		"factcheck_in_chat":           strPtr("false"),
		"crag_enabled":                strPtr("true"),
	}
	if earlyOpen {
		values["chat_sse_early_open_enabled"] = strPtr("true")
	}
	for k, v := range extra {
		values[k] = strPtr(v)
	}
	searcher := gradedSearcher{}
	h := NewHandler(store, wiringConfigResolver(t), searcher, WithSiteConfigReader(&fakeSiteConfigReader{values: values}))

	r := httptest.NewRequest(http.MethodPost, "/api/kb/kb1/chat?stream=true", strings.NewReader(`{"message": "hello"}`))
	r.Header.Set("Content-Type", "application/json")
	r = injectUser(r, "user1")
	r.SetPathValue("id", "kb1")
	w := httptest.NewRecorder()
	h.SendMessage(w, r)
	return w
}

const (
	earlyOpenSourcesFrame = `data: {"chatId":"new-chat-id","enhancedQuery":"","sources":[{"index":1,"fileName":"f1.md","fileId":"f1","content":"some content","score":0,"pages":null}],"userMessageId":"user-msg-id"}` + "\n\n"
	earlyOpenCragFrame    = `data: {"agentTrajectory":{"stage":"decision","decision":"crag_proceed","reason":"relevant_chunks_sufficient"}}` + "\n\n"
	earlyOpenAnswerTail   = `data: {"content":"summary text"}` + "\n\n" + `data: {"aiMessageId":"ai-msg-id"}` + "\n\n" + "data: [DONE]\n\n"
	forceSupervisorPolicy = `[{"when":{"query_type":["lookup"]},"orchestrator":"supervisor","mode":"force"}]`
)

// Flag off: the stream is byte-identical to the pre-early-open output — no
// comment line, opening frame first, trajectory replayed after it.
func TestSendMessage_EarlyOpenOff_StreamUnchanged(t *testing.T) {
	w := streamTurn(t, false, newMockStore(), nil)
	want := earlyOpenSourcesFrame + earlyOpenCragFrame + earlyOpenAnswerTail
	if got := w.Body.String(); got != want {
		t.Fatalf("flag-off body changed:\n got %q\nwant %q", got, want)
	}
}

// Flag on, standard path: `: open` first, the trajectory event live BEFORE
// the opening frame and exactly once (no replay), then the answer + [DONE].
func TestSendMessage_EarlyOpenOn_StandardPath(t *testing.T) {
	w := streamTurn(t, true, newMockStore(), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	want := ": open\n\n" + earlyOpenCragFrame + earlyOpenSourcesFrame + earlyOpenAnswerTail
	if got := w.Body.String(); got != want {
		t.Fatalf("flag-on body:\n got %q\nwant %q", got, want)
	}
}

// Flag on, orchestrator path (tryDeepChat via a forced supervisor): progress
// frames stream live before the opening frame and are not replayed.
func TestSendMessage_EarlyOpenOn_DeepChatPath(t *testing.T) {
	w := streamTurn(t, true, newMockStore(), map[string]string{"chat_orchestrator_policy": forceSupervisorPolicy})
	body := w.Body.String()
	if !strings.HasPrefix(body, ": open\n\n") {
		t.Fatalf("body does not start with the open comment: %q", body)
	}
	if !strings.HasSuffix(body, earlyOpenAnswerTail) {
		t.Fatalf("body does not end with the answer + [DONE]: %q", body)
	}
	dispatch := `data: {"supervisorStage":"dispatch"}`
	if n := strings.Count(body, dispatch); n != 1 {
		t.Fatalf("supervisor progress frame sent %d times, want 1 (live, no replay): %q", n, body)
	}
	if strings.Index(body, dispatch) > strings.Index(body, `"userMessageId"`) {
		t.Fatalf("progress frame arrived after the opening frame: %q", body)
	}
}

// Flag on + the user-message insert fails: the open stream ends with an
// error frame and [DONE] instead of an HTTP 500 after headers went out.
func TestSendMessage_EarlyOpenOn_SaveUserMessageFails(t *testing.T) {
	for name, extra := range map[string]map[string]string{
		"standard": nil,
		// tryDeepChat cannot save either, falls through, and the standard
		// path hits the same failure — still exactly one error + [DONE].
		"deep_chat_fallthrough": {"chat_orchestrator_policy": forceSupervisorPolicy},
	} {
		t.Run(name, func(t *testing.T) {
			w := streamTurn(t, true, failingUserMessageStore{newMockStore()}, extra)
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (stream already open)", w.Code)
			}
			body := w.Body.String()
			tail := `data: {"error":"failed to save user message"}` + "\n\ndata: [DONE]\n\n"
			if !strings.HasPrefix(body, ": open\n\n") || !strings.HasSuffix(body, tail) {
				t.Fatalf("body = %q", body)
			}
			if strings.Count(body, "[DONE]") != 1 {
				t.Fatalf("want exactly one [DONE]: %q", body)
			}
		})
	}
}

// Flag off + the same failure: unchanged HTTP 500.
func TestSendMessage_EarlyOpenOff_SaveUserMessageFailsIs500(t *testing.T) {
	w := streamTurn(t, false, failingUserMessageStore{newMockStore()}, nil)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	if strings.HasPrefix(w.Body.String(), ":") {
		t.Fatalf("flag-off error wrote an SSE comment: %q", w.Body.String())
	}
}

// Flag on + PrepareChatContext fails (the search backend errors).
func TestSendMessage_EarlyOpenOn_PrepareContextFails(t *testing.T) {
	values := map[string]*string{"chat_sse_early_open_enabled": strPtr("true")}
	h := NewHandler(newMockStore(), nil, erroringSearcher{}, WithSiteConfigReader(&fakeSiteConfigReader{values: values}))
	r := httptest.NewRequest(http.MethodPost, "/api/kb/kb1/chat?stream=true", strings.NewReader(`{"message": "hello"}`))
	r.Header.Set("Content-Type", "application/json")
	r = injectUser(r, "user1")
	r.SetPathValue("id", "kb1")
	w := httptest.NewRecorder()
	h.SendMessage(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	want := ": open\n\n" + `data: {"error":"failed to prepare context"}` + "\n\ndata: [DONE]\n\n"
	if got := w.Body.String(); got != want {
		t.Fatalf("body:\n got %q\nwant %q", got, want)
	}
}

// Validation errors are decided before the stream opens: still a 4xx JSON.
func TestSendMessage_EarlyOpenOn_ValidationStill400(t *testing.T) {
	values := map[string]*string{"chat_sse_early_open_enabled": strPtr("true")}
	h := NewHandler(newMockStore(), nil, nil, WithSiteConfigReader(&fakeSiteConfigReader{values: values}))
	r := httptest.NewRequest(http.MethodPost, "/api/kb/kb1/chat?stream=true", strings.NewReader(`{"message": ""}`))
	r.Header.Set("Content-Type", "application/json")
	r = injectUser(r, "user1")
	r.SetPathValue("id", "kb1")
	w := httptest.NewRecorder()
	h.SendMessage(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestChatSSEEarlyOpenEnabled_DefaultOff(t *testing.T) {
	if ChatSSEEarlyOpenEnabled(context.Background(), nil) {
		t.Fatal("nil reader: want default off")
	}
	on := &fakeSiteConfigReader{values: map[string]*string{"chat_sse_early_open_enabled": strPtr("true")}}
	if !ChatSSEEarlyOpenEnabled(context.Background(), on) {
		t.Fatal("key true: want on")
	}
}
