//go:build integration

// Integration test for PGStore.GetAllChats (GET /api/chats): the caller's
// chats across topics, only in topics the caller can still open, newest
// activity first, capped. Run against a throwaway database.

package chat

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/store"
)

func TestPGStore_GetAllChats(t *testing.T) {
	pool := conflictTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()
	m := "allchats-" + uuid.NewString()[:8]

	user := func(name string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO users (username, password_hash, role)
			VALUES ($1, 'x-not-a-real-hash', 'user') RETURNING id::text`, m+"-"+name).Scan(&id); err != nil {
			t.Fatalf("insert user %s: %v", name, err)
		}
		t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, id) }) //nolint:errcheck
		return id
	}
	kb := func(name, visibility string, published bool) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO knowledge_bases (name, visibility, is_published)
			VALUES ($1, $2, $3) RETURNING id::text`, m+"-"+name, visibility, published).Scan(&id); err != nil {
			t.Fatalf("insert kb %s: %v", name, err)
		}
		t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, id) }) //nolint:errcheck
		return id
	}
	member := func(kbID, userID, role string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)`,
			kbID, userID, role); err != nil {
			t.Fatalf("insert member: %v", err)
		}
	}
	// age is how long ago the chat was last active; it sets the order.
	chatIn := func(kbID *string, userID, title, typ string, age time.Duration) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO chats (kb_id, user_id, title, type, updated_at)
			VALUES ($1::uuid, $2::uuid, $3, $4, now() - $5::interval) RETURNING id::text`,
			kbID, userID, title, typ, fmt.Sprintf("%d seconds", int(age.Seconds()))).Scan(&id); err != nil {
			t.Fatalf("insert chat %s: %v", title, err)
		}
		t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1::uuid`, id) }) //nolint:errcheck
		return id
	}

	caller, other := user("caller"), user("other")
	own := kb("own", "private", false)
	shared := kb("shared", "private", false)
	public := kb("public", "public", true)
	gone := kb("gone", "private", false)    // the caller's membership was removed
	staged := kb("staged", "public", false) // public, not published
	member(own, caller, kbaccess.RoleOwner)
	member(shared, other, kbaccess.RoleOwner)
	member(shared, caller, kbaccess.RoleEdit)
	member(gone, other, kbaccess.RoleOwner)

	inOwn := chatIn(&own, caller, "own", "chat", 3*time.Minute)
	inShared := chatIn(&shared, caller, "shared", "chat", 1*time.Minute)
	inPublic := chatIn(&public, caller, "public", "chat", 2*time.Minute)
	chatIn(&gone, caller, "gone", "chat", 0)
	chatIn(&staged, caller, "staged", "chat", 0)
	chatIn(&shared, other, "someone else's", "chat", 0)
	chatIn(nil, caller, "library", "library", 0)

	got, err := s.GetAllChats(ctx, caller, "user", AllChatsLimit)
	if err != nil {
		t.Fatalf("GetAllChats: %v", err)
	}

	// ORACLE: the access ladder (kbaccess.EffectiveRole): a member has their
	// role, a published public topic grants view, and a private topic without
	// membership or an unpublished public one is invisible. Order: updated_at
	// DESC, from the ages above.
	type row struct{ id, kbID, kbName, visibility, role string }
	want := []row{
		{inShared, shared, m + "-shared", "private", kbaccess.RoleEdit},
		{inPublic, public, m + "-public", "public", kbaccess.RoleView},
		{inOwn, own, m + "-own", "private", kbaccess.RoleOwner},
	}
	if len(got) != len(want) {
		t.Fatalf("GetAllChats returned %d rows, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		g := row{got[i].ID, got[i].KbID, got[i].KBName, got[i].KBVisibility, got[i].KBRole}
		if g != w {
			t.Errorf("row %d = %+v, want %+v", i, g, w)
		}
		if got[i].UserID != caller {
			t.Errorf("row %d belongs to %s, want the caller", i, got[i].UserID)
		}
	}

	// The cap keeps the newest.
	capped, err := s.GetAllChats(ctx, caller, "user", 2)
	if err != nil {
		t.Fatalf("GetAllChats (limit 2): %v", err)
	}
	if len(capped) != 2 || capped[0].ID != inShared || capped[1].ID != inPublic {
		t.Errorf("limit 2 = %+v, want the two newest", capped)
	}
}

func TestPGStore_GetAllChats_HasBranches(t *testing.T) {
	pool := conflictTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()

	chatID := seedChat(t, pool, "allchats-branches")
	kbID, userID := chatOwner(t, pool, chatID)
	ensureOwner(t, pool, kbID, userID)

	find := func() ChatListRow {
		t.Helper()
		rows, err := s.GetAllChats(ctx, userID, "user", AllChatsLimit)
		if err != nil {
			t.Fatalf("GetAllChats: %v", err)
		}
		for _, r := range rows {
			if r.ID == chatID {
				return r
			}
		}
		t.Fatalf("chat %s not listed: %+v", chatID, rows)
		return ChatListRow{}
	}
	if find().HasBranches {
		t.Fatal("a chat without messages lists hasBranches")
	}
	// Two root messages share the NULL parent: the same rule as GetChats.
	for _, content := range []string{"a", "b"} {
		if _, err := s.AddMessage(ctx, AddMessageParams{ChatID: chatID, Role: "user", Content: content}); err != nil {
			t.Fatalf("AddMessage: %v", err)
		}
	}
	if !find().HasBranches {
		t.Error("a chat with two sibling messages must list hasBranches")
	}
}

// ensureOwner gives userID the owner row on kbID unless a trigger already did.
func ensureOwner(t *testing.T, pool *pgxpool.Pool, kbID, userID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT (kb_id, user_id) DO NOTHING`, kbID, userID, kbaccess.RoleOwner); err != nil {
		t.Fatalf("insert owner: %v", err)
	}
}

