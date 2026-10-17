//go:build integration

package files_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/files"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// TestDownloadGateReadsFlagsFromTheDatabase runs GET /api/files/{id}/download
// through the real files.PGStore — whose GetKBByID now delegates to
// kbaccess.PGStore — so the flags the handler gates on are the ones stored in
// knowledge_bases.viewer_download_sources / editor_download_sources, not
// fixture values.
//
// Oracle: the flags are flipped with plain SQL, independent of any store
// method, and the outcome is the spec's: at the migration defaults a viewer
// (kb_members role 'view') is refused and an editor (role 'edit') gets the
// file; with viewer_download_sources on and editor_download_sources off it is
// the other way round — but only once viewer_see_sources is on too, since
// download requires seeing the sources (the pyramid). Storage is a stub, so
// "gets the file" is the stub's bytes in the body.
func TestDownloadGateReadsFlagsFromTheDatabase(t *testing.T) {
	pool := openMainPool(t)
	ctx := context.Background()
	kbID, fileID := seedErrorFile(t, pool, "completed")

	member := func(label, role string) string {
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (username, password_hash, role)
			VALUES ($1, 'x-not-a-real-hash', 'user') RETURNING id::text`,
			"source-perm-"+label+"-"+time.Now().Format("150405.000000")).Scan(&id); err != nil {
			t.Fatalf("insert user: %v", err)
		}
		t.Cleanup(func() {
			pool.Exec(ctx, `DELETE FROM kb_members WHERE user_id = $1::uuid`, id) //nolint:errcheck
			pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, id)           //nolint:errcheck
		})
		if _, err := pool.Exec(ctx, `INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)`,
			kbID, id, role); err != nil {
			t.Fatalf("insert kb_members: %v", err)
		}
		return id
	}
	viewerID := member("viewer", "view")
	editorID := member("editor", "edit")

	download := func(userID string) int {
		stor := &mockStorage{stream: io.NopCloser(strings.NewReader("PDF content"))}
		h := files.NewHandler(files.NewStore(pool), stor, noopChunks())
		req := newRequest(http.MethodGet, "/api/files/"+fileID+"/download")
		req.SetPathValue("id", fileID)
		req = withUser(req, &auth.Claims{ID: userID, Role: auth.RoleUser})
		rr := httptest.NewRecorder()
		h.Download(rr, req)
		if rr.Code == http.StatusOK && rr.Body.String() != "PDF content" {
			t.Fatalf("200 without the file body: %q", rr.Body.String())
		}
		return rr.Code
	}

	if code := download(viewerID); code != http.StatusForbidden {
		t.Fatalf("viewer at the migration defaults: status %d, want 403", code)
	}
	if code := download(editorID); code != http.StatusOK {
		t.Fatalf("editor at the migration defaults: status %d, want 200", code)
	}
	if _, err := pool.Exec(ctx, `UPDATE knowledge_bases
		SET viewer_download_sources = true, editor_download_sources = false WHERE id = $1::uuid`, kbID); err != nil {
		t.Fatalf("set flags: %v", err)
	}
	if code := download(viewerID); code != http.StatusForbidden {
		t.Fatalf("viewer with viewer_download_sources on but viewer_see_sources off: status %d, want 403", code)
	}
	if _, err := pool.Exec(ctx, `UPDATE knowledge_bases SET viewer_see_sources = true WHERE id = $1::uuid`, kbID); err != nil {
		t.Fatalf("set see flag: %v", err)
	}
	if code := download(viewerID); code != http.StatusOK {
		t.Fatalf("viewer with viewer_see_sources and viewer_download_sources on: status %d, want 200", code)
	}
	if code := download(editorID); code != http.StatusForbidden {
		t.Fatalf("editor with editor_download_sources off: status %d, want 403", code)
	}
}

// TestAddGateReadsFlagsFromTheDatabase runs the add-sources gate
// (RequireKBCapability(edit, addSources), the composition kbAddSourcesChain
// mounts in front of the add routes) against the real kbaccess.PGStore, so
// the decision comes from the stored editor_add_sources and *_see_sources
// columns, not fixture values.
//
// Oracle: the flags are set with plain SQL; the expected outcomes are the
// spec's — at the migration defaults the editor may add and the viewer may
// not; a viewer never adds, even with every viewer and editor flag on;
// editor_add_sources off locks the editor out, and so does
// editor_see_sources off (the pyramid: add requires see). A counting
// handler proves a refusal never reaches the add handler.
func TestAddGateReadsFlagsFromTheDatabase(t *testing.T) {
	pool := openMainPool(t)
	ctx := context.Background()
	kbID, _ := seedErrorFile(t, pool, "completed")

	member := func(label, role string) string {
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (username, password_hash, role)
			VALUES ($1, 'x-not-a-real-hash', 'user') RETURNING id::text`,
			"source-add-"+label+"-"+time.Now().Format("150405.000000")).Scan(&id); err != nil {
			t.Fatalf("insert user: %v", err)
		}
		t.Cleanup(func() {
			pool.Exec(ctx, `DELETE FROM kb_members WHERE user_id = $1::uuid`, id) //nolint:errcheck
			pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, id)           //nolint:errcheck
		})
		if _, err := pool.Exec(ctx, `INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)`,
			kbID, id, role); err != nil {
			t.Fatalf("insert kb_members: %v", err)
		}
		return id
	}
	viewerID := member("viewer", "view")
	editorID := member("editor", "edit")

	reached := 0
	gate := kbaccess.NewMiddleware(kbaccess.NewStore(pool)).RequireKBCapability(kbaccess.RoleEdit, kbaccess.CapAddSources)(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			reached++
			w.WriteHeader(http.StatusCreated)
		}))
	add := func(userID string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/kb/"+kbID+"/text", strings.NewReader(`{}`))
		req.SetPathValue("id", kbID)
		req = withUser(req, &auth.Claims{ID: userID, Role: auth.RoleUser})
		rr := httptest.NewRecorder()
		gate.ServeHTTP(rr, req)
		return rr.Code
	}
	set := func(sql string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `UPDATE knowledge_bases SET `+sql+` WHERE id = $1::uuid`, kbID); err != nil {
			t.Fatalf("set flags: %v", err)
		}
	}

	steps := []struct {
		name   string
		sql    string
		userID string
		want   int
	}{
		{"editor_at_defaults", "", editorID, http.StatusCreated},
		{"viewer_at_defaults", "", viewerID, http.StatusForbidden},
		{"viewer_every_flag_on", "viewer_see_sources = true, viewer_download_sources = true, viewer_see_citations = true", viewerID, http.StatusForbidden},
		{"editor_add_off", "editor_add_sources = false", editorID, http.StatusForbidden},
		{"editor_add_on_see_off", "editor_add_sources = true, editor_see_sources = false", editorID, http.StatusForbidden},
	}
	for _, st := range steps {
		if st.sql != "" {
			set(st.sql)
		}
		before := reached
		code := add(st.userID)
		if code != st.want {
			t.Fatalf("%s: status %d, want %d", st.name, code, st.want)
		}
		if (reached > before) != (st.want == http.StatusCreated) {
			t.Fatalf("%s: handler reached = %v with status %d", st.name, reached > before, code)
		}
	}
}
