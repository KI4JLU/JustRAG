package httputil

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// syncRecorder is an httptest.ResponseRecorder behind a mutex: the heartbeat
// goroutine writes to it while the test polls the body, and the recorder's
// buffer is not safe for that.
type syncRecorder struct {
	*httptest.ResponseRecorder
	mu sync.Mutex
}

func newSyncRecorder() *syncRecorder {
	return &syncRecorder{ResponseRecorder: httptest.NewRecorder()}
}

func (r *syncRecorder) Write(b []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ResponseRecorder.Write(b)
}

func (r *syncRecorder) Flush() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ResponseRecorder.Flush()
}

func (r *syncRecorder) body() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ResponseRecorder.Body.String()
}

// countPings counts the `: ping` comment frames in an SSE body.
func countPings(body string) int {
	return strings.Count(body, ssePing)
}

// waitForPings polls until at least one ping has landed or the deadline
// passes.
func waitForPings(t *testing.T, rec *syncRecorder) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if countPings(rec.body()) > 0 {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("no heartbeat ping within 2s of silence")
}

// TestSSEStream_PingsAfterIdleInterval opens a stream, writes nothing, and
// expects the heartbeat to keep the wire busy after the interval.
func TestSSEStream_PingsAfterIdleInterval(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rec := newSyncRecorder()
	s := StartSSEWithInterval(ctx, rec, 10*time.Millisecond)
	defer s.Stop()

	waitForPings(t, rec)
}

// TestSSEStream_QuietWhileFramesFlow writes a frame faster than the interval
// the whole time and expects zero pings: the watchdog only needs bytes when
// the stream would otherwise go silent.
func TestSSEStream_QuietWhileFramesFlow(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rec := newSyncRecorder()
	s := StartSSEWithInterval(ctx, rec, 10*time.Millisecond)
	defer s.Stop()

	for i := range 50 {
		if _, err := s.Write([]byte("data: x\n\n")); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
		time.Sleep(time.Millisecond)
	}
	if n := countPings(rec.body()); n != 0 {
		t.Fatalf("got %d pings while frames were flowing", n)
	}
}

// TestSSEStream_PingNeverSplitsFrame hammers the writer from several
// goroutines while the heartbeat pings: every byte on the wire must be either
// a complete frame or a complete ping. Run with -race.
func TestSSEStream_PingNeverSplitsFrame(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rec := newSyncRecorder()
	s := StartSSEWithInterval(ctx, rec, 2*time.Millisecond)
	defer s.Stop()

	const (
		goroutines = 4
		framesEach = 50
	)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for g := range goroutines {
		go func(g int) {
			defer wg.Done()
			for i := range framesEach {
				if _, err := s.Write([]byte("data: {\"g\":" + itoa(g) + ",\"i\":" + itoa(i) + "}\n\n")); err != nil {
					t.Errorf("g%d write %d: %v", g, i, err)
					return
				}
				time.Sleep(100 * time.Microsecond)
			}
		}(g)
	}
	wg.Wait()

	// Let at least one tick fire after the writes so the test actually saw
	// pings interleaved with (or right after) the frame traffic.
	time.Sleep(5 * time.Millisecond)
	s.Stop()
	// Synchronisation barrier: the heartbeat only writes while holding the
	// mutex, so once this Write (which takes the same mutex) returns, every
	// ping it ever sent is in the recorder.
	if _, err := s.Write(nil); err != nil {
		t.Fatalf("barrier write: %v", err)
	}

	body := rec.body()
	if countPings(body) == 0 {
		t.Fatal("no pings written at all — the test did not exercise interleaving")
	}
	// Every unit on the wire ends in \n\n, so splitting on \n\n yields the
	// exact frame/ping sequence a client would parse.
	seen := make(map[string]int)
	for _, chunk := range strings.Split(strings.TrimSuffix(body, "\n\n"), "\n\n") {
		switch {
		case chunk == ": ping":
		case strings.HasPrefix(chunk, "data: {"):
			// data: {"g":<g>,"i":<i>}
			payload := strings.TrimPrefix(chunk, "data: ")
			seen[payload]++
		default:
			t.Fatalf("corrupt unit on the wire: %q (a ping split a frame)", chunk)
		}
	}
	if len(seen) != goroutines*framesEach {
		t.Fatalf("got %d distinct frames, want %d (some were lost or corrupted)", len(seen), goroutines*framesEach)
	}
	for p, n := range seen {
		if n != 1 {
			t.Fatalf("frame %q appears %d times", p, n)
		}
	}
}

// TestSSEStream_StopsWhenContextCancels covers the production stop path: the
// request context is cancelled when the handler returns, and the heartbeat
// must go quiet with it.
func TestSSEStream_StopsWhenContextCancels(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	rec := newSyncRecorder()
	s := StartSSEWithInterval(ctx, rec, 5*time.Millisecond)
	defer s.Stop()

	waitForPings(t, rec)
	// Simulate the handler returning: the request context is cancelled.
	cancel()
	time.Sleep(10 * time.Millisecond)
	n := countPings(rec.body())
	time.Sleep(30 * time.Millisecond)
	if m := countPings(rec.body()); m != n {
		t.Fatalf("heartbeat kept pinging after context cancel (%d → %d)", n, m)
	}
}

