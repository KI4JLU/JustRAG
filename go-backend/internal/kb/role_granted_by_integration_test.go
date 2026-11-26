//go:build integration

package kb_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/justrag/go-backend/internal/kb"
)

// roleGrantedBy names whoever added the caller's kb_members row, and is
// absent on the creator's own owner row; it carries the granter's own role.
// Oracle: the column comment on kbMembershipCols — kb_members.created_by
// when it is somebody else, with their kb_members role.
func TestGetKnowledgeBase_RoleGrantedBy(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	owner := insertUser(t, pool, "kb-granted-owner")
	viewer := insertUser(t, pool, "kb-granted-viewer")
	store := kb.NewStore(pool)

	row, err := store.CreateKnowledgeBase(ctx, "kb-granted-by", nil, owner, nil)
	if err != nil {
		t.Fatalf("CreateKnowledgeBase: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM knowledge_bases WHERE id = $1::uuid`, row.ID) //nolint:errcheck
	})
	if _, err := pool.Exec(ctx, `INSERT INTO kb_members (kb_id, user_id, role, created_by) VALUES ($1::uuid, $2::uuid, 'view', $3::uuid)`,
		row.ID, viewer, owner); err != nil {
		t.Fatalf("insert member: %v", err)
	}

	got, err := store.GetKnowledgeBase(ctx, row.ID, viewer)
	if err != nil || got == nil {
		t.Fatalf("GetKnowledgeBase(viewer): %v, %v", got, err)
	}
	var by struct{ Username, Role string }
	if err := json.Unmarshal(got.RoleGrantedBy, &by); err != nil || by.Username != "kb-granted-owner" || by.Role != "owner" {
		t.Errorf("viewer roleGrantedBy = %s (%v), want the owner", got.RoleGrantedBy, err)
	}

	own, err := store.GetKnowledgeBase(ctx, row.ID, owner)
	if err != nil || own == nil {
		t.Fatalf("GetKnowledgeBase(owner): %v, %v", own, err)
	}
	if own.RoleGrantedBy != nil {
		t.Errorf("owner roleGrantedBy = %s, want absent", own.RoleGrantedBy)
	}
}