// Pinning (migration 0105): the owner pins and unpins, both lists return
// pinnedAt, the cap of GetAllChats never drops a pinned chat, and a pin is
// not activity.
func TestPGStore_SetChatPinned(t *testing.T) {
	pool := conflictTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()

	chatID := seedChat(t, pool, "pin")
	kbID, userID := chatOwner(t, pool, chatID)
	ensureOwner(t, pool, kbID, userID)
	// A newer chat of the same user, so the pinned one is not the most recent.
	var newer string
	if err := pool.QueryRow(ctx, `
		INSERT INTO chats (kb_id, user_id, title, updated_at)
		VALUES ($1::uuid, $2::uuid, 'newer', now() + interval '1 hour') RETURNING id::text`,
		kbID, userID).Scan(&newer); err != nil {
		t.Fatalf("insert newer chat: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1::uuid`, newer) }) //nolint:errcheck

	updatedAt := func() time.Time {
		t.Helper()
		var at time.Time
		if err := pool.QueryRow(ctx, `SELECT updated_at FROM chats WHERE id = $1::uuid`, chatID).Scan(&at); err != nil {
			t.Fatalf("read updated_at: %v", err)
		}
		return at
	}
	pinnedAt := func() *time.Time {
		t.Helper()
		rows, err := s.GetChats(ctx, kbID, userID)
		if err != nil {
			t.Fatalf("GetChats: %v", err)
		}
		for _, r := range rows {
			if r.ID == chatID {
				return r.PinnedAt
			}
		}
		t.Fatalf("chat %s not listed", chatID)
		return nil
	}
	before := updatedAt()

	if pinnedAt() != nil {
		t.Fatal("a new chat lists as pinned")
	}
	if err := s.SetChatPinned(ctx, chatID, userID, true, nil); err != nil {
		t.Fatalf("pin: %v", err)
	}
	first := pinnedAt()
	if first == nil {
		t.Fatal("a pinned chat lists without pinnedAt")
	}
	// ORACLE: the cap is on the plain history only — with room for one row
	// there, the list is that newest unpinned chat and the pinned one on top
	// of it, however long ago the pinned one was used.
	capped, err := s.GetAllChats(ctx, userID, "user", 1)
	if err != nil {
		t.Fatalf("GetAllChats: %v", err)
	}
	var kept, plain int
	for _, r := range capped {
		switch {
		case r.ID == chatID && r.PinnedAt != nil:
			kept++
		case r.PinnedAt == nil:
			plain++
		}
	}
	if len(capped) != 2 || kept != 1 || plain != 1 {
		t.Errorf("limit 1 = %+v, want the pinned chat with pinnedAt and one unpinned chat", capped)
	}

	// Pinning again keeps the first pin time.
	if err := s.SetChatPinned(ctx, chatID, userID, true, nil); err != nil {
		t.Fatalf("pin again: %v", err)
	}
	if again := pinnedAt(); again == nil || !again.Equal(*first) {
		t.Errorf("pinning a pinned chat moved pinnedAt from %v to %v", first, again)
	}
	if !updatedAt().Equal(before) {
		t.Error("pinning changed updated_at; a pin is not activity")
	}

	// Someone else cannot pin or unpin it, and an unknown chat is not found.
	if err := s.SetChatPinned(ctx, chatID, uuid.NewString(), false, nil); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("unpin by another user = %v, want ErrNotFound", err)
	}
	if pinnedAt() == nil {
		t.Error("another user's unpin took effect")
	}
	if err := s.SetChatPinned(ctx, uuid.NewString(), userID, true, nil); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("pin of an unknown chat = %v, want ErrNotFound", err)
	}

	if err := s.SetChatPinned(ctx, chatID, userID, false, nil); err != nil {
		t.Fatalf("unpin: %v", err)
	}
	if pinnedAt() != nil {
		t.Error("an unpinned chat still lists pinnedAt")
	}
	if !updatedAt().Equal(before) {
		t.Error("unpinning changed updated_at")
	}
}

