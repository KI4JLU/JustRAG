//go:build integration

// Integration test for chats.role_id (migration 0092): a chat started in a
// role stores it, the chat list and lookup return it, a branch keeps it, and
// the turn's prompt is read in it. Run through withdb.sh.

package chat

import (
	"context"
	"strings"
	"testing"
)

func TestPGStore_ChatRole(t *testing.T) {
	pool := conflictTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()

	seed := seedChat(t, pool, "role-src")
	kbID, userID := chatOwner(t, pool, seed)

	c, err := s.CreateChatWithRole(ctx, kbID, userID, "Elternzeit", "tutor")
	if err != nil {
		t.Fatalf("CreateChatWithRole: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1::uuid`, c.ID) }) //nolint:errcheck
	if c.RoleID == nil || *c.RoleID != "tutor" {
		t.Fatalf("created RoleID = %v", c.RoleID)
	}

	got, err := s.GetChatByID(ctx, c.ID)
	if err != nil || got.RoleID == nil || *got.RoleID != "tutor" {
		t.Fatalf("GetChatByID RoleID = %v (%v)", got, err)
	}
	list, err := s.GetChats(ctx, kbID, userID)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range list {
		switch row.ID {
		case c.ID:
			if row.RoleID == nil || *row.RoleID != "tutor" {
				t.Errorf("list RoleID = %v", row.RoleID)
			}
		case seed:
			if row.RoleID != nil {
				t.Errorf("chat without a role lists RoleID %q", *row.RoleID)
			}
		}
	}

	branch, err := s.BranchChat(ctx, c.ID, "", userID)
	if err != nil {
		t.Fatalf("BranchChat: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM chats WHERE id = $1::uuid`, branch.ID) }) //nolint:errcheck
	if b, _ := s.GetChatByID(ctx, branch.ID); b == nil || b.RoleID == nil || *b.RoleID != "tutor" {
		t.Errorf("branch must keep the role: %+v", b)
	}

	// A KB never customized (behavior NULL) still answers a chat started in
	// a template role in that role; the KB itself keeps its old prompt.
	if _, err := pool.Exec(ctx, `UPDATE knowledge_bases SET behavior = NULL, system_prompt = 'alt' WHERE id = $1::uuid`, kbID); err != nil {
		t.Fatal(err)
	}
	if p, err := s.GetChatSystemPrompt(ctx, kbID, c.ID); err != nil || p == nil || !strings.HasPrefix(*p, "Du bist ein geduldiger Tutor") {
		t.Fatalf("uncustomized KB, tutor chat prompt = %v (%v)", p, err)
	}
	if p, err := s.GetChatSystemPrompt(ctx, kbID, seed); err != nil || p == nil || *p != "alt" {
		t.Fatalf("uncustomized KB, chat without a role = %v (%v)", p, err)
	}

	// Oracle: the catalog's tutor prompt opens the compiled prompt (the seeded
	// KB was created before 0092's defaults, so it has no rules on).
	if _, err := pool.Exec(ctx, `UPDATE knowledge_bases SET behavior = '{"version":1,"activeRoleId":"research","customRoles":[],"rules":{},"customRules":[]}' WHERE id = $1::uuid`, kbID); err != nil {
		t.Fatal(err)
	}
	p, err := s.GetChatSystemPrompt(ctx, kbID, c.ID)
	if err != nil || p == nil || !strings.HasPrefix(*p, "Du bist ein geduldiger Tutor") {
		t.Fatalf("chat prompt = %v (%v)", p, err)
	}
	p, err = s.GetKBSystemPrompt(ctx, kbID)
	if err != nil || p == nil || !strings.HasPrefix(*p, "Du bist ein sachlicher Forschungsassistent") {
		t.Fatalf("KB prompt = %v (%v)", p, err)
	}
	if has, err := s.KBHasRole(ctx, kbID, "tutor"); err != nil || !has {
		t.Errorf("KBHasRole(tutor) = %v (%v)", has, err)
	}
}
