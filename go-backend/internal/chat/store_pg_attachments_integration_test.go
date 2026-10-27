//go:build integration

// Integration tests for chat attachments (migration 0090). Skipped when DB_*
// env is unset.

package chat

import (
	"context"
	"testing"
)

// Oracle: the message links are written with the user message, in attach
// order, and read back per message; chat-scoped files of a chat are listed
// for cleanup and are unreferenced once the chat is gone.
func TestPGStore_MessageAttachmentsRoundTrip(t *testing.T) {
	pool := conflictTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	chatID := seedChat(t, pool, "attachments")
	var userID string
	if err := pool.QueryRow(ctx, `SELECT user_id::text FROM chats WHERE id = $1::uuid`, chatID).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	a := seedLibraryFile(t, pool, userID, "a.pdf", "a")
	b := seedLibraryFile(t, pool, userID, "b.pdf", "b")
	lib := seedLibraryFile(t, pool, userID, "lib.pdf", "c")
	if _, err := pool.Exec(ctx, `UPDATE user_files SET scope = 'chat' WHERE id = ANY($1::uuid[])`, []string{a, b}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM user_files WHERE id = ANY($1::uuid[])`, []string{a, b, lib}) //nolint:errcheck
	})

	msg, err := store.AddMessage(ctx, AddMessageParams{ChatID: chatID, Role: "user", Content: "q", AttachmentIDs: []string{b, a, lib}})
	if err != nil {
		t.Fatalf("AddMessage: %v", err)
	}
	got, err := store.MessageAttachments(ctx, []string{msg.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].File.ID != b || got[1].File.ID != a || got[2].File.ID != lib {
		t.Fatalf("attachments %+v, want b, a, lib in attach order", got)
	}
	if got[0].File.Scope != "chat" || got[2].File.Scope != "library" || got[0].File.OwnerUserID != userID {
		t.Fatalf("file rows not joined: %+v / %+v", got[0].File, got[2].File)
	}

	refs, err := store.ChatScopedAttachments(ctx, chatID)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 {
		t.Fatalf("chat-scoped refs %+v, want a and b only (lib is a library file)", refs)
	}

	if err := store.DeleteChat(ctx, chatID); err != nil {
		t.Fatal(err)
	}
	var links int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM message_attachments WHERE user_file_id = ANY($1::uuid[])`, []string{a, b, lib}).Scan(&links); err != nil || links != 0 {
		t.Fatalf("message links after chat delete: %d (err %v), want 0", links, err)
	}
}
