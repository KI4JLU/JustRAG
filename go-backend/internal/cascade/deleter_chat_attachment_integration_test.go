//go:build integration

package cascade_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/cascade"
	"github.com/justrag/go-backend/internal/storage"
)

// seedChatAttachment inserts a chat-scoped user file (no KB copy) with a blob
// and returns its id and blob path.
func seedChatAttachment(t *testing.T, pool *pgxpool.Pool, stor storage.Storage, userID, scope string) (ufID, blob string) {
	t.Helper()
	ctx := context.Background()
	blob = fmt.Sprintf("users/%s/att-%d", userID, nextSerial())
	sha := strings.Repeat("c", 60) + fmt.Sprintf("%04d", nextSerial())
	if err := pool.QueryRow(ctx, `
		INSERT INTO user_files (owner_user_id, name, mime, size, sha256, storage_path, scope)
		VALUES ($1::uuid, 'att.txt', 'text/plain', 8, $2, $3, $4)
		RETURNING id::text`, userID, sha, blob, scope).Scan(&ufID); err != nil {
		t.Fatalf("insert user_files: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM files WHERE user_file_id = $1::uuid`, ufID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_files WHERE id = $1::uuid`, ufID)
	})
	writeBlob(t, stor, blob)
	return ufID, blob
}

// seedUserMessage returns a user message in a fresh library-less chat.
func seedUserMessage(t *testing.T, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	ctx := context.Background()
	var chatID, msgID string
	if err := pool.QueryRow(ctx, `INSERT INTO chats (user_id) VALUES ($1::uuid) RETURNING id::text`, userID).Scan(&chatID); err != nil {
		t.Fatalf("insert chat: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM chats WHERE id = $1::uuid`, chatID) })
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, role, content) VALUES ($1::uuid, 'user', 'q') RETURNING id::text`, chatID).Scan(&msgID); err != nil {
		t.Fatalf("insert message: %v", err)
	}
	return msgID
}

func TestDeleteChatAttachment_OnlyUnreferencedStaleChatFiles(t *testing.T) {
	mp, vp := openTestPools(t)
	userID, kbID, _ := seedFixture(t, mp, false)
	otherID, _, _ := seedFixture(t, mp, false)
	stor, err := storage.New(storage.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	d := cascade.New(mp, vp, stor)
	ctx := context.Background()
	stale := time.Now().Add(-24 * time.Hour)

	exists := func(id string) bool {
		var n int
		if err := mp.QueryRow(ctx, `SELECT count(*) FROM user_files WHERE id = $1::uuid`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}
	mustKeep := func(name, owner, id string, staleBefore time.Time) {
		t.Helper()
		ok, err := d.DeleteChatAttachment(ctx, owner, id, staleBefore)
		if err != nil || ok || !exists(id) {
			t.Fatalf("%s: deleted=%v err=%v exists=%v, want kept", name, ok, err, exists(id))
		}
	}

	sent, _ := seedChatAttachment(t, mp, stor, userID, "chat")
	if _, err := mp.Exec(ctx, `INSERT INTO message_attachments (message_id, user_file_id, position) VALUES ($1::uuid, $2::uuid, 0)`,
		seedUserMessage(t, mp, userID), sent); err != nil {
		t.Fatal(err)
	}
	mustKeep("linked to a message", userID, sent, time.Time{})

	inKB, _ := seedChatAttachment(t, mp, stor, userID, "chat")
	if _, err := mp.Exec(ctx, `INSERT INTO files (kb_id, name, type, storage_path, user_file_id) VALUES ($1::uuid, 'att.txt', 'text/plain', 'x', $2::uuid)`,
		kbID, inKB); err != nil {
		t.Fatal(err)
	}
	mustKeep("copied into a KB", userID, inKB, time.Time{})

	lib, _ := seedChatAttachment(t, mp, stor, userID, "library")
	mustKeep("library file", userID, lib, time.Time{})

	fresh, blob := seedChatAttachment(t, mp, stor, userID, "chat")
	mustKeep("uploaded inside the grace", userID, fresh, stale)
	mustKeep("foreign owner", otherID, fresh, time.Time{})
	if ok, err := d.DeleteChatAttachment(ctx, userID, "not-a-uuid", time.Time{}); ok || err != nil {
		t.Fatalf("malformed id: deleted=%v err=%v", ok, err)
	}

	if _, err := mp.Exec(ctx, `UPDATE user_files SET updated_at = now() - interval '2 days' WHERE id = $1::uuid`, fresh); err != nil {
		t.Fatal(err)
	}
	ok, err := d.DeleteChatAttachment(ctx, userID, fresh, stale)
	if err != nil || !ok || exists(fresh) {
		t.Fatalf("stale unreferenced: deleted=%v err=%v exists=%v, want deleted", ok, err, exists(fresh))
	}
	if ok, _ := stor.FileExists(ctx, blob); ok {
		t.Error("blob of the deleted attachment still exists")
	}
}

// The race the review found: a message that links the file while the delete
// runs. The link transaction holds the FK lock first; the delete must wait
// for it and then keep the file instead of deleting it with its new link.
func TestDeleteChatAttachment_WaitsForConcurrentLink(t *testing.T) {
	mp, vp := openTestPools(t)
	userID, _, _ := seedFixture(t, mp, false)
	stor, err := storage.New(storage.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	d := cascade.New(mp, vp, stor)
	ctx := context.Background()
	id, _ := seedChatAttachment(t, mp, stor, userID, "chat")
	msgID := seedUserMessage(t, mp, userID)

	tx, err := mp.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `INSERT INTO message_attachments (message_id, user_file_id, position) VALUES ($1::uuid, $2::uuid, 0)`, msgID, id); err != nil {
		t.Fatal(err)
	}

	type result struct {
		ok  bool
		err error
	}
	done := make(chan result, 1)
	go func() {
		ok, err := d.DeleteChatAttachment(ctx, userID, id, time.Time{})
		done <- result{ok, err}
	}()
	select {
	case r := <-done:
		t.Fatalf("delete did not wait for the open link transaction: %+v", r)
	case <-time.After(300 * time.Millisecond):
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	r := <-done
	if r.err != nil || r.ok {
		t.Fatalf("deleted=%v err=%v, want kept after the link committed", r.ok, r.err)
	}
	var n int
	if err := mp.QueryRow(ctx, `SELECT count(*) FROM message_attachments WHERE user_file_id = $1::uuid`, id).Scan(&n); err != nil || n != 1 {
		t.Fatalf("message link count %d (err %v), want 1", n, err)
	}
}
