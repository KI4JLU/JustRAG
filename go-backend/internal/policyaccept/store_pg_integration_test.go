//go:build integration

// Integration tests for migration 0098 and the policyaccept store.
//
// Oracle: the table's own primary key and foreign key, checked with raw SQL —
// one row per (user, version), the first acceptance time kept, rows gone with
// the user; and Store.Accept's contract — only the version currently in
// site_configs is stored, and a version saved while an acceptance is in
// flight is seen by it. Requires a live main Postgres; skipped when DB_* env
// is unset. The tests set policy_acceptance_version and restore it after.

package policyaccept_test

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

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

// setVersion writes policy_acceptance_version (nil deletes it) and restores
// the value it had before the test.
func setVersion(t *testing.T, pool *pgxpool.Pool, v *string) {
	t.Helper()
	ctx := context.Background()
	var before *string
	var had bool
	err := pool.QueryRow(ctx, `SELECT value FROM site_configs WHERE key = $1`, policyaccept.VersionKey).Scan(&before)
	had = err == nil
	t.Cleanup(func() {
		if had {
			pool.Exec(ctx, `UPDATE site_configs SET value = $2 WHERE key = $1`, policyaccept.VersionKey, before) //nolint:errcheck
		} else {
			pool.Exec(ctx, `DELETE FROM site_configs WHERE key = $1`, policyaccept.VersionKey) //nolint:errcheck
		}
	})
	if v == nil {
		_, err = pool.Exec(ctx, `DELETE FROM site_configs WHERE key = $1`, policyaccept.VersionKey)
	} else {
		_, err = pool.Exec(ctx, `
			INSERT INTO site_configs (key, value, updated_at) VALUES ($1, $2, now())
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, policyaccept.VersionKey, *v)
	}
	if err != nil {
		t.Fatalf("set %s: %v", policyaccept.VersionKey, err)
	}
}

func testUser(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'x-not-a-real-hash', 'user') RETURNING id::text`, name).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, userID) }) //nolint:errcheck
	return userID
}

func countRows(t *testing.T, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM user_policy_acceptances WHERE user_id = $1::uuid`, userID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestStoreAcceptance(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := testUser(t, pool, "policyaccept-it")
	setVersion(t, pool, strp("v1"))

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
	setVersion(t, pool, strp(" v2 "))
	if _, err := store.Accept(ctx, userID, "v2"); err != nil {
		t.Fatalf("Accept v2: %v", err)
	}

	n := countRows(t, pool, userID)
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
	if n = countRows(t, pool, userID); n != 0 {
		t.Fatalf("rows after user delete = %d, want 0", n)
	}
}

func TestStoreAcceptOnlyCurrentVersion(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := testUser(t, pool, "policyaccept-it-current")
	store := policyaccept.NewStore(pool)

	for _, tc := range []struct {
		name   string
		stored *string
	}{
		{"other version", strp("v2")},
		{"notice off", strp("")},
		{"key absent", nil},
		{"invalid stored value", strp("v1 <b>")},
	} {
		setVersion(t, pool, tc.stored)
		if _, err := store.Accept(ctx, userID, "v1"); !errors.Is(err, policyaccept.ErrVersionChanged) {
			t.Fatalf("%s: Accept v1 err = %v, want ErrVersionChanged", tc.name, err)
		}
	}
	if n := countRows(t, pool, userID); n != 0 {
		t.Fatalf("rows = %d, want 0", n)
	}
}

// An admin's save of a new version that commits while an acceptance of the
// old one is in flight must not leave the old one recorded as if current:
// the acceptance waits for the save and is refused.
func TestStoreAcceptSeesConcurrentVersionChange(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := testUser(t, pool, "policyaccept-it-race")
	setVersion(t, pool, strp("v1"))
	store := policyaccept.NewStore(pool)

	admin, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer admin.Rollback(ctx) //nolint:errcheck
	if _, err := admin.Exec(ctx, `UPDATE site_configs SET value = 'v2' WHERE key = $1`, policyaccept.VersionKey); err != nil {
		t.Fatalf("admin update: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := store.Accept(ctx, userID, "v1")
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("Accept returned (%v) while the version save was uncommitted; want it to wait", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err := admin.Commit(ctx); err != nil {
		t.Fatalf("admin commit: %v", err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, policyaccept.ErrVersionChanged) {
			t.Fatalf("Accept v1 err = %v, want ErrVersionChanged", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Accept still blocked after the save committed")
	}
	if n := countRows(t, pool, userID); n != 0 {
		t.Fatalf("rows = %d, want 0", n)
	}
}
