package chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/ai"
	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// thinkingConfigResolver serves a streaming answer that first "thinks": three
// reasoning_content chunks spaced by real-time sleeps, and only then the
// content chunk. With reasoning off (a plain body resolves level ""), the ai
// layer drops every reasoning chunk (internal/ai/stream.go), so the chat
// stream carries no bytes at all during the thinking phase — exactly the
// silence the web frontend's 120 s idle watchdog used to kill (a model that
// reasons by default, e.g. jlu/qwen3.8-27b, is silent for the whole phase).
func thinkingConfigResolver(t *testing.T, think time.Duration) *ai.ConfigResolver {
	t.Helper()
	rest := think / 3
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var probe struct {
			Stream bool `json:"stream"`
		}
		_ = json.Unmarshal(body, &probe)
		if !probe.Stream {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"findings\":[]}"}}]}`))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fl, _ := w.(http.Flusher)
		chunk := func(s string) {
			_, _ = w.Write([]byte(s))
			if fl != nil {
				fl.Flush()
			}
		}
		chunk(`data: {"choices":[{"index":0,"delta":{"reasoning_content":"hm "}}]}` + "\n\n")
		time.Sleep(rest)
		chunk(`data: {"choices":[{"index":0,"delta":{"reasoning_content":"let me think "}}]}` + "\n\n")
		time.Sleep(rest)
		chunk(`data: {"choices":[{"index":0,"delta":{"reasoning_content":"about this "}}]}` + "\n\n")
		time.Sleep(rest)
		chunk(`data: {"choices":[{"index":0,"delta":{"content":"summary text"}}]}` + "\n\n")
		chunk("data: [DONE]\n\n")
	}))
	t.Cleanup(srv.Close)
	store := &chatTestConfigStore{baseURL: srv.URL + "/v1/", model: "fake-model"}
	return ai.NewConfigResolver(store)
}

// TestSendMessage_ReasoningSilenceHeartbeat is the regression test for the
// "Die Antwort hat zu lange gedauert" abort: the stream-level heartbeat
// (httputil.StartSSE) must keep `: ping` bytes flowing while the answer
// provider is thinking with reasoning off, and no reasoning text may leak
// into the frames. The heartbeat interval is shrunken so the ~24 ms thinking
// silence spans several ticks.
func TestSendMessage_ReasoningSilenceHeartbeat(t *testing.T) {
	old := httputil.SSEHeartbeatInterval
	httputil.SSEHeartbeatInterval = 2 * time.Millisecond
	t.Cleanup(func() { httputil.SSEHeartbeatInterval = old })

	values := map[string]*string{
		"citation_validation_enabled": strPtr("false"),
		"factcheck_in_chat":           strPtr("false"),
		"crag_enabled":                strPtr("true"),
	}
	h := NewHandler(newMockStore(), thinkingConfigResolver(t, 24*time.Millisecond), gradedSearcher{},
		WithSiteConfigReader(&fakeSiteConfigReader{values: values}))

	// A cancellable request context mirrors the server, which cancels it
	// when the handler returns. The heartbeat is stopped by the handler's
	// own deferred stream.Stop — the cancel is a backstop for a client
	// disconnect, not what makes the test deterministic.
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	r := httptest.NewRequest(http.MethodPost, "/api/kb/kb1/chat?stream=true", strings.NewReader(`{"message": "hello"}`))
	r.Header.Set("Content-Type", "application/json")
	r = r.WithContext(ctx)
	r = injectUser(r, "user1")
	r = withKBAccess(r, "kb1", kbaccess.RoleOwner, kbaccess.SourcePermissions{})
	r.SetPathValue("id", "kb1")
	w := httptest.NewRecorder()
	h.SendMessage(w, r)

	// The handler's deferred stream.Stop has run by the time it returns, so
	// the body is final: read it, then prove no late ping follows (a ping
	// that wrote after the handler returned would land in a recycled
	// ResponseWriter in production).
	body := w.Body.String()
	time.Sleep(10 * time.Millisecond)
	if again := w.Body.String(); again != body {
		t.Fatalf("bytes arrived after the handler returned:\n%s", again)
	}
	if n := strings.Count(body, ": ping\n\n"); n == 0 {
		t.Fatalf("no heartbeat ping during the 24ms reasoning silence:\n%s", body)
	}
	// With reasoning off, no reasoning text may reach the client at all.
	if strings.Contains(body, "reasoning") {
		t.Fatalf("reasoning leaked into the stream:\n%s", body)
	}
	// Every unit on the wire is a complete frame or a complete ping: a ping
	// that landed mid-frame would leave a corrupt unit behind. The last data
	// frame must be [DONE] (a trailing ping after it is fine).
	units := strings.Split(strings.TrimSuffix(body, "\n\n"), "\n\n")
	var lastData string
	for _, unit := range units {
		switch {
		case unit == ": ping":
		case unit == "data: [DONE]":
			lastData = unit
		case strings.HasPrefix(unit, "data: "):
			if !json.Valid([]byte(strings.TrimPrefix(unit, "data: "))) {
				t.Fatalf("corrupt frame (a ping split it?): %q", unit)
			}
			lastData = unit
		default:
			t.Fatalf("unrecognised unit on the wire: %q", unit)
		}
	}
	if !strings.Contains(body, `data: {"content":"summary text"}`+"\n\n") {
		t.Fatalf("content frame missing or corrupted:\n%s", body)
	}
	if lastData != "data: [DONE]" {
		t.Fatalf("stream not terminated with [DONE], last data frame %q:\n%s", lastData, body)
	}
}
