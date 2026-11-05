package chat

import (
	"context"
	"sync"

	"github.com/justrag/go-backend/internal/logctx"
)

// trajectoryStageReasoning marks, in a stored trajectory, where the answer
// model's reasoning began: the recorder appends it when the turn's first
// `{"reasoning": …}` frame goes out. It carries no text — the reasoning
// itself is messages.reasoning — so a client can place the thinking among
// the steps where it happened. Never emitted as an agentTrajectory frame.
const trajectoryStageReasoning = "reasoning"

// maxStoredTrajectoryEvents bounds the steps stored with one answer. The
// orchestrators' own hop and round caps keep a turn far below it; it guards
// the row against a runaway loop, not normal turns.
const maxStoredTrajectoryEvents = 100

// trajectoryRecorder collects the steps of one chat turn in the order they
// went out on the wire, so the answer can be stored with them
// (messages.trajectory). writeSSE feeds it: every frame of a turn passes
// there — whichever orchestrator, early-open turn, degenerate guard or
// post-response task wrote it — so what is stored is exactly what the user
// saw live. Events an orchestrator buffered and then dropped (it failed and
// the turn fell through) never reach writeSSE and are not stored either.
//
// It sees each frame before the CitationFilter does: like sources, the
// steps are stored in full and redacted per reader on the way out
// (RedactMessagesForReader).
//
// Safe for concurrent use: the post-response tasks (follow-ups and
// factcheck) emit from parallel goroutines.
type trajectoryRecorder struct {
	mu        sync.Mutex
	events    []TrajectoryEvent
	reasoning bool
}

type trajectoryRecorderKey struct{}

// withTrajectoryRecorder attaches a fresh recorder for one chat turn.
func withTrajectoryRecorder(ctx context.Context) context.Context {
	return context.WithValue(ctx, trajectoryRecorderKey{}, &trajectoryRecorder{})
}

// trajectoryRecorderFrom returns the turn's recorder, or nil (every method
// is nil-safe) on paths that attach none: eval, the public API, tests.
func trajectoryRecorderFrom(ctx context.Context) *trajectoryRecorder {
	r, _ := ctx.Value(trajectoryRecorderKey{}).(*trajectoryRecorder)
	return r
}

// observe records data when it is an agentTrajectory frame, or the turn's
// first reasoning frame (as a trajectoryStageReasoning marker). Every other
// frame is ignored.
func (r *trajectoryRecorder) observe(data any) {
	if r == nil {
		return
	}
	switch m := data.(type) {
	case map[string]string:
		if _, ok := m["reasoning"]; ok {
			r.mu.Lock()
			if !r.reasoning {
				r.reasoning = true
				r.events = append(r.events, TrajectoryEvent{Stage: trajectoryStageReasoning})
			}
			r.mu.Unlock()
		}
	case map[string]any:
		var evt TrajectoryEvent
		switch e := m["agentTrajectory"].(type) {
		case TrajectoryEvent:
			evt = e
		case *TrajectoryEvent:
			if e == nil {
				return
			}
			evt = *e
		default:
			return
		}
		r.mu.Lock()
		r.events = append(r.events, evt)
		r.mu.Unlock()
	}
}

// count returns how many events were recorded so far.
func (r *trajectoryRecorder) count() int {
	if r == nil {
		return 0
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.events)
}

// stored returns the recorded steps in the shape messages.trajectory keeps,
// or nil when there is nothing worth storing: no events, or only the
// reasoning marker (the reasoning alone needs no position).
//
// RefinedText is dropped: it is the full corrected answer, which the
// message's content already holds once the refine is persisted — keeping it
// would store the answer twice. The word-level Diff stays; it is what the
// step shows. Beyond maxStoredTrajectoryEvents the tail is cut.
func (r *trajectoryRecorder) stored() []TrajectoryEvent {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	steps := 0
	for _, e := range r.events {
		if e.Stage != trajectoryStageReasoning {
			steps++
		}
	}
	if steps == 0 {
		return nil
	}
	n := min(len(r.events), maxStoredTrajectoryEvents)
	out := make([]TrajectoryEvent, n)
	copy(out, r.events[:n])
	for i := range out {
		out[i].RefinedText = ""
	}
	return out
}

// persistLateTrajectory stores the turn's steps again when frames written
// after AddMessage added any (the refine_start / refine_complete events of
// the post-response tasks). saved is the recorder's count when the message
// was stored. Best-effort: a failed write keeps the earlier steps and logs.
func (h *Handler) persistLateTrajectory(ctx context.Context, messageID string, saved int) {
	rec := trajectoryRecorderFrom(ctx)
	if rec.count() <= saved {
		return
	}
	if err := h.store.UpdateMessageTrajectory(ctx, messageID, rec.stored()); err != nil {
		logctx.From(ctx).Warn("chat: persist late trajectory steps", "messageId", messageID, "error", err)
	}
}
