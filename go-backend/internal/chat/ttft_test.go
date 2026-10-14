package chat

import (
	"context"
	"testing"
	"time"
)

func TestWithTurnStart_KeepsFirstStamp(t *testing.T) {
	first := time.Unix(100, 0)
	ctx := withTurnStart(context.Background(), first)
	ctx = withTurnStart(ctx, time.Unix(200, 0))
	got, ok := turnStartFrom(ctx)
	if !ok || !got.Equal(first) {
		t.Fatalf("turn start = %v (ok=%v), want %v", got, ok, first)
	}
}

func TestTTFTRecorder_MarksOnce(t *testing.T) {
	ctx := withTurnStart(context.Background(), time.Now().Add(-2*time.Second))
	r := newTTFTRecorder(ctx, "standard", time.Now().Add(-500*time.Millisecond))
	r.mark()
	firstReq, firstStream := r.sinceRequest, r.sinceStream
	time.Sleep(5 * time.Millisecond)
	r.mark()
	if r.sinceRequest != firstReq || r.sinceStream != firstStream {
		t.Fatal("second mark changed the measurement")
	}
	if firstReq < 2*time.Second || firstStream < 500*time.Millisecond || firstStream >= firstReq {
		t.Fatalf("implausible ttft: request %v, stream %v", firstReq, firstStream)
	}
}

func TestTTFTRecorder_LogFieldsUnmeasured(t *testing.T) {
	r := newTTFTRecorder(context.Background(), "standard", time.Now())
	f := r.logFields()
	if f[1] != int64(-1) || f[3] != int64(-1) {
		t.Fatalf("unmarked recorder log fields = %v, want -1/-1", f)
	}
	r.mark()
	f = r.logFields()
	if f[1] != int64(-1) {
		t.Fatalf("ttft_ms without a request start = %v, want -1", f[1])
	}
}

func TestTTFTPathLabels(t *testing.T) {
	cases := []struct{ got, want string }{
		{ttftPathForResponse(chatResponseParams{}), "standard"},
		{ttftPathForResponse(chatResponseParams{library: true}), "library"},
		{ttftPathForResponse(chatResponseParams{agentMode: "transform_followup"}), "transform_followup"},
		{ttftPathForOrchestrator(""), "deep_chat"},
		{ttftPathForOrchestrator(OrchSupervisor), "supervisor"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("path label = %q, want %q", c.got, c.want)
		}
	}
}
