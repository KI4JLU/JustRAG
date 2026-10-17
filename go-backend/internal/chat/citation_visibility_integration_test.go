//go:build integration

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
)

// TestCitations_StoredInFullAndShownRetroactively drives one streamed turn
// as a viewer while viewer_see_citations is at its migration default (off)
// through the real handler, PGStore and kbaccess.PGStore, then reads the
// chat back through GET /api/chats/{id}/messages before and after an admin
// turns the flag on.
//
// Oracles, each independent of the code under test:
//   - the stream: the raw SSE body searched for the file name / chunk text,
//     and the joined content frames against the hand-written stripped answer;
//   - the database: messages.content and messages.sources read with plain SQL
//     — the full answer and its source, although the writer could not see them;
//   - the reads: the same row returned stripped while the flag is off and
//     complete after `UPDATE knowledge_bases SET viewer_see_citations = true`.
func TestCitations_StoredInFullAndShownRetroactively(t *testing.T) {
	pool := conflictTestPool(t)
	ctx := context.Background()
	suffix := time.Now().Format("150405.000000")
	_, kbID := seedUserAndKB(t, pool, "cit-"+suffix)

	var viewerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'x-not-a-real-hash', 'user') RETURNING id::text`,
		"citations-viewer-"+suffix).Scan(&viewerID); err != nil {
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

	accessStore := kbaccess.NewStore(pool)
	values := map[string]*string{
		"citation_validation_enabled": strPtr("false"),
		"factcheck_in_chat":           strPtr("false"),
	}
	h := NewHandler(NewStore(pool), citingModelResolver(t), gradedSearcher{},
		WithSiteConfigReader(&fakeSiteConfigReader{values: values}), WithKBAccess(accessStore))

	// The turn, with the access result RequireKBRole would build from the DB.
	kb, err := accessStore.GetKBByID(ctx, kbID)
	if err != nil || kb == nil {
		t.Fatalf("GetKBByID: %v %v", kb, err)
	}
	memberRole, err := accessStore.GetKBRole(ctx, kbID, viewerID)
	if err != nil {
		t.Fatalf("GetKBRole: %v", err)
	}
	role := kbaccess.EffectiveRole(kb, auth.RoleUser, memberRole)
	if role != kbaccess.RoleView || kbaccess.CapabilitiesFor(kb, role).SeeCitations {
		t.Fatalf("premise: viewer resolves to %q with seeCitations on; want view without", role)
	}
	r := httptest.NewRequest(http.MethodPost, "/api/kb/"+kbID+"/chat?stream=true", strings.NewReader(`{"message":"Wie lange ist die Frist?"}`))
	r.Header.Set("Content-Type", "application/json")
	r = injectUser(r, viewerID)
	r = r.WithContext(kbaccess.WithAccess(r.Context(), &kbaccess.KBAccessResult{KB: kb, Role: role}))
	r.SetPathValue("id", kbID)
	w := httptest.NewRecorder()
	h.SendMessage(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("turn: status %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if strings.Contains(body, "f1.md") || strings.Contains(body, "some content") {
		t.Fatalf("stream carries source data: %s", body)
	}
	if got := streamedContent(t, body); got != citingAnswerStripped {
		t.Fatalf("streamed answer = %q, want %q", got, citingAnswerStripped)
	}

	// Stored in full.
	var chatID, content, sources string
	if err := pool.QueryRow(ctx, `
		SELECT m.chat_id::text, m.content, COALESCE(m.sources::text, '')
		FROM messages m JOIN chats c ON c.id = m.chat_id
		WHERE c.user_id = $1::uuid AND m.role = 'ai'`, viewerID).Scan(&chatID, &content, &sources); err != nil {
		t.Fatalf("read stored answer: %v", err)
	}
	if content != citingAnswerFull || !strings.Contains(sources, "f1.md") || !strings.Contains(sources, "some content") {
		t.Fatalf("stored content %q / sources %s: want the full answer and its source", content, sources)
	}

	read := func() string {
		r := httptest.NewRequest(http.MethodGet, "/api/chats/"+chatID+"/messages", nil)
		r = injectUser(r, viewerID)
		r.SetPathValue("id", chatID)
		w := httptest.NewRecorder()
		h.GetMessages(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("GetMessages: status %d", w.Code)
		}
		return w.Body.String()
	}
	if got := read(); strings.Contains(got, "f1.md") || strings.Contains(got, "[1]") || !strings.Contains(got, citingAnswerStripped) {
		t.Fatalf("read with the flag off: %s", got)
	}

	if _, err := pool.Exec(ctx, `UPDATE knowledge_bases SET viewer_see_citations = true WHERE id = $1::uuid`, kbID); err != nil {
		t.Fatalf("set flag: %v", err)
	}
	if got := read(); !strings.Contains(got, "f1.md") || !strings.Contains(got, citingAnswerFull) {
		t.Fatalf("read after the flag was turned on: citations not restored: %s", got)
	}
}
