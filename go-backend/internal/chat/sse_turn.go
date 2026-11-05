package chat

import (
	"context"
	"net/http"

	"github.com/justrag/go-backend/internal/httputil"
)

// sseTurn is a chat turn whose SSE stream went out before the pre-answer
// pipeline ran (chat_sse_early_open_enabled): progress events stream live
// instead of being buffered and replayed after retrieval. The keep-alive
// heartbeat lives in the httputil.SSEStream wrapper it writes through — one
// stream-level heartbeat from open until the handler's deferred Stop, not a
// second per-phase one.
type sseTurn struct {
	ctx context.Context
	w   http.ResponseWriter
}

// openSSETurn starts the SSE stream — headers plus a `: open` comment (which
// flushes them) — and returns the stream wrapper every later frame must go
// through, alongside the turn that emits live progress events. The caller
// reassigns its response writer to the wrapper so frames, error paths and
// the answer phase all share the one serialized writer, and defers the
// wrapper's Stop in the handler (the answer paths' own deferred Stops may
// stop it earlier; Stop is idempotent).
func openSSETurn(ctx context.Context, w http.ResponseWriter) (*httputil.SSEStream, *sseTurn) {
	sw := httputil.StartSSE(ctx, w)
	// An SSE comment is ignored by every client; it exists to flush the
	// headers and mark the stream open.
	_, _ = sw.Write([]byte(": open\n\n"))
	sw.Flush()
	return sw, &sseTurn{ctx: ctx, w: sw}
}

// emit writes one data frame. The wrapper serialises it with the heartbeat.
// A nil turn (flag off) is a no-op.
func (t *sseTurn) emit(data map[string]any) {
	if t == nil {
		return
	}
	writeSSE(t.ctx, t.w, data)
}
