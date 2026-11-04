//go:build integration

// FileExists (KI-828): the ingest worker's only signal that a file was
// deleted mid-run. A query that always answered true would leave the guard
// silently dead, so the real SQL is pinned here against the live main DB.

package files_test

import (
	"context"
	"testing"

	"github.com/justrag/go-backend/internal/files"
)

func TestFileExists_TracksRowDeletion(t *testing.T) {
	pool := openMainPool(t)
	ctx := context.Background()
	store := files.NewStore(pool)
	_, fileID := seedErrorFile(t, pool, "processing")

	if ok, err := store.FileExists(ctx, fileID); err != nil || !ok {
		t.Fatalf("seeded row: FileExists = %v, %v; want true", ok, err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM files WHERE id = $1::uuid`, fileID); err != nil {
		t.Fatal(err)
	}
	if ok, err := store.FileExists(ctx, fileID); err != nil || ok {
		t.Fatalf("deleted row: FileExists = %v, %v; want false", ok, err)
	}
}
