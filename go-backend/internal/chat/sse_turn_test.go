package chat

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/httputil"
)

// TestSSETurn_OpensWithHeadersAndComment verifies the early-open contract:
// SSE headers out, the `: open` comment first, everything flushed. Stop
// before reading the body: the heartbeat must not write after the stream is
// stopped (and the recorder is not safe against a concurrent write).
func TestSSETurn_OpensWithHeadersAndComment(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rec := httptest.NewRecorder()
	sw, _ := openSSETurn(ctx, rec)
	sw.Stop()
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if !strings.HasPrefix(rec.Body.String(), ": open\n\n") {
		t.Fatalf("first bytes = %q, want the `: open` comment", rec.Body.String())
	}
	if !rec.Flushed {
		t.Fatal("headers were not flushed")
	}
}

// TestSSETurn_EmitWritesFrames runs emit against the stream wrapper so the
// -race build sees frame writes serialised with the heartbeat: the interval
// is shrunken (the package var StartSSE reads) and the loop pauses long
// enough for pings to interleave with the frames. (The heartbeat itself is
// covered in internal/httputil.)
func TestSSETurn_EmitWritesFrames(t *testing.T) {
	old := httputil.SSEHeartbeatInterval
	httputil.SSEHeartbeatInterval = 5 * time.Millisecond
	t.Cleanup(func() { httputil.SSEHeartbeatInterval = old })

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rec := httptest.NewRecorder()
	sw, turn := openSSETurn(ctx, rec)
	for i := range 100 {
		turn.emit(map[string]any{"stage": "x", "i": i})
		// A pause longer than the interval, so the heartbeat fires while
		// the stream is open and its pings race the frame writes.
		if i%25 == 24 {
			time.Sleep(10 * time.Millisecond)
		}
	}
	sw.Stop() // no ping may follow; the body read below is then race-free
	body := rec.Body.String()
	if strings.Count(body, `data: {"i":`) != 100 {
		t.Fatal("lost emitted frames")
	}
	if !strings.Contains(body, ": ping\n\n") {
		t.Fatal("no heartbeat ping observed during the pauses")
	}
}

// TestSSETurn_NilIsNoOp: a nil turn (flag off) never touches the writer.
func TestSSETurn_NilIsNoOp(t *testing.T) {
	var turn *sseTurn
	turn.emit(map[string]any{"x": 1})
}
