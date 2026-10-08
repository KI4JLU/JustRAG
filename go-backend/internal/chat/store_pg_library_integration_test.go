//go:build integration

// Integration tests for phase-3 KB-less library chats (migration 0081).
// Skipped when DB_* env is unset; run through the withdb.sh wrapper.

package chat

import (
	"context"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func seedLibraryUser(t *testing.T, pool *pgxpool.Pool, suffix string) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'x-not-a-real-hash', 'user') RETURNING id::text`,
		"chat-library-test-"+suffix).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		// chats first: the user FK may not cascade.
		pool.Exec(ctx, `DELETE FROM chats WHERE user_id = $1::uuid`, userID)            //nolint:errcheck
		pool.Exec(ctx, `DELETE FROM user_files WHERE owner_user_id = $1::uuid`, userID) //nolint:errcheck
		pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, userID)                 //nolint:errcheck
	})
	return userID
}

func seedLibraryFile(t *testing.T, pool *pgxpool.Pool, userID, name, sha string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO user_files (owner_user_id, name, mime, size, sha256, storage_path)
		VALUES ($1::uuid, $2::text, 'text/plain', 3, repeat($3::text, 64), 'users/x/'||$2::text)
		RETURNING id::text`, userID, name, sha).Scan(&id); err != nil {
		t.Fatalf("insert user_file: %v", err)
	}
	return id
}

func TestPGStore_LibraryChatRoundTrip(t *testing.T) {
	pool := conflictTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	userID := seedLibraryUser(t, pool, "roundtrip")

	created, err := store.CreateLibraryChat(ctx, userID, "meine Dateien")
	if err != nil {
		t.Fatalf("CreateLibraryChat: %v", err)
	}
	if created.KbID != "" || created.Type != "library" {
		t.Fatalf("created = %+v, want KbID \"\" and Type library", created)
	}
	got, err := store.GetChatByID(ctx, created.ID)
	if err != nil || got == nil {
		t.Fatalf("GetChatByID: %v %v", got, err)
	}
	if got.KbID != "" || got.Type != "library" || got.UserID != userID {
		t.Fatalf("got = %+v", got)
	}
}

func TestPGStore_LibraryChatsListedSeparately(t *testing.T) {
	pool := conflictTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	kbChatID := seedChat(t, pool, "libsep") // KB chat of another throwaway user
	var kbID, kbUser string
	if err := pool.QueryRow(ctx, `SELECT kb_id::text, user_id::text FROM chats WHERE id = $1::uuid`, kbChatID).Scan(&kbID, &kbUser); err != nil {
		t.Fatal(err)
	}
	// Same user owns a library chat too.
	lib, err := store.CreateLibraryChat(ctx, kbUser, "lib")
	if err != nil {
		t.Fatalf("CreateLibraryChat: %v", err)
	}
	other := seedLibraryUser(t, pool, "libsep-other")
	if _, err := store.CreateLibraryChat(ctx, other, "foreign"); err != nil {
		t.Fatal(err)
	}

	libs, err := store.GetLibraryChats(ctx, kbUser)
	if err != nil {
		t.Fatalf("GetLibraryChats: %v", err)
	}
	if len(libs) != 1 || libs[0].ID != lib.ID {
		t.Fatalf("GetLibraryChats = %+v, want only %s", libs, lib.ID)
	}

	kbChats, err := store.GetChats(ctx, kbID, kbUser)
	if err != nil {
		t.Fatalf("GetChats: %v", err)
	}
	if len(kbChats) != 1 || kbChats[0].ID != kbChatID {
		t.Fatalf("GetChats = %+v, want only the KB chat", kbChats)
	}
}

func TestPGStore_ChatFileRefs(t *testing.T) {
	pool := conflictTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	userID := seedLibraryUser(t, pool, "refs")
	chat, err := store.CreateLibraryChat(ctx, userID, "refs")
	if err != nil {
		t.Fatal(err)
	}
	f1 := seedLibraryFile(t, pool, userID, "a.txt", "a")
	f2 := seedLibraryFile(t, pool, userID, "b.txt", "b")
	f3 := seedLibraryFile(t, pool, userID, "c.txt", "c")

	if got, err := store.GetChatFileRefs(ctx, chat.ID); err != nil || len(got) != 0 {
		t.Fatalf("empty refs = %v, %v", got, err)
	}
	if err := store.ReplaceChatFileRefs(ctx, chat.ID, []string{f2, f1}); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	got, err := store.GetChatFileRefs(ctx, chat.ID)
	if err != nil || !reflect.DeepEqual(got, []string{f2, f1}) {
		t.Fatalf("refs = %v (%v), want [f2 f1] in insert order", got, err)
	}
	// Replace drops f2, keeps f1, adds f3.
	if err := store.ReplaceChatFileRefs(ctx, chat.ID, []string{f1, f3}); err != nil {
		t.Fatalf("Replace 2: %v", err)
	}
	got, _ = store.GetChatFileRefs(ctx, chat.ID)
	if !reflect.DeepEqual(got, []string{f1, f3}) {
		t.Fatalf("refs after replace = %v, want [f1 f3]", got)
	}

	// Deleting the library file removes its ref (CASCADE).
	if _, err := pool.Exec(ctx, `DELETE FROM user_files WHERE id = $1::uuid`, f1); err != nil {
		t.Fatal(err)
	}
	got, _ = store.GetChatFileRefs(ctx, chat.ID)
	if !reflect.DeepEqual(got, []string{f3}) {
		t.Fatalf("refs after file delete = %v, want [f3]", got)
	}

	// Deleting the chat removes the refs too.
	if err := store.DeleteChat(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM chat_file_refs WHERE chat_id = $1::uuid`, chat.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("refs after chat delete = %d, %v", n, err)
	}
}

func TestPGStore_AddMessageLibraryChatWritesNoChunkLinks(t *testing.T) {
	pool := conflictTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	userID := seedLibraryUser(t, pool, "nolinks")
	chat, err := store.CreateLibraryChat(ctx, userID, "nolinks")
	if err != nil {
		t.Fatal(err)
	}
	msg, err := store.AddMessage(ctx, AddMessageParams{
		ChatID:  chat.ID,
		Role:    "ai",
		Content: "antwort [1]",
		Sources: []ChatSource{{Index: 1, ChunkID: "11111111-2222-3333-4444-555555555555"}},
	})
	if err != nil {
		t.Fatalf("AddMessage on a library chat must not error: %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM message_chunks WHERE message_id = $1::uuid`, msg.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("message_chunks rows = %d (%v), want 0", n, err)
	}
}
