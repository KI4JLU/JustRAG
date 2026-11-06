package processor

import (
	"context"
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// rowStore is a ProcessorStore whose files row can be deleted by the test.
// The oracle is this flag, set by the test, not anything the guard computes.
type rowStore struct {
	*mockStore
	gone   atomic.Bool
	failed atomic.Bool // FileExists returns an error
	checks atomic.Int32
}

func (s *rowStore) FileExists(context.Context, string) (bool, error) {
	s.checks.Add(1)
	if s.failed.Load() {
		return false, errors.New("db down")
	}
	return !s.gone.Load(), nil
}

// outputCleaner records which cleanup calls a run made, per file.
type outputCleaner struct {
	mu    sync.Mutex
	calls []string
}

func (c *outputCleaner) rec(s string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls = append(c.calls, s)
}
func (c *outputCleaner) DeleteChunksByFileIDAllDims(_ context.Context, id string) error {
	c.rec("chunks:" + id)
	return nil
}
func (c *outputCleaner) DeleteParentChunksByFileID(_ context.Context, id string) error {
	c.rec("parents:" + id)
	return nil
}
func (c *outputCleaner) DeleteHyPEByFileIDAllDims(_ context.Context, id string) error {
	c.rec("hype:" + id)
	return nil
}
func (c *outputCleaner) DeleteKGForFile(_ context.Context, kb, id string) error {
	c.rec("kg:" + kb + "/" + id)
	return nil
}
func (c *outputCleaner) got() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return slices.Clone(c.calls)
}

var wantCleanup = []string{"chunks:f1", "parents:f1", "hype:f1", "kg:kb1/f1"}

func fastPoll(t *testing.T) {
	t.Helper()
	old := fileRowPollInterval
	fileRowPollInterval = 5 * time.Millisecond
	t.Cleanup(func() { fileRowPollInterval = old })
}

func guardRig() (*Processor, *rowStore, *outputCleaner) {
	st := &rowStore{mockStore: &mockStore{}}
	c := &outputCleaner{}
	return &Processor{store: st, cleaner: c, kgCleaner: c}, st, c
}

var in1 = ProcessFileInput{FileID: "f1", KBID: "kb1"}

// A file deleted while its task was queued is never touched: the real
// ProcessFile returns ErrFileDeleted without writing a status.
func TestProcessFile_DeletedBeforeStart(t *testing.T) {
	st := &rowStore{mockStore: &mockStore{}}
	st.gone.Store(true)
	p := NewProcessor(nil, nil, nil, st)
	err := p.ProcessFile(context.Background(), in1)
	if !errors.Is(err, ErrFileDeleted) {
		t.Fatalf("err = %v, want ErrFileDeleted", err)
	}
	if len(st.statuses) != 0 {
		t.Errorf("statuses = %v, want none (row is gone)", st.statuses)
	}
}

// Deleted mid-run: the run's ctx is canceled, it stops, and what it wrote
// is removed.
func TestGuard_DeletedMidRunCancelsAndCleans(t *testing.T) {
	fastPoll(t)
	p, st, c := guardRig()
	stopped := make(chan struct{})
	err := p.guardDeletedFile(context.Background(), in1, func(ctx context.Context) error {
		st.gone.Store(true) // the user deletes the file during the run
		select {
		case <-ctx.Done():
			close(stopped)
			return ctx.Err()
		case <-time.After(5 * time.Second):
			return errors.New("run was never canceled")
		}
	})
	if !errors.Is(err, ErrFileDeleted) {
		t.Fatalf("err = %v, want ErrFileDeleted", err)
	}
	select {
	case <-stopped:
	default:
		t.Error("run did not observe cancellation")
	}
	if got := c.got(); !slices.Equal(got, wantCleanup) {
		t.Errorf("cleanup = %v, want %v", got, wantCleanup)
	}
}

// The row goes after the run's last ctx check and the run returns nil: the
// result is still ErrFileDeleted, and the late writes are still removed.
func TestGuard_DeletedButRunFinishedStillCleans(t *testing.T) {
	fastPoll(t)
	p, st, c := guardRig()
	err := p.guardDeletedFile(context.Background(), in1, func(ctx context.Context) error {
		st.gone.Store(true)
		<-ctx.Done() // wait until the watcher noticed, then ignore it
		return nil
	})
	if !errors.Is(err, ErrFileDeleted) {
		t.Fatalf("err = %v, want ErrFileDeleted", err)
	}
	if got := c.got(); !slices.Equal(got, wantCleanup) {
		t.Errorf("cleanup = %v, want %v", got, wantCleanup)
	}
}

// A healthy run is untouched: result passed through, no cleanup, and the
// watcher really polled (so the other tests are not passing by accident).
func TestGuard_RowPresentPassesThrough(t *testing.T) {
	fastPoll(t)
	p, st, c := guardRig()
	want := errors.New("parse failed")
	err := p.guardDeletedFile(context.Background(), in1, func(ctx context.Context) error {
		time.Sleep(30 * time.Millisecond)
		if ctx.Err() != nil {
			t.Error("ctx canceled although the row exists")
		}
		return want
	})
	if !errors.Is(err, want) || errors.Is(err, ErrFileDeleted) {
		t.Fatalf("err = %v, want the run's own error", err)
	}
	if n := st.checks.Load(); n < 2 {
		t.Errorf("checks = %d, want the start check plus polls", n)
	}
	if got := c.got(); len(got) != 0 {
		t.Errorf("cleanup = %v, want none", got)
	}
}

// A failing lookup must not abort a healthy ingest.
func TestGuard_LookupErrorCountsAsPresent(t *testing.T) {
	fastPoll(t)
	p, st, c := guardRig()
	st.failed.Store(true)
	err := p.guardDeletedFile(context.Background(), in1, func(ctx context.Context) error {
		time.Sleep(30 * time.Millisecond)
		return ctx.Err()
	})
	if err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if got := c.got(); len(got) != 0 {
		t.Errorf("cleanup = %v, want none", got)
	}
}
