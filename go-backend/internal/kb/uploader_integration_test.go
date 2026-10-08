//go:build integration

package kb_test

import (
	"context"
	"testing"

	"github.com/justrag/go-backend/internal/kb"
)

// TestListFilesResolvesUploader pins the users LEFT JOIN behind
// FileRow.UploadedBy: name → "first last", no name → username, no uploader → nil.
func TestListFilesResolvesUploader(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	var kbID string
	if err := pool.QueryRow(ctx, `INSERT INTO knowledge_bases (name) VALUES ('kb-uploader') RETURNING id::text`).Scan(&kbID); err != nil {
		t.Fatalf("seed kb: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, kbID) }) //nolint:errcheck

	seedUser := func(username string, first, last *string) string {
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (username, password_hash, role, first_name, last_name)
			VALUES ($1, 'x-not-a-real-hash', 'user', $2, $3) RETURNING id::text`,
			username, first, last).Scan(&id); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, id) }) //nolint:errcheck
		return id
	}
	ada, lin := "Ada", "Lovelace"
	named := seedUser("ada-"+kbID[:8], &ada, &lin)
	bare := seedUser("bare-"+kbID[:8], nil, nil)

	for i, up := range []*string{&named, &bare, nil} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO files (kb_id, name, type, status, storage_path, uploaded_by, created_at)
			VALUES ($1::uuid, $2, 'text/plain', 'completed', 'p', $3::uuid, NOW() - make_interval(secs => $4))`,
			kbID, []string{"named", "bare", "none"}[i], up, i); err != nil {
			t.Fatalf("seed file %d: %v", i, err)
		}
	}

	rows, _, err := kb.NewStore(pool).ListFiles(ctx, kbID, 50, 0)
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	got := map[string]*kb.FileUploader{}
	for _, r := range rows {
		got[r.Name] = r.UploadedBy
	}
	if u := got["named"]; u == nil || u.ID != named || u.DisplayName != "Ada Lovelace" {
		t.Errorf("named = %+v", u)
	}
	if u := got["bare"]; u == nil || u.DisplayName != "bare-"+kbID[:8] {
		t.Errorf("bare = %+v, want username fallback", u)
	}
	if got["none"] != nil {
		t.Errorf("none = %+v, want nil", got["none"])
	}
}
