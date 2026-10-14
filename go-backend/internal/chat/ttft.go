package chat

import (
	"context"
	"sync"
	"time"

	"github.com/justrag/go-backend/internal/observability"
)

type turnStartKey struct{}

// withTurnStart stamps the moment a chat request arrived, so the streaming
// tail can measure time to first token across the whole pre-answer pipeline.
// An existing stamp is kept: the first handler to see the request wins.
func withTurnStart(ctx context.Context, t time.Time) context.Context {
	if _, ok := turnStartFrom(ctx); ok {
		return ctx
	}
	return context.WithValue(ctx, turnStartKey{}, t)
}

func turnStartFrom(ctx context.Context) (time.Time, bool) {
	t, ok := ctx.Value(turnStartKey{}).(time.Time)
	return t, ok
}

// ttftRecorder observes the first answer frame (content or reasoning) a
// streaming turn writes to the client, exactly once.
type ttftRecorder struct {
	path         string
	turnStart    time.Time // zero when the handler recorded none
	streamStart  time.Time
	once         sync.Once
	sinceRequest time.Duration
	sinceStream  time.Duration
}

func newTTFTRecorder(ctx context.Context, path string, streamStart time.Time) *ttftRecorder {
	r := &ttftRecorder{path: path, streamStart: streamStart}
	if t, ok := turnStartFrom(ctx); ok {
		r.turnStart = t
	}
	return r
}

func (r *ttftRecorder) mark() {
	r.once.Do(func() {
		now := time.Now()
		r.sinceStream = now.Sub(r.streamStart)
		if !r.turnStart.IsZero() {
			r.sinceRequest = now.Sub(r.turnStart)
		}
		observability.RecordChatTTFT(r.path, r.sinceRequest, r.sinceStream)
	})
}

// logFields returns the measured TTFTs for the rag.completion log line; -1
// means "not measured" (no frame was written, or no request start was known).
func (r *ttftRecorder) logFields() []any {
	ttft, answer := int64(-1), int64(-1)
	if r.sinceStream > 0 {
		answer = r.sinceStream.Milliseconds()
	}
	if r.sinceRequest > 0 {
		ttft = r.sinceRequest.Milliseconds()
	}
	return []any{"ttft_ms", ttft, "answer_ttft_ms", answer}
}

// ttftPathForResponse labels a writeStreamingResponse turn.
func ttftPathForResponse(p chatResponseParams) string {
	switch {
	case p.library:
		return "library"
	case p.agentMode == "transform_followup":
		return "transform_followup"
	default:
		return "standard"
	}
}

// ttftPathForOrchestrator labels a tryDeepChat turn; the empty orchestrator
// is the legacy RunDeepChat.
func ttftPathForOrchestrator(o Orchestrator) string {
	if o == "" {
		return "deep_chat"
	}
	return string(o)
}
