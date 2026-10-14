package chat

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSSETurn_OpensWithHeadersAndComment(t *testing.T) {
	rec := httptest.NewRecorder()
	turn := openSSETurn(context.Background(), rec, time.Hour)
	turn.handOff()
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if !strings.HasPrefix(rec.Body.String(), ":") {
		t.Fatalf("first bytes = %q, want an SSE comment", rec.Body.String())
	}
	if !rec.Flushed {
		t.Fatal("headers were not flushed")
	}
}

func TestSSETurn_HeartbeatStopsOnHandOff(t *testing.T) {
	rec := httptest.NewRecorder()
	turn := openSSETurn(context.Background(), rec, 5*time.Millisecond)
	time.Sleep(30 * time.Millisecond)
	turn.handOff()
	n := strings.Count(rec.Body.String(), ": ping")
	if n == 0 {
		t.Fatal("no heartbeat written")
	}
	time.Sleep(30 * time.Millisecond)
	if strings.Count(rec.Body.String(), ": ping") != n {
		t.Fatal("heartbeat kept writing after handOff")
	}
	turn.handOff() // idempotent
}

func TestSSETurn_EmitDuringHeartbeatIsRaceFree(t *testing.T) {
	rec := httptest.NewRecorder()
	turn := openSSETurn(context.Background(), rec, time.Millisecond)
	for i := range 100 {
		turn.emit(map[string]any{"stage": "x", "i": i})
	}
	turn.handOff()
	if strings.Count(rec.Body.String(), `data: {"i":`) != 100 {
		t.Fatal("lost emitted frames")
	}
}

func TestSSETurn_NilIsNoOp(t *testing.T) {
	var turn *sseTurn
	turn.emit(map[string]any{"x": 1})
	turn.handOff()
}

// A cancelled request context ends the heartbeat on its own; handOff after
// that must still return instead of blocking on the done channel.
func TestSSETurn_HandOffAfterContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	turn := openSSETurn(ctx, httptest.NewRecorder(), time.Millisecond)
	cancel()
	finished := make(chan struct{})
	go func() { turn.handOff(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("handOff blocked after the request context was cancelled")
	}
}