// The owner's own order of their pinned chats (PUT /api/chats/pin-order).
func TestPGStore_SetPinnedOrder(t *testing.T) {
	pool := conflictTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()

	first := seedChat(t, pool, "pinorder")
	kbID, userID := chatOwner(t, pool, first)
	ensureOwner(t, pool, kbID, userID)
	add := func(title string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO chats (kb_id, user_id, title) VALUES ($1::uuid, $2::uuid, $3) RETURNING id::text`,
			kbID, userID, title).Scan(&id); err != nil {
			t.Fatalf("insert chat %s: %v", title, err)
		}
		t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1::uuid`, id) }) //nolint:errcheck
		return id
	}
	second, third, unpinned := add("second"), add("third"), add("unpinned")
	// Someone else's pinned chat: an order must never reach it.
	foreign := seedChat(t, pool, "pinorder-foreign")
	_, foreignUser := chatOwner(t, pool, foreign)
	for _, c := range []struct{ id, user string }{{first, userID}, {second, userID}, {third, userID}, {foreign, foreignUser}} {
		if err := s.SetChatPinned(ctx, c.id, c.user, true, nil); err != nil {
			t.Fatalf("pin: %v", err)
		}
	}

	positions := func() map[string]*int {
		t.Helper()
		rows, err := pool.Query(ctx, `SELECT id::text, pin_position FROM chats WHERE id = ANY($1::uuid[])`,
			[]string{first, second, third, unpinned, foreign})
		if err != nil {
			t.Fatalf("read positions: %v", err)
		}
		defer rows.Close()
		got := map[string]*int{}
		for rows.Next() {
			var id string
			var pos *int
			if err := rows.Scan(&id, &pos); err != nil {
				t.Fatalf("scan: %v", err)
			}
			got[id] = pos
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("rows: %v", err)
		}
		return got
	}
	want := func(step string, expect map[string]int) {
		t.Helper()
		got := positions()
		for _, id := range []string{first, second, third, unpinned, foreign} {
			w, listed := expect[id]
			switch {
			case listed && (got[id] == nil || *got[id] != w):
				t.Errorf("%s: position of %s = %v, want %d", step, id, got[id], w)
			case !listed && got[id] != nil:
				t.Errorf("%s: position of %s = %d, want none", step, id, *got[id])
			}
		}
	}

	want("freshly pinned", map[string]int{})

	// ORACLE: the order handed in, 1-based. The unpinned chat and the other
	// user's pinned chat are named too and must stay untouched; a repeated id
	// counts once, at its first place.
	if err := s.SetPinnedOrder(ctx, userID, nil, []string{third, unpinned, first, foreign, second, third}); err != nil {
		t.Fatalf("SetPinnedOrder: %v", err)
	}
	want("ordered", map[string]int{third: 1, first: 3, second: 5})

	// The list returns it.
	rows, err := s.GetChats(ctx, kbID, userID)
	if err != nil {
		t.Fatalf("GetChats: %v", err)
	}
	for _, r := range rows {
		if r.ID == third && (r.PinPosition == nil || *r.PinPosition != 1) {
			t.Errorf("GetChats pinPosition of the first chat = %v, want 1", r.PinPosition)
		}
	}

	// A save is the whole order: a pinned chat it leaves out loses its place.
	if err := s.SetPinnedOrder(ctx, userID, nil, []string{second}); err != nil {
		t.Fatalf("SetPinnedOrder: %v", err)
	}
	want("rewritten", map[string]int{second: 1})

	// Unpinning gives the place up; pinning again starts without one.
	if err := s.SetChatPinned(ctx, second, userID, false, nil); err != nil {
		t.Fatalf("unpin: %v", err)
	}
	want("unpinned", map[string]int{})
}
