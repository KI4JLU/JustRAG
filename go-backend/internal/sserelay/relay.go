// Package sserelay bridges a Redis pub/sub channel to an HTTP SSE response.
// Workers publish progress events to a Redis channel; Run() forwards them to
// the connected client and stops when the worker sends "__done__", the client
// disconnects, or an inactivity timeout fires.
package sserelay

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"github.com/justrag/go-backend/internal/httputil"
	"github.com/justrag/go-backend/internal/jobs"
	"github.com/justrag/go-backend/internal/logctx"
)

// Options configures a single relay run.
type Options struct {
	// Channel is the Redis pub/sub channel to subscribe to (e.g. "research:abc-123").
	Channel string
	// AbortKey is the Redis key set to "1" when the client disconnects, signalling
	// the worker to stop processing.
	AbortKey string
	// JobType is the Asynq task type to enqueue (e.g. "research:run").
	JobType string
	// JobPayload is the JSON-encoded payload passed to the enqueued task.
	JobPayload []byte
	// InactivityTimeout is the maximum time to wait without receiving a Redis
	// message before terminating the stream. Defaults to 10 minutes.
	InactivityTimeout time.Duration
	// HeartbeatInterval controls how often a heartbeat event is written to keep
	// the connection alive. Defaults to 15 seconds.
	HeartbeatInterval time.Duration
	// SkipEnqueue, when true, skips enqueueing a worker job. Use this when the
	// job was already enqueued by a prior request (e.g. deep-chat SSE relay).
	SkipEnqueue bool
}

// Relay holds the shared dependencies used across relay runs.
type Relay struct {
	redis       *redis.Client
	asynqClient *asynq.Client
}

// New creates a Relay backed by the provided Redis and Asynq clients.
func New(rdb *redis.Client, asynqClient *asynq.Client) *Relay {
	return &Relay{
		redis:       rdb,
		asynqClient: asynqClient,
	}
}

// Run subscribes to opts.Channel, enqueues the worker job, and relays Redis
// messages to w as SSE events. It returns when:
//   - the worker publishes "__done__"
//   - the client disconnects (ctx is cancelled)
//   - no messages arrive within opts.InactivityTimeout
//
// The ctx parameter should come from http.Request.Context() so that Go's HTTP
// server cancels it automatically on client disconnect.
func (r *Relay) Run(ctx context.Context, w http.ResponseWriter, opts Options) error {
	if opts.InactivityTimeout == 0 {
		opts.InactivityTimeout = 10 * time.Minute
	}
	if opts.HeartbeatInterval == 0 {
		opts.HeartbeatInterval = 15 * time.Second
	}

	// Set SSE headers + disable the global server WriteTimeout for this
	// connection before writing any body. Every frame below flows through
	// the wrapper, whose heartbeat pings if the relay goes silent. The
	// deferred Stop makes sure no ping outlives Run (a caller that opened
	// the stream before Run keeps its own — idempotent).
	sw := httputil.StartSSE(ctx, w)
	defer sw.Stop()
	w = sw

	// Subscribe BEFORE enqueuing so we never miss the first event.
	sub := r.redis.Subscribe(ctx, opts.Channel)
	defer sub.Close()

	// Wait for the subscription to be confirmed by Redis before enqueueing.
	// Without this, the worker can publish its first event before the
	// subscription is established, causing a lost message.
	if _, err := sub.Receive(ctx); err != nil {
		return fmt.Errorf("subscribe to %s: %w", opts.Channel, err)
	}

	ch := sub.Channel()

	// Enqueue the worker job (unless the caller has already done so).
	if !opts.SkipEnqueue {
		_, err := r.asynqClient.Enqueue(
			asynq.NewTask(opts.JobType, opts.JobPayload),
			asynq.Queue(jobs.QueueQuick),
			asynq.MaxRetry(1),
			asynq.Timeout(jobs.TimeoutFor(opts.JobType)),
		)
		if err != nil {
			return err
		}
	}

	heartbeat := time.NewTicker(opts.HeartbeatInterval)
	defer heartbeat.Stop()

	inactivity := time.NewTimer(opts.InactivityTimeout)
	defer inactivity.Stop()

	for {
		select {
		case <-ctx.Done():
			// Client disconnected — signal the worker to abort.
			// ctx is already cancelled; WithoutCancel gives us a fresh non-cancellable
			// context that still carries trace / request-id values.
			abortCtx, abortCancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
			r.redis.Set(abortCtx, opts.AbortKey, "1", 24*time.Hour)
			abortCancel()
			return nil

		case msg, ok := <-ch:
			if !ok {
				return nil
			}

			// Reset the inactivity timer every time we receive a message.
			if !inactivity.Stop() {
				select {
				case <-inactivity.C:
				default:
				}
			}
			inactivity.Reset(opts.InactivityTimeout)

			if msg.Payload == "__done__" {
				return nil
			}
			if err := writeSSEEvent(w, msg.Payload); err != nil {
				return r.abortOnWriteError(ctx, opts, err)
			}

		case <-heartbeat.C:
			if err := writeSSEEvent(w, `{"type":"heartbeat"}`); err != nil {
				return r.abortOnWriteError(ctx, opts, err)
			}

		case <-inactivity.C:
			// Best-effort final frame — the relay ends either way.
			_ = writeSSEEvent(w, `{"type":"error","message":"Research timed out due to inactivity"}`)
			return nil
		}
	}
}

