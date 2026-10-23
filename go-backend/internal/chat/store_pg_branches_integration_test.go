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
	// Oracle: the copy of a1 is the branch's last message (asserted below).
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
	if branch.CopiedMessageID != msgs[1].ID {
		t.Fatalf("copiedMessageId = %q, want the copy of a1 (%s)", branch.CopiedMessageID, msgs[1].ID)
	}

	// An empty branch (editing the first question): a new chat, no messages.
	empty, err := s.BranchChat(ctx, chatID, "", userID)
	if err != nil {
		t.Fatalf("empty BranchChat: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1::uuid`, empty.ID) }) //nolint:errcheck
	if got, _ := s.GetChatMessages(ctx, empty.ID); len(got) != 0 || empty.CopiedMessageID != "" || empty.BranchedFromChatID == nil {
		t.Fatalf("empty branch: %d messages, copied %q, origin %v", len(got), empty.CopiedMessageID, empty.BranchedFromChatID)
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

// Oracle: the chat variants whose state is not just the parent chain, as
// seeded — a research session (goal and report without parent links) and an
// agent chat (an ADK session keyed by the chat id) — are refused, not copied
// half.
func TestPGStore_BranchChatRefusesResearchAndAgentChats(t *testing.T) {
	pool := conflictTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()

	research := seedChat(t, pool, "branch-research")
	_, ownerR := chatOwner(t, pool, research)
	if _, err := pool.Exec(ctx, `UPDATE chats SET type = 'research' WHERE id = $1::uuid`, research); err != nil {
		t.Fatal(err)
	}
	report, err := s.AddMessage(ctx, AddMessageParams{ChatID: research, Role: "ai", Content: "report"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.BranchChat(ctx, research, report.ID, ownerR); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("research chat: err = %v, want ErrNotFound", err)
	}

	agent := seedChat(t, pool, "branch-agent")
	_, ownerA := chatOwner(t, pool, agent)
	if _, err := pool.Exec(ctx, `
		INSERT INTO adk_sessions (app_name, user_id, id, update_time) VALUES ($1, $2, $3, now())`,
		agentChatApp, ownerA, agent); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM adk_sessions WHERE id = $1`, agent) }) //nolint:errcheck
	q, err := s.AddMessage(ctx, AddMessageParams{ChatID: agent, Role: "user", Content: "q"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.BranchChat(ctx, agent, q.ID, ownerA); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("agent chat: err = %v, want ErrNotFound", err)
	}
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

// Older branched chats — versions inside one chat — stay marked in the list.
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

	// Production writes is_enhanced on the question row itself (http_send.go):
	// an edited question asked with prompt enhancement is still a branch.
	t.Run("enhanced sibling questions are a branch", func(t *testing.T) {
		chatID := seedChat(t, pool, "branches-enhanced")
		for _, q := range []string{"q1", "q1 edited"} {
			if _, err := store.AddMessage(ctx, AddMessageParams{ChatID: chatID, Role: "user", Content: q, IsEnhanced: true, EnhancedQuery: &q}); err != nil {
				t.Fatalf("AddMessage: %v", err)
			}
		}
		if !listedHasBranches(t, store, pool, chatID) {
			t.Fatal("enhanced sibling questions not listed as branched")
		}
	})
}
