package adkbridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RunStatus is the lifecycle state of an agent_runs row.
type RunStatus string

const (
	RunRunning     RunStatus = "running"
	RunInterrupted RunStatus = "interrupted"
	RunCompleted   RunStatus = "completed"
	RunFailed      RunStatus = "failed"
	RunCancelled   RunStatus = "cancelled"
	RunAbandoned   RunStatus = "abandoned"
)

// OpenInterrupt is one pending interrupt of a paused run.
type OpenInterrupt struct {
	ID         string `json:"id"`
	Reason     string `json:"reason"`
	ToolCallID string `json:"toolCallId,omitempty"`
}

// Run is one agent_runs row.
type Run struct {
	ID, ThreadID, AppName, UserID, KBID string
	Status                              RunStatus
	Interrupts                          []OpenInterrupt
	ExpiresAt                           *time.Time
}

var (
	ErrNoOpenInterrupt   = errors.New("adkbridge: no open interrupt on this thread")
	ErrInterruptExpired  = errors.New("adkbridge: interrupt expired")
	ErrInterruptMismatch = errors.New("adkbridge: resume must answer exactly the open interrupts")
)

// RunStore persists run bookkeeping for pause/resume.
type RunStore struct {
	pool *pgxpool.Pool
	ttl  time.Duration
}

// NewRunStore returns a store whose interrupts expire after ttl (plan: 24h).
func NewRunStore(pool *pgxpool.Pool, ttl time.Duration) *RunStore {
	return &RunStore{pool: pool, ttl: ttl}
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Start records a new running run.
func (s *RunStore) Start(ctx context.Context, r Run) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO agent_runs (id, thread_id, app_name, user_id, kb_id, status)
		VALUES ($1,$2,$3,$4,$5,'running')`, r.ID, r.ThreadID, r.AppName, r.UserID, nullable(r.KBID))
	if err != nil {
		return fmt.Errorf("agent_runs start: %w", err)
	}
	return nil
}

// Interrupt marks the run paused on in, expiring after the store's ttl.
func (s *RunStore) Interrupt(ctx context.Context, runID string, in []OpenInterrupt) error {
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE agent_runs SET status='interrupted', open_interrupts=$2,
		expires_at = now() + make_interval(secs => $3), updated_at=now() WHERE id=$1`,
		runID, body, s.ttl.Seconds())
	if err != nil {
		return fmt.Errorf("agent_runs interrupt: %w", err)
	}
	return nil
}

// Finish records a terminal status.
func (s *RunStore) Finish(ctx context.Context, runID string, status RunStatus, errMsg string) error {
	_, err := s.pool.Exec(ctx, `UPDATE agent_runs SET status=$2, error=$3, updated_at=now() WHERE id=$1`,
		runID, string(status), nullable(errMsg))
	if err != nil {
		return fmt.Errorf("agent_runs finish: %w", err)
	}
	return nil
}

// ClaimResume atomically takes the thread's paused run for userID if its
// open interrupt ids equal interruptIDs and it has not expired. The row
// moves to completed (the resumed run is a new run row), so a second claim
// finds nothing: exactly-once. An expired run is marked abandoned.
func (s *RunStore) ClaimResume(ctx context.Context, appName, userID, threadID string, interruptIDs []string) (Run, error) {
	var (
		out     Run
		expired bool
	)
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var (
			raw     []byte
			expires *time.Time
			kb      *string
		)
		// SKIP LOCKED: a concurrent claimer sees no row instead of waiting,
		// so exactly one of N simultaneous resumes wins.
		err := tx.QueryRow(ctx, `SELECT id, open_interrupts, expires_at, kb_id::text FROM agent_runs
			WHERE app_name=$1 AND thread_id=$2 AND user_id=$3 AND status='interrupted' FOR UPDATE SKIP LOCKED`,
			appName, threadID, userID).Scan(&out.ID, &raw, &expires, &kb)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoOpenInterrupt
		}
		if err != nil {
			return err
		}
		if expires != nil && time.Now().After(*expires) {
			expired = true
			return nil // abandoned below, outside this transaction
		}
		if err := json.Unmarshal(raw, &out.Interrupts); err != nil {
			return err
		}
		have := make([]string, 0, len(out.Interrupts))
		for _, i := range out.Interrupts {
			have = append(have, i.ID)
		}
		want := slices.Clone(interruptIDs)
		slices.Sort(have)
		slices.Sort(want)
		if !slices.Equal(have, want) {
			return ErrInterruptMismatch
		}
		if _, err := tx.Exec(ctx, `UPDATE agent_runs SET status='completed', updated_at=now() WHERE id=$1`, out.ID); err != nil {
			return err
		}
		out.ThreadID, out.AppName, out.UserID, out.Status, out.ExpiresAt = threadID, appName, userID, RunCompleted, expires
		if kb != nil {
			out.KBID = *kb
		}
		return nil
	})
	if err != nil {
		return Run{}, err
	}
	if expired {
		if _, err := s.pool.Exec(ctx, `UPDATE agent_runs SET status='abandoned', updated_at=now()
			WHERE id=$1 AND status='interrupted'`, out.ID); err != nil {
			return Run{}, err
		}
		return Run{}, ErrInterruptExpired
	}
	return out, nil
}

// HasOpen reports whether the thread has an unexpired paused run for userID.
func (s *RunStore) HasOpen(ctx context.Context, appName, userID, threadID string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agent_runs WHERE app_name=$1 AND user_id=$2
		AND thread_id=$3 AND status='interrupted' AND expires_at > now())`, appName, userID, threadID).Scan(&ok)
	return ok, err
}

// ExpireStale abandons every interrupted run past its expiry.
func (s *RunStore) ExpireStale(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE agent_runs SET status='abandoned', updated_at=now()
		WHERE status='interrupted' AND expires_at < now()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
