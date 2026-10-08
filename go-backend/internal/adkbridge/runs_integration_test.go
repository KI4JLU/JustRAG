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
