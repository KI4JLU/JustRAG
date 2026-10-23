//go:build integration

// Integration test for the chat list's hasBranches flag: GetChats marks a
// chat whose messages fork (two siblings under one parent, or two roots) and
// nothing else. Run through withdb.sh.

package chat

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// chatOwner returns the KB and user GetChats is scoped to for a seeded chat.
func chatOwner(t *testing.T, pool *pgxpool.Pool, chatID string) (kbID, userID string) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT kb_id::text, user_id::text FROM chats WHERE id = $1::uuid`, chatID).Scan(&kbID, &userID); err != nil {
		t.Fatalf("chat owner: %v", err)
	}
	return kbID, userID
}

// listedHasBranches is the oracle-facing read: the flag exactly as the chat
// list (GetChats) reports it for this chat.
func listedHasBranches(t *testing.T, store *PGStore, pool *pgxpool.Pool, chatID string) bool {
	t.Helper()
	kbID, userID := chatOwner(t, pool, chatID)
	chats, err := store.GetChats(context.Background(), kbID, userID)
	if err != nil {
		t.Fatalf("GetChats: %v", err)
	}
	for _, c := range chats {
		if c.ID == chatID {
			return c.HasBranches
		}
	}
	t.Fatalf("chat %s not listed", chatID)
	return false
}

func TestPGStore_GetChatsHasBranches(t *testing.T) {
	pool := conflictTestPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	add := func(chatID, role, content string, parent *string) string {
		t.Helper()
		m, err := store.AddMessage(ctx, AddMessageParams{ChatID: chatID, Role: role, Content: content, ParentMessageID: parent})
		if err != nil {
			t.Fatalf("AddMessage: %v", err)
		}
		return m.ID
	}

	// Oracle for every case: the message tree written here, by construction.
	t.Run("a linear chat has no branches", func(t *testing.T) {
		chatID := seedChat(t, pool, "branches-linear")
		q := add(chatID, "user", "q1", nil)
		a := add(chatID, "ai", "a1", &q)
		q2 := add(chatID, "user", "q2", &a)
		add(chatID, "ai", "a2", &q2)
		if listedHasBranches(t, store, pool, chatID) {
			t.Fatal("linear chat listed as branched")
		}
	})

	t.Run("a regenerated answer is a branch", func(t *testing.T) {
		chatID := seedChat(t, pool, "branches-regen")
		q := add(chatID, "user", "q1", nil)
		add(chatID, "ai", "a1", &q)
		add(chatID, "ai", "a1 again", &q)
		if !listedHasBranches(t, store, pool, chatID) {
			t.Fatal("regenerated answer not listed as branched")
		}
	})

	t.Run("an edited first question (two roots) is a branch", func(t *testing.T) {
		chatID := seedChat(t, pool, "branches-roots")
		add(chatID, "user", "q1", nil)
		add(chatID, "user", "q1 edited", nil)
		if !listedHasBranches(t, store, pool, chatID) {
			t.Fatal("two root questions not listed as branched")
		}
	})

	t.Run("a prompt-enhancement row is not a branch", func(t *testing.T) {
		chatID := seedChat(t, pool, "branches-enhanced")
		q := add(chatID, "user", "q1", nil)
		add(chatID, "ai", "a1", &q)
		if _, err := pool.Exec(ctx, `
			INSERT INTO messages (chat_id, role, content, parent_message_id, is_enhanced)
			VALUES ($1::uuid, 'ai', 'enhanced', $2::uuid, true)`, chatID, q); err != nil {
			t.Fatal(err)
		}
		if listedHasBranches(t, store, pool, chatID) {
			t.Fatal("enhancement row counted as a branch")
		}
	})
}
