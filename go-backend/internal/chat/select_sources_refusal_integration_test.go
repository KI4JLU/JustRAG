//go:build integration

// Integration test for the selectSources refusal: a 403 for a viewer's file
// selection must leave no chats row and no usage_events row in the real
// database. Pool/skip and seeding follow web_search_refusal_integration_test.go.

package chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/usage"
)

// TestSendMessage_SelectSources403WritesNoChatAndNoUsageRow sends a turn
// with selectedFileIds from a viewer (kb_members role 'view') through the
// real handler, the real PGStore and the real usage recorder. The caller's
// KBAccessResult is built the way RequireKBRole builds it — the KB row from
// kbaccess.PGStore.GetKBByID and the role from EffectiveRole over the stored
// kb_members row — so the flags come from the database.
//
// Oracle: row counts read back with plain SQL. The refusal comes first,
// while viewer_select_sources holds its migration default (false). Then the
// flag is set with plain SQL and the same request is the positive control:
// it is accepted, writes one chats row and one usage_events row, and fails
// at the stub searcher. Without the control, "0 rows after the 403" could
// just mean the harness never writes anything.
func TestSendMessage_SelectSources403WritesNoChatAndNoUsageRow(t *testing.T) {
	pool := conflictTestPool(t)
	ctx := context.Background()
	_, kbID := seedUserAndKB(t, pool, "sel-"+time.Now().Format("150405.000000"))

	var viewerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'x-not-a-real-hash', 'user') RETURNING id::text`,
		"select-sources-viewer-"+time.Now().Format("150405.000000")).Scan(&viewerID); err != nil {
		t.Fatalf("insert viewer: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM usage_events WHERE user_id = $1::uuid`, viewerID) //nolint:errcheck
		pool.Exec(ctx, `DELETE FROM chats WHERE user_id = $1::uuid`, viewerID)        //nolint:errcheck
		pool.Exec(ctx, `DELETE FROM kb_members WHERE user_id = $1::uuid`, viewerID)   //nolint:errcheck
		pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, viewerID)             //nolint:errcheck
	})
	if _, err := pool.Exec(ctx, `INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'view')`,
		kbID, viewerID); err != nil {
		t.Fatalf("insert kb_members: %v", err)
	}

	const chatsSQL = `SELECT count(*) FROM chats WHERE kb_id = $1::uuid`
	const usageSQL = `SELECT count(*) FROM usage_events WHERE kb_id = $1::uuid`

	h := &Handler{
		store:         NewStore(pool),
		searchService: erroringSearcher{},
		usageRecorder: usage.NewRecorder(pool),
	}
	accessStore := kbaccess.NewStore(pool)
	send := func() int {
		kb, err := accessStore.GetKBByID(ctx, kbID)
		if err != nil || kb == nil {
			t.Fatalf("GetKBByID: %v %v", kb, err)
		}
		memberRole, err := accessStore.GetKBRole(ctx, kbID, viewerID)
		if err != nil {
			t.Fatalf("GetKBRole: %v", err)
		}
		role := kbaccess.EffectiveRole(kb, auth.RoleUser, memberRole)
		if role != kbaccess.RoleView {
			t.Fatalf("premise: viewer resolves to %q, want view", role)
		}
		r := httptest.NewRequest(http.MethodPost, "/api/kb/"+kbID+"/chat?stream=true",
			strings.NewReader(`{"message":"hello","selectedFileIds":["00000000-0000-0000-0000-000000000001"]}`))
		r.Header.Set("Content-Type", "application/json")
		r = injectUser(r, viewerID)
		r = r.WithContext(kbaccess.WithAccess(r.Context(), &kbaccess.KBAccessResult{KB: kb, Role: role}))
		r.SetPathValue("id", kbID)
		w := httptest.NewRecorder()
		h.SendMessage(w, r)
		return w.Code
	}

	if code := send(); code != http.StatusForbidden {
		t.Fatalf("selection with viewer_select_sources at its default: status %d, want 403", code)
	}
	if n := countRows(t, pool, chatsSQL, kbID); n != 0 {
		t.Fatalf("chats rows after the 403 = %d, want 0", n)
	}

	// Positive control.
	if _, err := pool.Exec(ctx, `UPDATE knowledge_bases SET viewer_select_sources = true WHERE id = $1::uuid`, kbID); err != nil {
		t.Fatalf("set flag: %v", err)
	}
	if code := send(); code != http.StatusInternalServerError {
		t.Fatalf("control: status %d, want 500 from the stub searcher", code)
	}
	deadline := time.Now().Add(5 * time.Second)
	for countRows(t, pool, usageSQL, kbID) == 0 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if n := countRows(t, pool, chatsSQL, kbID); n != 1 {
		t.Fatalf("chats rows = %d, want exactly 1 (the control's)", n)
	}
	if n := countRows(t, pool, usageSQL, kbID); n != 1 {
		t.Fatalf("usage_events rows = %d, want exactly 1 (the control's)", n)
	}
}
