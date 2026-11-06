//go:build integration

package kb_test

import (
	"context"
	"testing"

	"github.com/justrag/go-backend/internal/adminkboverview"
	"github.com/justrag/go-backend/internal/kbaccess"
)

// Oracle: the definition of „shared" (developer ruling 2026-11-05) — a
// private KB is shared once somebody besides its owner is a member, and a
// system admin may operate its RAG settings only then (or on a global KB, or
// their own).
// Both readers of kbaccess.SharedSQL — the access lookup and the admin KB
// overview, which offers „RAG-Settings" — agree at every step.
func TestSharedKBIsOperable(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	kbID := insertBehaviorKB(t, pool, nil)
	owner := insertUser(t, pool, "it-operable-owner")
	member := insertUser(t, pool, "it-operable-member")
	addMember := func(userID, role string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1, $2, $3)`, kbID, userID, role); err != nil {
			t.Fatalf("add %s: %v", role, err)
		}
	}
	check := func(step string, want bool) {
		t.Helper()
		kb, err := kbaccess.NewStore(pool).GetKBByID(ctx, kbID)
		if err != nil || kb == nil {
			t.Fatalf("%s: load: %v", step, err)
		}
		if kb.Shared != want || kbaccess.SystemAdminMayOperate(kb, "") != want {
			t.Fatalf("%s: shared %v, operable %v, want %v", step, kb.Shared, kbaccess.SystemAdminMayOperate(kb, ""), want)
		}
		if !kbaccess.SystemAdminMayOperate(kb, kbaccess.RoleOwner) {
			t.Fatalf("%s: not operable by its owner", step)
		}
		rows, err := adminkboverview.NewStore(pool).ListKBs(ctx)
		if err != nil {
			t.Fatalf("%s: overview: %v", step, err)
		}
		for _, r := range rows {
			if r.ID == kbID {
				if r.Shared != want {
					t.Fatalf("%s: overview shared %v, want %v", step, r.Shared, want)
				}
				return
			}
		}
		t.Fatalf("%s: KB missing from the overview", step)
	}

	check("no members", false)
	addMember(owner, kbaccess.RoleOwner)
	check("owner only", false)
	addMember(member, kbaccess.RoleView)
	check("owner and a viewer", true)

	if _, err := pool.Exec(ctx, `DELETE FROM kb_members WHERE kb_id = $1 AND role <> 'owner'`, kbID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE knowledge_bases SET visibility = 'public' WHERE id = $1`, kbID); err != nil {
		t.Fatal(err)
	}
	kb, err := kbaccess.NewStore(pool).GetKBByID(ctx, kbID)
	if err != nil || kb.Shared || !kbaccess.SystemAdminMayOperate(kb, "") {
		t.Fatalf("global, owner only: shared %v, operable %v (%v)", kb.Shared, kbaccess.SystemAdminMayOperate(kb, ""), err)
	}
}