// abortOnWriteError handles a failed SSE frame write: the client is gone
// (write error on a streaming ResponseWriter is terminal), so signal the
// worker to abort the same way the ctx.Done() disconnect path does and end
// the relay loop. Returns nil — a dropped client is a normal outcome, not
// a server error.
func (r *Relay) abortOnWriteError(ctx context.Context, opts Options, err error) error {
	logctx.From(ctx).Debug("sserelay: SSE write failed (likely client disconnect); aborting relay", "error", err)
	abortCtx, abortCancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer abortCancel()
	r.redis.Set(abortCtx, opts.AbortKey, "1", 24*time.Hour)
	return nil
}

// SSE frame delimiters, kept as package-level byte slices so each frame write
// avoids re-allocating the constant prefix/suffix.
var (
	sseDataPrefix = []byte("data: ")
	sseFrameEnd   = []byte("\n\n")
)

// sseFramePool reuses the per-frame buffer: writeSSEEvent assembles the whole
// frame in it and returns it to the pool before it returns, so the pool
// amortizes the allocation across the stream.
var sseFramePool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

// writeSSEEvent writes a single SSE data frame and flushes the response
// writer. The whole frame goes out in ONE Write: split across several writes
// it could interleave with the stream-level heartbeat's `: ping` and the
// client would see a broken frame (SSEStream's mutex only serialises whole
// Write calls). The frame is assembled in a pooled buffer instead of the
// per-frame make a fresh slice would incur (or the boxing + format
// machinery fmt.Fprintf adds) — at 30-60 frames/s per stream that is
// measurable GC pressure.
//
// Returns the write error: on a streaming ResponseWriter that means the
// client is gone and the relay loop should stop instead of draining the rest
// of the worker's events into a dead connection.
func writeSSEEvent(w http.ResponseWriter, data string) error {
	buf := sseFramePool.Get().(*bytes.Buffer)
	buf.Reset()
	buf.Write(sseDataPrefix)
	buf.WriteString(data)
	buf.Write(sseFrameEnd)
	defer sseFramePool.Put(buf)
	// Slide the write deadline forward so a half-open client can only
	// block this write for SSEWriteTimeout, not forever (while blocked
	// here, the inactivity/heartbeat select can't fire).
	httputil.RearmSSEWriteDeadline(w)
	if _, err := w.Write(buf.Bytes()); err != nil {
		return err
	}
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	return nil
}