// TestSSEStream_StopIsDeterministic verifies Stop() ends the heartbeat and is
// idempotent.
func TestSSEStream_StopIsDeterministic(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rec := newSyncRecorder()
	s := StartSSEWithInterval(ctx, rec, 5*time.Millisecond)

	waitForPings(t, rec)
	s.Stop()
	s.Stop() // idempotent
	time.Sleep(10 * time.Millisecond)
	n := countPings(rec.body())
	time.Sleep(30 * time.Millisecond)
	if m := countPings(rec.body()); m != n {
		t.Fatalf("heartbeat kept pinging after Stop (%d → %d)", n, m)
	}
}

// blockingWriter blocks every Write until release is closed, so the test can
// catch the heartbeat's ping mid-Write.
type blockingWriter struct {
	*httptest.ResponseRecorder
	once     sync.Once
	inFlight chan struct{} // closed when a Write first enters
	release  chan struct{} // Writes block until this is closed
}

func (b *blockingWriter) Write(p []byte) (int, error) {
	b.once.Do(func() { close(b.inFlight) })
	<-b.release
	return b.ResponseRecorder.Write(p)
}

// TestSSEStream_StopWaitsForInFlightPing is the regression test for the
// handler-end race: Stop must not return while a ping's Write is still in
// flight, because the handler returns (and the server recycles the writer's
// buffer) as soon as its deferred Stops have all returned. If Stop did not
// take the same mutex the ping write holds, it would return here while that
// Write is still blocked. Run with -race.
func TestSSEStream_StopWaitsForInFlightPing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bw := &blockingWriter{
		ResponseRecorder: httptest.NewRecorder(),
		inFlight:         make(chan struct{}),
		release:          make(chan struct{}),
	}
	s := StartSSEWithInterval(ctx, bw, 5*time.Millisecond)

	select {
	case <-bw.inFlight: // a ping's Write has entered and holds the stream mutex
	case <-time.After(2 * time.Second):
		t.Fatal("no ping write started within 2s")
	}

	stopDone := make(chan struct{})
	go func() {
		s.Stop()
		close(stopDone)
	}()

	select {
	case <-stopDone:
		t.Fatal("Stop returned while the ping's Write was still blocked")
	case <-time.After(100 * time.Millisecond):
	}

	close(bw.release)
	select {
	case <-stopDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not return after the blocked Write was released")
	}
}

// TestSSEStream_InFlightTickHonoursStopFlag covers the flag half of the
// handler-end fix: a tick already in flight when Stop runs must not write a
// ping after Stop returned — without the stopped check it would take the
// mutex right after Stop released it and land the ping on the recycled
// buffer. The test calls pingIfSilent directly, as the ticker would.
func TestSSEStream_InFlightTickHonoursStopFlag(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rec := newSyncRecorder()
	const interval = time.Hour // no tick can fire during the test
	s := StartSSEWithInterval(ctx, rec, interval)

	s.Stop()
	// Make the stream count as silent, so the stopped flag is the only
	// reason pingIfSilent must refuse to write.
	s.last = time.Time{}
	if !s.pingIfSilent(interval) {
		t.Fatal("pingIfSilent after Stop did not report the stream as stopped")
	}
	if b := rec.body(); b != "" {
		t.Fatalf("bytes reached the writer after Stop: %q", b)
	}
}

// TestStartSSE_IsIdempotent: wrapping an already-wrapped writer returns the
// same stream, so a stream opened early by the chat path is not re-wrapped —
// and gains no second heartbeat — when the answer path calls StartSSE again.
func TestStartSSE_IsIdempotent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rec := newSyncRecorder()
	s1 := StartSSEWithInterval(ctx, rec, time.Hour)
	defer s1.Stop()
	s2 := StartSSE(ctx, s1)
	if s2 != s1 {
		t.Fatal("StartSSE on an SSEStream did not return the existing stream")
	}
	if s3 := StartSSEWithInterval(ctx, s1, time.Hour); s3 != s1 {
		t.Fatal("StartSSEWithInterval on an SSEStream did not return the existing stream")
	}
}

// TestSSEStream_WritesSetHeadersAndFlush verifies the basic SSE contract on
// the wrapper: standard headers set, Write + Flush delegate.
func TestSSEStream_WritesSetHeadersAndFlush(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rec := newSyncRecorder()
	s := StartSSE(ctx, rec)
	defer s.Stop()

	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q", cc)
	}
	if xab := rec.Header().Get("X-Accel-Buffering"); xab != "no" {
		t.Errorf("X-Accel-Buffering = %q", xab)
	}
	if _, err := s.Write([]byte("data: hi\n\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	s.Flush()
	if !rec.Flushed {
		t.Error("Flush did not reach the underlying writer")
	}
	if got := rec.body(); got != "data: hi\n\n" {
		t.Errorf("body = %q", got)
	}
}

// itoa is a tiny int→string helper to keep the frame-building above free of
// an fmt import (the frames are hand-assembled, exactly as the real ones are
// one Write per frame).
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [20]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(b[pos:])
}
