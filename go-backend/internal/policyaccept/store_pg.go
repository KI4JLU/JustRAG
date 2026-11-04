// Package policyaccept records which version of the usage policy (AI-use
// notice, terms of use, privacy policy) each user accepted.
//
// The version to accept is the global-only site_config key
// policy_acceptance_version; empty means no acceptance is asked for. The web
// app shows the notice until the signed-in user has accepted the current
// version. The backend stores acceptances and reports the state; it does not
// refuse other requests from users who have not accepted — API keys,
// /owui and MCP clients act for a key owner who never sees the notice.
package policyaccept

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the acceptance data layer. PGStore is its only implementation.
type Store interface {
	// AcceptedAt returns when userID accepted version, or nil if never.
	AcceptedAt(ctx context.Context, userID, version string) (*time.Time, error)
	// Accept records userID's acceptance of version and returns its time,
	// but only while version is the current VersionKey value; otherwise it
	// returns ErrVersionChanged and stores nothing. Idempotent: a repeat keeps
	// and returns the first acceptance time.
	Accept(ctx context.Context, userID, version string) (time.Time, error)
}

// ErrVersionChanged is returned by Store.Accept when the version is not the
// current one (or the notice is off).
var ErrVersionChanged = errors.New("policyaccept: version is not the current one")

// PGStore is the Postgres-backed Store.
type PGStore struct {
	pool *pgxpool.Pool
}

// NewStore creates a PGStore over the main pool.
func NewStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

var _ Store = (*PGStore)(nil)

// AcceptedAt implements Store.
func (s *PGStore) AcceptedAt(ctx context.Context, userID, version string) (*time.Time, error) {
	var at time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT accepted_at FROM user_policy_acceptances
		WHERE user_id = $1::uuid AND policy_version = $2`, userID, version).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("AcceptedAt: %w", err)
	}
	return &at, nil
}

// Accept implements Store. The current version is read in the same
// transaction as the insert, with a share lock on its site_configs row: an
// admin saving a new version (an upsert of that row) waits until the
// acceptance is committed, so no acceptance is recorded for a version that
// was replaced before it. The insert and the read-back are two statements:
// in one statement the read could not see a row a concurrent request
// committed after the statement's snapshot, and would return nothing.
func (s *PGStore) Accept(ctx context.Context, userID, version string) (time.Time, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return time.Time{}, fmt.Errorf("Accept: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	var raw *string
	err = tx.QueryRow(ctx, `SELECT value FROM site_configs WHERE key = $1 FOR SHARE`, VersionKey).Scan(&raw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, fmt.Errorf("Accept: read %s: %w", VersionKey, err)
	}
	if current := normalizeVersion(raw); current == "" || current != version {
		return time.Time{}, ErrVersionChanged
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO user_policy_acceptances (user_id, policy_version)
		VALUES ($1::uuid, $2)
		ON CONFLICT (user_id, policy_version) DO NOTHING`, userID, version); err != nil {
		return time.Time{}, fmt.Errorf("Accept: insert: %w", err)
	}
	var at time.Time
	if err := tx.QueryRow(ctx, `
		SELECT accepted_at FROM user_policy_acceptances
		WHERE user_id = $1::uuid AND policy_version = $2`, userID, version).Scan(&at); err != nil {
		return time.Time{}, fmt.Errorf("Accept: read back: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return time.Time{}, fmt.Errorf("Accept: commit: %w", err)
	}
	return at, nil
}
