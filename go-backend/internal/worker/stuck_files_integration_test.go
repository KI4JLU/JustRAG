//go:build integration

// Executes stuckFilesSQL against a live main Postgres inside a rolled-back
// transaction. Skipped when DB_* env is unset.
//
// The sweep must judge staleness by the database clock alone: rows are
// stamped with the DB's NOW(), so the test stamps them the same way and
// passes only the timeout. Mutation: compare against a host-side cutoff
// shifted two hours ahead (the prod k8s skew) → the fresh row is swept.

package worker

import (
	"context"
	"testing"
)

func TestStuckFilesSQL_UsesDatabaseClock(t *testing.T) {
	pool := syncAgeTestPool(t)
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var kbID string
	if err := tx.QueryRow(ctx, `SELECT id FROM knowledge_bases LIMIT 1`).Scan(&kbID); err != nil {
		t.Skipf("needs at least one knowledge base: %v", err)
	}

	insert := func(name, progressAt, createdAt string) string {
		t.Helper()
		var id string
		err := tx.QueryRow(ctx, `
			INSERT INTO files (kb_id, name, type, status, progress_updated_at, created_at)
			VALUES ($1, $2, 'text/plain', 'processing', `+progressAt+`, `+createdAt+`)
			RETURNING id`, kbID, name).Scan(&id)
		if err != nil {
			t.Fatalf("insert %s: %v", name, err)
		}
		return id
	}
	fresh := insert("fresh", "NOW()", "NOW()")
	stale := insert("stale", "NOW() - interval '31 minutes'", "NOW() - interval '2 hours'")
	neverProgressed := insert("never-progressed", "NULL", "NOW() - interval '31 minutes'")

	if _, err := tx.Exec(ctx, stuckFilesSQL, (30 * 60.0)); err != nil {
		t.Fatalf("stuckFilesSQL: %v", err)
	}

	status := func(id string) (string, *string) {
		t.Helper()
		var s string
		var stage *string
		if err := tx.QueryRow(ctx, `SELECT status, error_stage FROM files WHERE id = $1`, id).Scan(&s, &stage); err != nil {
			t.Fatalf("read %s: %v", id, err)
		}
		return s, stage
	}
	if s, _ := status(fresh); s != "processing" {
		t.Errorf("fresh file: want processing, got %s", s)
	}
	for name, id := range map[string]string{"stale": stale, "never-progressed": neverProgressed} {
		s, stage := status(id)
		if s != "error" || stage == nil || *stage != "timeout" {
			t.Errorf("%s file: want error/timeout, got %s/%v", name, s, stage)
		}
	}
}
