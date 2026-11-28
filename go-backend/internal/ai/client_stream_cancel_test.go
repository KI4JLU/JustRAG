package ai

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestStreamCancelDoesNotWarn: a caller cancelling a stream on purpose
// (client disconnect, agent stop) is not a truncation worth a WARN.
func TestStreamCancelDoesNotWarn(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl := w.(http.Flusher)
		for i := 0; i < 1000; i++ {
			_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n"))
			fl.Flush()
			select {
			case <-r.Context().Done():
				return
			case <-time.After(5 * time.Millisecond):
			}
		}
	}))
	defer srv.Close()

	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch, err := NewClient(srv.URL, "k").StreamChatCompletion(ctx, ChatRequest{Model: "m", Messages: []ChatMessage{{Role: "user", Content: "hi"}}})
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for range ch {
		n++
		if n == 3 {
			cancel()
		}
	}
	if strings.Contains(buf.String(), "level=WARN") {
		t.Fatalf("intentional cancel logged a warning:\n%s", buf.String())
	}
}

// TestStreamContextEndIsTruncation: when the context ends while the reader is
// stuck on a full channel, the queued content makes room for a terminal
// chunk carrying the context error, so a consumer that reads on sees
// truncated output, never a complete answer. A deadline logs a WARN; a
// deliberate cancel does not. The consumer stays idle until the reader has
// logged, which it does after the terminal send, so the eviction path is the
// one under test and no timer decides the outcome.
func TestStreamContextEndIsTruncation(t *testing.T) {
	cases := []struct {
		name     string
		wantErr  error
		wantWarn bool
	}{
		{name: "deadline", wantErr: context.DeadlineExceeded, wantWarn: true},
		{name: "cancel", wantErr: context.Canceled, wantWarn: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				for i := 0; i < 50; i++ {
					_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n"))
				}
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			defer srv.Close()

			logs := &syncBuffer{}
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
			defer slog.SetDefault(prev)

			ctx := newEndableCtx(tc.wantErr)
			defer ctx.end()
			ch, err := NewClient(srv.URL, "k").StreamChatCompletion(ctx, ChatRequest{Model: "m", Messages: []ChatMessage{{Role: "user", Content: "hi"}}})
			if err != nil {
				t.Fatal(err)
			}
			waitFor(t, "the reader to fill the channel", func() bool { return len(ch) == cap(ch) })
			ctx.end()
			waitFor(t, "the reader to end the stream", func() bool { return strings.Contains(logs.String(), "stream ended by") })

			var got []StreamChunk
			for c := range ch {
				got = append(got, c)
			}
			if len(got) != 1 || !got[0].Done || !errors.Is(got[0].Err, tc.wantErr) {
				t.Fatalf("chunks after the context ended = %+v, want only a Done chunk with an error wrapping %v", got, tc.wantErr)
			}
			if warned := strings.Contains(logs.String(), "level=WARN"); warned != tc.wantWarn {
				t.Fatalf("WARN logged = %v, want %v:\n%s", warned, tc.wantWarn, logs.String())
			}
		})
	}
}

// waitFor polls cond until it holds; the 5 s limit only catches a hang.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for limit := time.Now().Add(5 * time.Second); !cond(); time.Sleep(time.Millisecond) {
		if time.Now().After(limit) {
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}

// syncBuffer is a bytes.Buffer safe for the logger and the test to share.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// endableCtx is a context the test ends by hand with a chosen error.
type endableCtx struct {
	context.Context
	err  error
	done chan struct{}
	once sync.Once
}

func newEndableCtx(err error) *endableCtx {
	return &endableCtx{Context: context.Background(), err: err, done: make(chan struct{})}
}

func (c *endableCtx) Done() <-chan struct{} { return c.done }

func (c *endableCtx) Err() error {
	select {
	case <-c.done:
		return c.err
	default:
		return nil
	}
}

func (c *endableCtx) end() { c.once.Do(func() { close(c.done) }) }
