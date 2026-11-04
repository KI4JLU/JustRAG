package httputil

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// SSEHeartbeatInterval is the silence threshold of StartSSE's heartbeat: a
// stream silent for at least this long gets a `: ping` comment. The ticker
// checks once per interval, so a silent stretch may last up to twice this
// long before the next ping. Both bounds sit far below the client-side idle
// watchdogs (the web frontend aborts at 120 s — see
// web/src/hooks/useChatStream.ts) and comfortably inside SSEWriteTimeout.
//
// It is a var, not a const, so the slow-stream tests can shrink it to a few
// milliseconds and observe a heartbeat without sleeping 15 s. Restore the
// previous value after such a test (package tests run sequentially, so this is
// race-free in practice).
var SSEHeartbeatInterval = 15 * time.Second

// ssePing is the keep-alive comment. A line starting with `:` is an SSE
// comment: the WHATWG Server-Sent Events spec says clients ignore it, and
// the web parser and the OpenAI-compatible clients comply. It still counts
// as bytes on the wire, which is all an idle watchdog needs to stay quiet.
// Surfaces whose client is not in this repository (/owui, OpenAI-compat,
// public API) document the comment in their contracts.
const ssePing = ": ping\n\n"

// SSEStream is the http.ResponseWriter that every SSE endpoint writes its
// frames through after calling StartSSE. On top of the plain response writer
// it provides a single stream-level heartbeat:
//
//   - it serialises every write with a mutex, so the heartbeat's `: ping` can
//     never interleave with a frame — provided each frame is emitted in ONE
//     Write (fmt.Fprintf/fmt.Fprint qualify; a frame split across several
//     Write calls does not, and must be buffered first);
//   - it records the time of the last write and, when the stream has been
//     silent for at least the heartbeat interval, writes a `: ping` comment
//     from a background goroutine (the ticker checks once per interval, so a
//     silent stretch may last up to twice the interval);
//   - it re-arms the sliding SSEWriteTimeout on every write (frame or ping);
//   - it lives from StartSSE until Stop — the caller MUST defer Stop in the
//     function that starts the stream. That is what makes the stream safe at
//     handler end: the request context is cancelled only AFTER the handler
//     returns, and net/http flushes the buffered ResponseWriter back to its
//     shared pool right after that, so a context check alone cannot keep a
//     late ping out of a recycled buffer. Once Stop returns, no ping is in
//     flight and none will start, so the handler may return. The request
//     context ending additionally stops the goroutine, covering client
//     disconnects.
//
// A stream-level heartbeat (rather than per-phase keep-alives) covers every
// silent stretch of a turn: hidden model reasoning, long tool calls,
// orchestrator steps, slow upstream gaps, and the post-answer work before the
// terminal frame.
type SSEStream struct {
	w   http.ResponseWriter
	ctx context.Context
	mu  sync.Mutex
	// stopped is set by Stop under mu; pingIfSilent checks it under the same
	// lock, so once Stop returns no ping can be in flight (see the type doc).
	stopped bool
	last    time.Time
	stop    chan struct{}
	once    sync.Once
}

// StartSSE prepares w for Server-Sent Events — the standard SSE headers
// (including X-Accel-Buffering: no so nginx does not buffer the stream) and
// the first sliding SSEWriteTimeout window — and starts the stream heartbeat.
// It returns the wrapped writer every frame must go through. The caller
// reassigns its response writer to the stream and defers a Stop:
//
//	sw := httputil.StartSSE(r.Context(), w)
//	defer sw.Stop() // no ping may outlive this handler — see the type doc
//	w = sw
//
// The deferred Stop is not optional: it is what guarantees no heartbeat write
// lands on the ResponseWriter after the handler returns. SSE streams stay
// open far longer than any request timeout; per-handler inactivity / context
// cancellation governs their lifetime instead (a client disconnect also ends
// the heartbeat through the request context).
//
// Calling StartSSE on an already-wrapped writer is a no-op that returns the
// existing stream, so a stream opened early (the chat early-open path) is not
// re-wrapped — and does not gain a second heartbeat — when the answer path
// calls StartSSE again. Each such call site still defers its own Stop; Stop
// is idempotent, so the extra calls only take effect if they run first.
func StartSSE(ctx context.Context, w http.ResponseWriter) *SSEStream {
	return startSSE(ctx, w, SSEHeartbeatInterval)
}

