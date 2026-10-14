//go:build integration

package owuicompat_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/owuicompat"
)

func seedUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	name := "owui-" + uuid.NewString()[:8]
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'api-user') RETURNING id::text`, name).Scan(&id); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1::uuid`, id) }) //nolint:errcheck
	return id
}

func seedKB(t *testing.T, pool *pgxpool.Pool, owner string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO knowledge_bases (name, user_id) VALUES ('owui-kb', $1::uuid) RETURNING id::text`, owner).Scan(&id); err != nil {
		t.Fatalf("insert kb: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM knowledge_bases WHERE id=$1::uuid`, id) }) //nolint:errcheck
	return id
}

func seedUserFile(t *testing.T, pool *pgxpool.Pool, owner string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO user_files (id, owner_user_id, name, mime, size, sha256, storage_path)
		 VALUES ($1::uuid, $2::uuid, 'a.pdf', 'application/pdf', 3, $3, $4)`,
		id, owner, uuid.NewString()+uuid.NewString()[:28], "users/"+owner+"/"+id); err != nil {
		t.Fatalf("insert user_file: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM user_files WHERE id=$1::uuid`, id) }) //nolint:errcheck
	return id
}

func seedKBFile(t *testing.T, pool *pgxpool.Pool, kbID, ufID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO files (kb_id, name, type, size, origin, status, user_file_id)
		 VALUES ($1::uuid, 'a.pdf', 'application/pdf', 3, 'upload', 'completed', $2::uuid) RETURNING id::text`,
		kbID, ufID).Scan(&id); err != nil {
		t.Fatalf("insert files: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM files WHERE id=$1::uuid`, id) }) //nolint:errcheck
	return id
}

