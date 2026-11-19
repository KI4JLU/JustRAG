//go:build integration

// Integration test for the user's sections of the chat history (migration
// 0105): the sections themselves (PGSectionStore) and filing chats in them
// (PGStore.SetChatPinned / SetPinnedOrder). Run against a throwaway database.

package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/justrag/go-backend/internal/store"
)

func TestPGSectionStore(t *testing.T) {
	pool := conflictTestPool(t)
	sections := NewSectionStore(pool)
	chats := NewStore(pool)
	ctx := context.Background()

	chatID := seedChat(t, pool, "sections")
	kbID, userID := chatOwner(t, pool, chatID)
	ensureOwner(t, pool, kbID, userID)
	other := seedChat(t, pool, "sections-other")
	_, otherUser := chatOwner(t, pool, other)
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
	second := add("second")

	// state reads a chat as the lists return it.
	type state struct {
		pinned  bool
		section string
		place   int
	}
	read := func(id string) state {
		t.Helper()
		rows, err := chats.GetChats(ctx, kbID, userID)
		if err != nil {
			t.Fatalf("GetChats: %v", err)
		}
		for _, r := range rows {
			if r.ID != id {
				continue
			}
			st := state{pinned: r.PinnedAt != nil}
			if r.SectionID != nil {
				st.section = *r.SectionID
			}
			if r.PinPosition != nil {
				st.place = *r.PinPosition
			}
			return st
		}
		t.Fatalf("chat %s not listed", id)
		return state{}
	}

	// Sections: created, listed oldest first, renamed.
	work, err := sections.Create(ctx, userID, "Arbeit")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	private, err := sections.Create(ctx, userID, "Privat")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	foreign, err := sections.Create(ctx, otherUser, "Fremd")
	if err != nil {
		t.Fatalf("Create (other user): %v", err)
	}
	if err := sections.Rename(ctx, work.ID, userID, "Beruf"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	list, err := sections.List(ctx, userID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	// ORACLE: what was created for this user, in that order; the other
	// user's section is not theirs to see.
	if len(list) != 2 || list[0].ID != work.ID || list[0].Name != "Beruf" || list[1].ID != private.ID {
		t.Fatalf("List = %+v, want [Beruf, Privat]", list)
	}

	// ORACLE: the order as saved — listed ids take their place, a section
	// added since comes after them, another user's id changes nothing.
	names := func() string {
		t.Helper()
		got, err := sections.List(ctx, userID)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		var b strings.Builder
		for _, s := range got {
			b.WriteString(s.Name + " ")
		}
		return strings.TrimSpace(b.String())
	}
	if err := sections.SetOrder(ctx, userID, []string{private.ID, foreign.ID, work.ID}); err != nil {
		t.Fatalf("SetOrder: %v", err)
	}
	if got := names(); got != "Privat Beruf" {
		t.Errorf("after SetOrder: %q, want \"Privat Beruf\"", got)
	}
	late, err := sections.Create(ctx, userID, "Neu")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if got := names(); got != "Privat Beruf Neu" {
		t.Errorf("a new section: %q, want it last", got)
	}
	// A section left out loses its place and follows the ordered ones.
	if err := sections.SetOrder(ctx, userID, []string{late.ID, work.ID}); err != nil {
		t.Fatalf("SetOrder: %v", err)
	}
	if got := names(); got != "Neu Beruf Privat" {
		t.Errorf("after a partial SetOrder: %q, want \"Neu Beruf Privat\"", got)
	}
	if other, err := sections.List(ctx, otherUser); err != nil || len(other) != 1 || other[0].ID != foreign.ID {
		t.Errorf("the other user's sections = %+v (%v), want theirs untouched", other, err)
	}
	if err := sections.Delete(ctx, late.ID, userID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Someone else's section cannot be renamed, deleted or filed into.
	if err := sections.Rename(ctx, foreign.ID, userID, "Meins"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("rename of another user's section = %v, want ErrNotFound", err)
	}
	if err := sections.Delete(ctx, foreign.ID, userID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("delete of another user's section = %v, want ErrNotFound", err)
	}
	if err := chats.SetChatPinned(ctx, chatID, userID, true, &foreign.ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("filing into another user's section = %v, want ErrNotFound", err)
	}
	unknown := uuid.NewString()
	if err := chats.SetChatPinned(ctx, chatID, userID, true, &unknown); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("filing into an unknown section = %v, want ErrNotFound", err)
	}
	if got := read(chatID); got != (state{}) {
		t.Fatalf("a refused filing changed the chat: %+v", got)
	}

	// Filed in a section, ordered there; the order of one section does not
	// reach another's chats.
	for _, id := range []string{chatID, second} {
		if err := chats.SetChatPinned(ctx, id, userID, true, &work.ID); err != nil {
			t.Fatalf("file %s: %v", id, err)
		}
	}
	if err := chats.SetPinnedOrder(ctx, userID, &work.ID, []string{second, chatID}); err != nil {
		t.Fatalf("SetPinnedOrder: %v", err)
	}
	if got := read(chatID); got != (state{pinned: true, section: work.ID, place: 2}) {
		t.Errorf("filed and ordered chat = %+v", got)
	}
	if err := chats.SetPinnedOrder(ctx, userID, nil, []string{chatID, second}); err != nil {
		t.Fatalf("SetPinnedOrder (Angepinnt): %v", err)
	}
	if err := chats.SetPinnedOrder(ctx, userID, &private.ID, []string{chatID}); err != nil {
		t.Fatalf("SetPinnedOrder (other section): %v", err)
	}
	if got := read(chatID); got.place != 2 {
		t.Errorf("an order for another section moved the chat to place %d", got.place)
	}

	// Filing it again in the same section keeps its place; moving it to
	// another section, or to "Angepinnt", starts without one.
	if err := chats.SetChatPinned(ctx, chatID, userID, true, &work.ID); err != nil {
		t.Fatalf("file again: %v", err)
	}
	if got := read(chatID); got.place != 2 {
		t.Errorf("filing again in the same section lost the place: %+v", got)
	}
	if err := chats.SetChatPinned(ctx, chatID, userID, true, &private.ID); err != nil {
		t.Fatalf("move: %v", err)
	}
	if got := read(chatID); got != (state{pinned: true, section: private.ID}) {
		t.Errorf("moved chat = %+v, want in the new section without a place", got)
	}
	if err := chats.SetChatPinned(ctx, chatID, userID, true, nil); err != nil {
		t.Fatalf("move to Angepinnt: %v", err)
	}
	if got := read(chatID); got != (state{pinned: true}) {
		t.Errorf("chat moved to Angepinnt = %+v", got)
	}

	// Deleting a section lets its chats go back to the plain history, and
	// leaves the chats of other sections alone.
	if err := sections.Delete(ctx, work.ID, userID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if got := read(second); got != (state{}) {
		t.Errorf("chat of a deleted section = %+v, want let go", got)
	}
	if got := read(chatID); got != (state{pinned: true}) {
		t.Errorf("deleting a section changed a chat outside it: %+v", got)
	}
	if err := sections.Delete(ctx, work.ID, userID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("second delete = %v, want ErrNotFound", err)
	}
}

// ORACLE: MaxSectionsPerUser — the cap is per user and the next create is refused.
func TestPGSectionStore_Cap(t *testing.T) {
	pool := conflictTestPool(t)
	sections := NewSectionStore(pool)
	ctx := context.Background()
	_, userID := chatOwner(t, pool, seedChat(t, pool, "sections-cap"))

	for i := range MaxSectionsPerUser {
		if _, err := sections.Create(ctx, userID, fmt.Sprintf("s%d", i)); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	if _, err := sections.Create(ctx, userID, "one too many"); !errors.Is(err, ErrTooManySections) {
		t.Errorf("create past the cap = %v, want ErrTooManySections", err)
	}
	list, err := sections.List(ctx, userID)
	if err != nil || len(list) != MaxSectionsPerUser {
		t.Errorf("List = %d sections (%v), want %d", len(list), err, MaxSectionsPerUser)
	}
}
