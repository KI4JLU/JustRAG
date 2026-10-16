//go:build integration

package kb_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/kb"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// readFlags reads the five source-permission columns with plain SQL — the
// oracle for every store method below, independent of their column lists.
func readFlags(t *testing.T, pool *pgxpool.Pool, kbID string) kbaccess.SourcePermissions {
	t.Helper()
	var p kbaccess.SourcePermissions
	if err := pool.QueryRow(context.Background(), `
		SELECT viewer_see_sources, viewer_select_sources, viewer_download_sources,
		       viewer_see_citations, editor_manage_sources
		FROM knowledge_bases WHERE id = $1::uuid`, kbID).Scan(
		&p.ViewerSeeSources, &p.ViewerSelectSources, &p.ViewerDownloadSources,
		&p.ViewerSeeCitations, &p.EditorManageSources); err != nil {
		t.Fatalf("read flags: %v", err)
	}
	return p
}

// TestSourcePermissions_DefaultsAndPatchRoundTrip exercises migration 0089
// and every store path that carries the flags, against a live database:
//
//  1. a new KB gets the migration's defaults — every viewer flag false,
//     editor_manage_sources true (the spec's decided defaults);
//  2. UpdateKnowledgeBase writes exactly the flags it was given and leaves
//     the others alone;
//  3. GetKnowledgeBase and kbaccess.PGStore.GetKBByID (the lookup
//     RequireKBRole and the files handlers resolve capabilities from) read
//     back what is stored.
//
// Oracle: readFlags, plain SQL over the columns, and the defaults written
// out by hand from the spec.
func TestSourcePermissions_DefaultsAndPatchRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	s := kb.NewStore(pool)
	ownerID := insertUser(t, pool, "source-perm-owner-"+time.Now().Format("150405.000000"))

	created, err := s.CreateKnowledgeBase(ctx, "source-perm-kb", nil, ownerID, nil)
	if err != nil {
		t.Fatalf("CreateKnowledgeBase: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, created.ID) //nolint:errcheck
	})

	wantDefaults := kbaccess.SourcePermissions{EditorManageSources: true}
	if got := readFlags(t, pool, created.ID); got != wantDefaults {
		t.Fatalf("defaults in the database = %+v, want %+v", got, wantDefaults)
	}
	if created.ViewerSeeSources || created.ViewerSelectSources || created.ViewerDownloadSources ||
		created.ViewerSeeCitations || !created.EditorManageSources {
		t.Errorf("CreateKnowledgeBase RETURNING row does not carry the defaults: %+v", created)
	}

	on, off := true, false
	if _, err := s.UpdateKnowledgeBase(ctx, created.ID, kb.KBUpdate{
		ViewerSeeSources: &on, ViewerDownloadSources: &on, EditorManageSources: &off,
	}); err != nil {
		t.Fatalf("UpdateKnowledgeBase: %v", err)
	}
	want := kbaccess.SourcePermissions{ViewerSeeSources: true, ViewerDownloadSources: true}
	if got := readFlags(t, pool, created.ID); got != want {
		t.Fatalf("after PATCH = %+v, want %+v", got, want)
	}

	row, err := s.GetKnowledgeBase(ctx, created.ID, ownerID)
	if err != nil || row == nil {
		t.Fatalf("GetKnowledgeBase: %v %v", row, err)
	}
	gotRow := kbaccess.SourcePermissions{
		ViewerSeeSources: row.ViewerSeeSources, ViewerSelectSources: row.ViewerSelectSources,
		ViewerDownloadSources: row.ViewerDownloadSources, ViewerSeeCitations: row.ViewerSeeCitations,
		EditorManageSources: row.EditorManageSources,
	}
	if gotRow != want {
		t.Errorf("GetKnowledgeBase flags = %+v, want %+v", gotRow, want)
	}

	accessKB, err := kbaccess.NewStore(pool).GetKBByID(ctx, created.ID)
	if err != nil || accessKB == nil {
		t.Fatalf("kbaccess GetKBByID: %v %v", accessKB, err)
	}
	if accessKB.Sources != want {
		t.Errorf("kbaccess.PGStore.GetKBByID Sources = %+v, want %+v", accessKB.Sources, want)
	}
}