func TestHandleLifecycleSharedBytes(t *testing.T) {
	pool := openMainPool(t)
	ctx := context.Background()
	st := owuicompat.NewPGStore(pool)
	owner := seedUser(t, pool)
	uf := seedUserFile(t, pool, owner)

	a, err := st.CreateHandle(ctx, owuicompat.NewHandle{ID: uuid.NewString(), OwnerUserID: owner, UserFileID: uf, Filename: "a.pdf",
		Metadata: map[string]any{"ilias_title": "A"}})
	if err != nil {
		t.Fatal(err)
	}
	b, err := st.CreateHandle(ctx, owuicompat.NewHandle{ID: uuid.NewString(), OwnerUserID: owner, UserFileID: uf, Filename: "b.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := st.GetHandle(ctx, owner, a.ID)
	if err != nil || got == nil || got.Metadata["ilias_title"] != "A" {
		t.Fatalf("GetHandle = %+v, %v", got, err)
	}
	// Another owner sees nothing.
	if other, _ := st.GetHandle(ctx, seedUser(t, pool), a.ID); other != nil {
		t.Fatal("handle visible to another owner")
	}
	deleted, last, _, err := st.DeleteHandle(ctx, owner, a.ID)
	if err != nil || !deleted || last {
		t.Fatalf("delete a: deleted=%v last=%v err=%v (want true,false)", deleted, last, err)
	}
	deleted, last, _, err = st.DeleteHandle(ctx, owner, b.ID)
	if err != nil || !deleted || !last {
		t.Fatalf("delete b: deleted=%v last=%v err=%v (want true,true)", deleted, last, err)
	}
	if deleted, _, _, _ := st.DeleteHandle(ctx, owner, b.ID); deleted {
		t.Fatal("second delete reported deleted")
	}
}

func TestKnowledgeLinksAndOrphans(t *testing.T) {
	pool := openMainPool(t)
	ctx := context.Background()
	st := owuicompat.NewPGStore(pool)
	owner := seedUser(t, pool)
	kb := seedKB(t, pool, owner)
	uf := seedUserFile(t, pool, owner)
	fileID := seedKBFile(t, pool, kb, uf)

	if err := st.RegisterKnowledge(ctx, kb, owner); err != nil {
		t.Fatal(err)
	}
	if ok, _ := st.OwnsKnowledge(ctx, owner, kb); !ok {
		t.Fatal("OwnsKnowledge = false")
	}
	if ok, _ := st.OwnsKnowledge(ctx, seedUser(t, pool), kb); ok {
		t.Fatal("OwnsKnowledge true for another user")
	}
	if got, _ := st.KBFileForUserFile(ctx, kb, uf); got != fileID {
		t.Fatalf("KBFileForUserFile = %q, want %q", got, fileID)
	}

	a, _ := st.CreateHandle(ctx, owuicompat.NewHandle{ID: uuid.NewString(), OwnerUserID: owner, UserFileID: uf, Filename: "a.pdf"})
	b, _ := st.CreateHandle(ctx, owuicompat.NewHandle{ID: uuid.NewString(), OwnerUserID: owner, UserFileID: uf, Filename: "b.pdf"})
	for _, h := range []string{a.ID, b.ID} {
		if err := st.LinkFile(ctx, kb, h, fileID); err != nil {
			t.Fatal(err)
		}
	}
	// Linking twice is idempotent.
	if err := st.LinkFile(ctx, kb, a.ID, fileID); err != nil {
		t.Fatalf("relink: %v", err)
	}
	m, err := st.HandlesForFiles(ctx, kb, []string{fileID})
	if err != nil || m[fileID].ID == "" {
		t.Fatalf("HandlesForFiles = %v, %v", m, err)
	}
	orphan, err := st.UnlinkFile(ctx, kb, a.ID)
	if err != nil || orphan != "" {
		t.Fatalf("unlink a: orphan=%q err=%v (b still linked, want \"\")", orphan, err)
	}
	orphan, err = st.UnlinkFile(ctx, kb, b.ID)
	if err != nil || orphan != fileID {
		t.Fatalf("unlink b: orphan=%q err=%v (want %q)", orphan, err, fileID)
	}
}

func TestDeleteHandleReportsOrphanKBFiles(t *testing.T) {
	pool := openMainPool(t)
	ctx := context.Background()
	st := owuicompat.NewPGStore(pool)
	owner := seedUser(t, pool)
	kb := seedKB(t, pool, owner)
	uf := seedUserFile(t, pool, owner)
	fileID := seedKBFile(t, pool, kb, uf)
	_ = st.RegisterKnowledge(ctx, kb, owner)
	a, _ := st.CreateHandle(ctx, owuicompat.NewHandle{ID: uuid.NewString(), OwnerUserID: owner, UserFileID: uf, Filename: "a.pdf"})
	b, _ := st.CreateHandle(ctx, owuicompat.NewHandle{ID: uuid.NewString(), OwnerUserID: owner, UserFileID: uf, Filename: "b.pdf"})
	_ = st.LinkFile(ctx, kb, a.ID, fileID)

	_, last, orphans, err := st.DeleteHandle(ctx, owner, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if last {
		t.Fatal("last=true although handle b still references the user file")
	}
	if len(orphans) != 1 || orphans[0] != fileID {
		t.Fatalf("orphans = %v, want [%s]", orphans, fileID)
	}
	_ = b
}

func TestCleanupPlansAreReadOnlyAndMatchDeletes(t *testing.T) {
	pool := openMainPool(t)
	ctx := context.Background()
	st := owuicompat.NewPGStore(pool)
	owner := seedUser(t, pool)
	kb := seedKB(t, pool, owner)
	uf := seedUserFile(t, pool, owner)
	fileID := seedKBFile(t, pool, kb, uf)
	_ = st.RegisterKnowledge(ctx, kb, owner)
	a, _ := st.CreateHandle(ctx, owuicompat.NewHandle{ID: uuid.NewString(), OwnerUserID: owner, UserFileID: uf, Filename: "a.pdf"})
	b, _ := st.CreateHandle(ctx, owuicompat.NewHandle{ID: uuid.NewString(), OwnerUserID: owner, UserFileID: uf, Filename: "b.pdf"})
	_ = st.LinkFile(ctx, kb, a.ID, fileID)

	// Unknown handle.
	if found, _, _, err := st.HandleCleanupPlan(ctx, owner, uuid.NewString()); err != nil || found {
		t.Fatalf("unknown: found=%v err=%v", found, err)
	}
	// Handle a: b shares the user file (last=false), the KB file is orphaned.
	found, last, orphans, err := st.HandleCleanupPlan(ctx, owner, a.ID)
	if err != nil || !found || last || len(orphans) != 1 || orphans[0] != fileID {
		t.Fatalf("plan a: found=%v last=%v orphans=%v err=%v", found, last, orphans, err)
	}
	if got, _ := st.GetHandle(ctx, owner, a.ID); got == nil {
		t.Fatal("HandleCleanupPlan deleted the handle")
	}
	if o, err := st.UnlinkPlan(ctx, kb, a.ID); err != nil || o != fileID {
		t.Fatalf("UnlinkPlan = %q, %v, want %q", o, err, fileID)
	}
	if m, _ := st.HandlesForFiles(ctx, kb, []string{fileID}); m[fileID].ID == "" {
		t.Fatal("UnlinkPlan removed the link")
	}
	// The destructive calls then return the same values.
	if o, err := st.UnlinkFile(ctx, kb, a.ID); err != nil || o != fileID {
		t.Fatalf("UnlinkFile = %q, %v", o, err)
	}
	_ = st.LinkFile(ctx, kb, a.ID, fileID)
	_, dLast, dOrphans, err := st.DeleteHandle(ctx, owner, a.ID)
	if err != nil || dLast != last || len(dOrphans) != 1 || dOrphans[0] != fileID {
		t.Fatalf("DeleteHandle last=%v orphans=%v err=%v", dLast, dOrphans, err)
	}
	// Handle b is now the last one for the user file.
	found, last, orphans, err = st.HandleCleanupPlan(ctx, owner, b.ID)
	if err != nil || !found || !last || len(orphans) != 0 {
		t.Fatalf("plan b: found=%v last=%v orphans=%v err=%v", found, last, orphans, err)
	}
}
