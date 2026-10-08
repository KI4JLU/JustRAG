//go:build integration

package adkbridge

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func seedUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	// users' NOT NULL columns without defaults are username + password_hash.
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, id, "adk-test-"+id); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, id) })
	return id
}

func pausedRun(t *testing.T, s *RunStore, user, thread string, ids ...string) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if err := s.Start(ctx, Run{ID: id, ThreadID: thread, AppName: "chat", UserID: user}); err != nil {
		t.Fatal(err)
	}
	var in []OpenInterrupt
	for _, i := range ids {
		in = append(in, OpenInterrupt{ID: i, Reason: "tool_approval"})
	}
	if err := s.Interrupt(ctx, id, in); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestClaimResumeHappyPathAndOwnership(t *testing.T) {
	pool := isolatedPool(t, "0083_agent_runs.sql")
	s := NewRunStore(pool, 24*time.Hour)
	u, other := seedUser(t, pool), seedUser(t, pool)
	runID := pausedRun(t, s, u, "th", "i1", "i2")

	if _, err := s.ClaimResume(context.Background(), "chat", other, "th", []string{"i1", "i2"}); !errors.Is(err, ErrNoOpenInterrupt) {
		t.Fatalf("other user: err = %v", err)
	}
	if _, err := s.ClaimResume(context.Background(), "chat", u, "th", []string{"i1"}); !errors.Is(err, ErrInterruptMismatch) {
		t.Fatalf("partial answer: err = %v", err)
	}
	got, err := s.ClaimResume(context.Background(), "chat", u, "th", []string{"i2", "i1"})
	if err != nil || got.ID != runID {
		t.Fatalf("claim: %v %+v", err, got)
	}
}

func TestClaimResumeIsExclusive(t *testing.T) {
	pool := isolatedPool(t, "0083_agent_runs.sql")
	s := NewRunStore(pool, 24*time.Hour)
	u := seedUser(t, pool)
	pausedRun(t, s, u, "th", "i1")

	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := 0
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.ClaimResume(context.Background(), "chat", u, "th", []string{"i1"}); err == nil {
				mu.Lock()
				wins++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("wins = %d, want exactly 1", wins)
	}
}

func TestExpiredInterruptCannotBeClaimed(t *testing.T) {
	pool := isolatedPool(t, "0083_agent_runs.sql")
	s := NewRunStore(pool, -time.Minute) // already expired
	u := seedUser(t, pool)
	runID := pausedRun(t, s, u, "th", "i1")
	if _, err := s.ClaimResume(context.Background(), "chat", u, "th", []string{"i1"}); !errors.Is(err, ErrInterruptExpired) {
		t.Fatalf("err = %v", err)
	}
	var status string
	_ = pool.QueryRow(context.Background(), `SELECT status FROM agent_runs WHERE id=$1`, runID).Scan(&status)
	if status != string(RunAbandoned) {
		t.Fatalf("status = %s", status)
	}
}

func TestExpireStale(t *testing.T) {
	pool := isolatedPool(t, "0083_agent_runs.sql")
	s := NewRunStore(pool, -time.Minute)
	u := seedUser(t, pool)
	pausedRun(t, s, u, "a", "i1")
	pausedRun(t, s, u, "b", "i2")
	n, err := s.ExpireStale(context.Background())
	if err != nil || n != 2 {
		t.Fatalf("n=%d err=%v", n, err)
	}
}

func TestHasOpen(t *testing.T) {
	pool := isolatedPool(t, "0083_agent_runs.sql")
	s := NewRunStore(pool, 24*time.Hour)
	u := seedUser(t, pool)
	if ok, _ := s.HasOpen(context.Background(), "chat", u, "th"); ok {
		t.Fatal("open before any run")
	}
	pausedRun(t, s, u, "th", "i1")
	if ok, err := s.HasOpen(context.Background(), "chat", u, "th"); !ok || err != nil {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
}

func startRun(t *testing.T, s *RunStore, user, thread string) string {
	t.Helper()
	id := uuid.NewString()
	if err := s.Start(context.Background(), Run{ID: id, ThreadID: thread, AppName: "chat", UserID: user}); err != nil {
		t.Fatal(err)
	}
	return id
}

func statusOf(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(context.Background(), `SELECT status FROM agent_runs WHERE id=$1`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestInterruptAbandonsExpiredPredecessor(t *testing.T) {
	pool := isolatedPool(t, "0083_agent_runs.sql")
	u := seedUser(t, pool)
	old := pausedRun(t, NewRunStore(pool, -time.Minute), u, "th", "i1")
	s := NewRunStore(pool, 24*time.Hour)
	next := startRun(t, s, u, "th")
	if err := s.Interrupt(context.Background(), next, []OpenInterrupt{{ID: "i2", Reason: "r"}}); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, pool, old); got != string(RunAbandoned) {
		t.Fatalf("old status = %s", got)
	}
}

func TestInterruptRejectsSecondOpenSet(t *testing.T) {
	pool := isolatedPool(t, "0083_agent_runs.sql")
	s := NewRunStore(pool, 24*time.Hour)
	u := seedUser(t, pool)
	pausedRun(t, s, u, "th", "i1")
	next := startRun(t, s, u, "th")
	err := s.Interrupt(context.Background(), next, []OpenInterrupt{{ID: "i2", Reason: "r"}})
	if !errors.Is(err, ErrThreadHasOpenInterrupt) {
		t.Fatalf("err = %v", err)
	}
}

func TestSameThreadIDDifferentUsers(t *testing.T) {
	pool := isolatedPool(t, "0083_agent_runs.sql")
	s := NewRunStore(pool, 24*time.Hour)
	a, b := seedUser(t, pool), seedUser(t, pool)
	pausedRun(t, s, a, "same", "i1")
	pausedRun(t, s, b, "same", "i2") // fatals on error
}

func TestFinishAndStateGuards(t *testing.T) {
	pool := isolatedPool(t, "0083_agent_runs.sql")
	s := NewRunStore(pool, 24*time.Hour)
	ctx := context.Background()
	u := seedUser(t, pool)

	r := startRun(t, s, u, "t1")
	if err := s.Finish(ctx, r, RunFailed, "boom"); err != nil {
		t.Fatal(err)
	}
	if got := statusOf(t, pool, r); got != string(RunFailed) {
		t.Fatalf("status = %s", got)
	}
	if err := s.Finish(ctx, r, RunCompleted, ""); !errors.Is(err, ErrRunNotRunning) {
		t.Fatalf("finish on finished: %v", err)
	}

	ab := pausedRun(t, NewRunStore(pool, -time.Minute), u, "t2", "i1")
	if _, err := s.ExpireStale(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Interrupt(ctx, ab, []OpenInterrupt{{ID: "x", Reason: "r"}}); !errors.Is(err, ErrRunNotRunning) {
		t.Fatalf("interrupt abandoned: %v", err)
	}
	if err := s.Interrupt(ctx, uuid.NewString(), []OpenInterrupt{{ID: "x", Reason: "r"}}); !errors.Is(err, ErrRunNotRunning) {
		t.Fatalf("interrupt unknown: %v", err)
	}

	run := startRun(t, s, u, "t3")
	if err := s.Finish(ctx, run, RunInterrupted, ""); err == nil || errors.Is(err, ErrRunNotRunning) {
		t.Fatalf("finish(interrupted) err = %v", err)
	}
	if err := s.Interrupt(ctx, run, nil); err == nil {
		t.Fatal("empty interrupt set accepted")
	}
	if got := statusOf(t, pool, run); got != string(RunRunning) {
		t.Fatalf("status = %s", got)
	}
}
