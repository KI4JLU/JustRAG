package chat

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/justrag/go-backend/internal/httputil"
)

// sseHeartbeatInterval is how often an early-opened turn writes a `: ping`
// comment while the pre-answer pipeline runs. Well inside the FE's 120 s
// idle watchdog and httputil.SSEWriteTimeout (5 min).
const sseHeartbeatInterval = 15 * time.Second

// sseTurn is a streamed chat turn whose SSE headers went out before the
// pre-answer pipeline ran (chat_sse_early_open_enabled). Until handOff, a
// heartbeat goroutine and pipeline progress events share the writer, so
// every write takes mu. After handOff the caller is the only writer again
// and writes with writeSSE directly.
type sseTurn struct {
	ctx      context.Context
	w        http.ResponseWriter
	mu       sync.Mutex
	stop     chan struct{}
	done     chan struct{}
	stopOnce sync.Once
}

// openSSETurn sends the SSE headers plus a `: open` comment (which flushes
// them) and starts the heartbeat.
func openSSETurn(ctx context.Context, w http.ResponseWriter, heartbeat time.Duration) *sseTurn {
	httputil.EnableSSE(w)
	t := &sseTurn{ctx: ctx, w: w, stop: make(chan struct{}), done: make(chan struct{})}
	t.writeComment("open")
	go t.heartbeat(heartbeat)
	return t
}

func (t *sseTurn) heartbeat(every time.Duration) {
	defer close(t.done)
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		select {
		case <-t.stop:
			return
		case <-t.ctx.Done():
			return
		case <-tick.C:
			t.writeComment("ping")
		}
	}
}

// writeComment writes an SSE comment line, which clients ignore; it exists
// to flush headers and keep proxies and idle watchdogs from timing out.
func (t *sseTurn) writeComment(text string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	httputil.RearmSSEWriteDeadline(t.w)
	if _, err := t.w.Write([]byte(": " + text + "\n\n")); err != nil {
		return
	}
	if f, ok := t.w.(http.Flusher); ok {
		f.Flush()
	}
}

// emit writes one data frame. Safe while the heartbeat runs; a nil turn
// (flag off) is a no-op.
func (t *sseTurn) emit(data map[string]any) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	writeSSE(t.ctx, t.w, data)
}

// handOff stops the heartbeat and waits for it to exit, so the caller is
// the only writer afterwards. Idempotent and nil-safe, so a deferred call
// can back up the explicit ones.
func (t *sseTurn) handOff() {
	if t == nil {
		return
	}
	t.stopOnce.Do(func() { close(t.stop) })
	<-t.done
}
