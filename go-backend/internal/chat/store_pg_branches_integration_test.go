//go:build integration

// Integration tests for BranchChat ("Verzweigen"): the path up to the chosen
// message is copied into a new chat that records its origin, nothing else is,
// and it is the owner's alone. Run through withdb.sh.

package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/store"
)

// chatOwner returns the KB and user a seeded chat belongs to.
func chatOwner(t *testing.T, pool *pgxpool.Pool, chatID string) (kbID, userID string) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT kb_id::text, user_id::text FROM chats WHERE id = $1::uuid`, chatID).Scan(&kbID, &userID); err != nil {
		t.Fatalf("chat owner: %v", err)
	}
	return kbID, userID
}

func TestPGStore_BranchChat(t *testing.T) {
	pool := conflictTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()

	chatID := seedChat(t, pool, "branch-src")
	kbID, userID := chatOwner(t, pool, chatID)
	add := func(role, content string, parent *string) string {
		t.Helper()
		m, err := s.AddMessage(ctx, AddMessageParams{ChatID: chatID, Role: role, Content: content, ParentMessageID: parent})
		if err != nil {
			t.Fatalf("AddMessage: %v", err)
		}
		return m.ID
	}
	// Oracle: this tree, by construction — q1 → a1 → q2 → a2, plus a
	// regenerated sibling a1b of a1 that is NOT on the path to a1.
	q1 := add("user", "q1", nil)
	a1 := add("ai", "a1", &q1)
	add("ai", "a1b", &q1)
	q2 := add("user", "q2", &a1)
	add("ai", "a2", &q2)

	branch, err := s.BranchChat(ctx, chatID, a1, userID)
	if err != nil {
		t.Fatalf("BranchChat: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1::uuid`, branch.ID) }) //nolint:errcheck

	if branch.ID == chatID || branch.BranchedFromChatID == nil || *branch.BranchedFromChatID != chatID {
		t.Fatalf("branch = %+v, want a new chat branched from %s", branch, chatID)
	}
	if branch.KbID != kbID || branch.UserID != userID {
		t.Fatalf("branch belongs to (%s, %s), want (%s, %s)", branch.KbID, branch.UserID, kbID, userID)
	}

	msgs, err := s.GetChatMessages(ctx, branch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 2 || msgs[0].Content != "q1" || msgs[1].Content != "a1" {
		t.Fatalf("branch messages = %+v, want exactly q1, a1", msgs)
	}
	if msgs[0].ID == q1 || msgs[1].ID == a1 {
		t.Fatal("branch reuses the original message ids")
	}
	if msgs[0].ParentMessageID != nil || msgs[1].ParentMessageID == nil || *msgs[1].ParentMessageID != msgs[0].ID {
		t.Fatalf("parent links not remapped: q1.parent=%v a1.parent=%v", msgs[0].ParentMessageID, msgs[1].ParentMessageID)
	}

	// The original is untouched, and the list tells the two apart.
	if orig, _ := s.GetChatMessages(ctx, chatID); len(orig) != 5 {
		t.Fatalf("original has %d messages after branching, want 5", len(orig))
	}
	chats, err := s.GetChats(ctx, kbID, userID)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]*string{}
	for _, c := range chats {
		seen[c.ID] = c.BranchedFromChatID
	}
	if from, ok := seen[branch.ID]; !ok || from == nil || *from != chatID {
		t.Fatalf("list: branch origin = %v, want %s", from, chatID)
	}
	if from, ok := seen[chatID]; !ok || from != nil {
		t.Fatalf("list: original origin = %v, want none", from)
	}
}

func TestPGStore_BranchChatOwnerAndChatOnly(t *testing.T) {
	pool := conflictTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()

	chatA := seedChat(t, pool, "branch-a")
	chatB := seedChat(t, pool, "branch-b")
	_, ownerA := chatOwner(t, pool, chatA)
	_, ownerB := chatOwner(t, pool, chatB)
	mA, err := s.AddMessage(ctx, AddMessageParams{ChatID: chatA, Role: "user", Content: "q"})
	if err != nil {
		t.Fatal(err)
	}
	count := func() int {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM chats WHERE branched_from_chat_id IN ($1::uuid, $2::uuid)`, chatA, chatB).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Oracle: ownership and chat membership as seeded — B's user may not
	// branch A's chat, and A's message is not in B's chat.
	if _, err := s.BranchChat(ctx, chatA, mA.ID, ownerB); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("foreign user: err = %v, want ErrNotFound", err)
	}
	if _, err := s.BranchChat(ctx, chatB, mA.ID, ownerB); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("message from another chat: err = %v, want ErrNotFound", err)
	}
	if n := count(); n != 0 {
		t.Fatalf("%d branch chats created by refused calls, want 0", n)
	}
	_ = ownerA
}