// StartSSEWithInterval is StartSSE with an explicit silence threshold. The
// tests use a few milliseconds so a heartbeat is observable quickly.
func StartSSEWithInterval(ctx context.Context, w http.ResponseWriter, interval time.Duration) *SSEStream {
	return startSSE(ctx, w, interval)
}

func startSSE(ctx context.Context, w http.ResponseWriter, interval time.Duration) *SSEStream {
	if s, ok := w.(*SSEStream); ok {
		return s
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	// First sliding write window; every frame and ping re-arms it.
	RearmSSEWriteDeadline(w)

	s := &SSEStream{
		w:    w,
		ctx:  ctx,
		last: time.Now(),
		stop: make(chan struct{}),
	}
	if interval > 0 && ctx != nil {
		go s.heartbeat(interval)
	}
	return s
}

// heartbeat writes a `: ping` comment whenever the stream has been silent for
// interval. It exits when the stream is stopped, the request context ends, or
// a write fails (the client is gone).
func (s *SSEStream) heartbeat(interval time.Duration) {
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-s.ctx.Done():
			return
		case <-tick.C:
			if s.pingIfSilent(interval) {
				return
			}
		}
	}
}

// pingIfSilent writes one `: ping` comment when the stream has been silent for
// at least interval and reports whether the heartbeat should stop. The whole
// check-and-write happens under the mutex so a ping can never interleave with
// a frame write. The stopped flag is what makes the stream safe at handler
// end: Stop sets it under this same lock, so once the caller's deferred Stop
// has returned, no ping is in flight and none can start — a late ping landing
// on a ResponseWriter whose handler already returned would corrupt whatever
// connection the server recycles the buffer to. The context check below only
// covers client disconnects. It returns true when the stream is stopped, the
// request is over, or the write failed — in all three cases the client will
// not read any further ping.
func (s *SSEStream) pingIfSilent(interval time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	// A tick can be in flight when Stop sets the flag; honour it so Stop is
	// fully effective, not just "from the next tick on".
	if s.stopped {
		return true
	}
	if time.Since(s.last) < interval {
		return false
	}
	if err := s.ctx.Err(); err != nil {
		return true
	}
	RearmSSEWriteDeadline(s.w)
	if _, err := s.w.Write([]byte(ssePing)); err != nil {
		return true
	}
	s.last = time.Now()
	if f, ok := s.w.(http.Flusher); ok {
		f.Flush()
	}
	return false
}

// Write serialises the frame write with the heartbeat, re-arms the sliding
// write deadline, and records the write time so it suppresses pings while
// frames are flowing. A frame must arrive as a single Write (see the type
// doc); Write does not flush — the endpoints flush after each frame as before.
func (s *SSEStream) Write(b []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	RearmSSEWriteDeadline(s.w)
	n, err := s.w.Write(b)
	if err != nil {
		// A failed frame write means the client is gone; stop pinging it.
		s.closeStop()
		return n, err
	}
	s.last = time.Now()
	return n, nil
}

// Stop terminates the heartbeat and must be deferred by every caller of
// StartSSE (see the type doc for why the request context alone is not
// enough). It takes the same mutex a ping write takes, sets the stopped flag
// and closes the stop channel, so when Stop returns no ping is in flight and
// none will start — a handler may then return safely. It is idempotent, and
// the first Stop wins: at nested sites (an answer path inside an
// early-opened turn, a relay inside an already-open stream) the inner Stop
// stops the shared stream for the rest of the outer handler too — keep slow
// work before the inner call, not after.
func (s *SSEStream) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopped = true
	s.closeStop()
}

func (s *SSEStream) closeStop() {
	s.once.Do(func() { close(s.stop) })
}

// Header, WriteHeader and Flush delegate to the wrapped writer so the
// endpoints keep using w.Header()/w.(http.Flusher) unchanged.
func (s *SSEStream) Header() http.Header { return s.w.Header() }
func (s *SSEStream) WriteHeader(status int) {
	s.w.WriteHeader(status)
}

// Flush takes the same mutex as Write: the endpoints flush right after each
// frame write without holding any lock of their own, so an unserialised
// flush could run concurrently with the heartbeat's write+flush and interleave
// with the frame it belongs to (and race on writers that are not internally
// locked, such as the test recorders). Flush is a no-op when the underlying
// writer does not support flushing.
func (s *SSEStream) Flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if f, ok := s.w.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap lets http.NewResponseController walk through the wrapper to the
// real writer, so RearmSSEWriteDeadline calls the endpoints already make
// keep working (and stdlib writers serialise deadlines internally).
func (s *SSEStream) Unwrap() http.ResponseWriter { return s.w }
