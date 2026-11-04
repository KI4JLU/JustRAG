//go:build integration

// Integration tests for migration 0098 and the policyaccept store.
//
// Oracle: the table's own primary key and foreign key, checked with raw SQL —
// one row per (user, version), the first acceptance time kept, rows gone with
// the user. Requires a live main Postgres; skipped when DB_* env is unset.

package policyaccept_test

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/policyaccept"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	host, port, name := os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")
	if host == "" || port == "" || name == "" {
		t.Skip("policyaccept tests require DB_* env (main Postgres)")
	}
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s",
		url.QueryEscape(os.Getenv("DB_USER")), url.QueryEscape(os.Getenv("DB_PASSWORD")), host, port, name)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestStoreAcceptance(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ('policyaccept-it', 'x-not-a-real-hash', 'user') RETURNING id::text`).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, userID) }) //nolint:errcheck

	store := policyaccept.NewStore(pool)

	at, err := store.AcceptedAt(ctx, userID, "v1")
	if err != nil || at != nil {
		t.Fatalf("AcceptedAt before accept = %v, %v; want nil, nil", at, err)
	}

	first, err := store.Accept(ctx, userID, "v1")
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	again, err := store.Accept(ctx, userID, "v1")
	if err != nil {
		t.Fatalf("Accept again: %v", err)
	}
	if !again.Equal(first) {
		t.Fatalf("repeat accept returned %v, want the first time %v", again, first)
	}
	if _, err := store.Accept(ctx, userID, "v2"); err != nil {
		t.Fatalf("Accept v2: %v", err)
	}

	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM user_policy_acceptances WHERE user_id = $1::uuid`, userID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 2 {
		t.Fatalf("rows = %d, want 2 (one per version)", n)
	}

	at, err = store.AcceptedAt(ctx, userID, "v1")
	if err != nil || at == nil || !at.Equal(first) {
		t.Fatalf("AcceptedAt v1 = %v, %v; want %v", at, err, first)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, userID); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM user_policy_acceptances WHERE user_id = $1::uuid`, userID).Scan(&n); err != nil {
		t.Fatalf("count after delete: %v", err)
	}
	if n != 0 {
		t.Fatalf("rows after user delete = %d, want 0", n)
	}
}
