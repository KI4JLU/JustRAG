//go:build integration

// Integration tests for the per-user topic filter columns (migration 0068)
// that the two KB list queries now join in: isFavourite and userCategoryIds.
//
// Oracle: the fixture rows, written by hand with raw SQL before the query
// runs. The test knows which user starred which KB and which category it
// tagged it with because it put those rows there; the assertion compares the
// query's answer against that, not against anything the query produced. The
// second user in each test is the part that matters — these columns are
// per-caller, and a query that dropped the user_id predicate would still look
// correct for a single-user fixture.

package kb_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/kb"
)

// insertUserCategory creates a category owned by userID and returns its id.
func insertUserCategory(t *testing.T, pool *pgxpool.Pool, userID, name string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO kb_user_categories (user_id, name) VALUES ($1::uuid, $2)
		RETURNING id::text`, userID, name).Scan(&id); err != nil {
		t.Fatalf("insert kb_user_categories %s: %v", name, err)
	}
	return id
}

// findRow returns the KB with id from a list result, or nil.
func findRow(list []kb.KBRow, id string) *kb.KBRow {
	for i := range list {
		if list[i].ID == id {
			return &list[i]
		}
	}
	return nil
}

// TestListKnowledgeBases_UserFilterColumnsArePerCaller pins the join on
// GET /api/kb. Two members of the same private KB: one starred and tagged it,
// the other did neither, and the same row must report different values for
// each of them.
func TestListKnowledgeBases_UserFilterColumnsArePerCaller(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kb.NewStore(pool)

	owner := insertUser(t, pool, "kbfilters-list-owner")
	member := insertUser(t, pool, "kbfilters-list-member")

	row, err := store.CreateKnowledgeBase(ctx, "kbfilters-list-kb", nil, owner, nil)
	if err != nil {
		t.Fatalf("CreateKnowledgeBase: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, row.ID) //nolint:errcheck
	})
	if _, err := pool.Exec(ctx,
		`INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'view')`,
		row.ID, member); err != nil {
		t.Fatalf("insert kb_members: %v", err)
	}

	// Fixture: only the owner stars and tags the KB.
	catID := insertUserCategory(t, pool, owner, "kbfilters-list-cat")
	if _, err := pool.Exec(ctx,
		`INSERT INTO kb_favourites (user_id, kb_id) VALUES ($1::uuid, $2::uuid)`,
		owner, row.ID); err != nil {
		t.Fatalf("insert kb_favourites: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO kb_user_category_links (user_id, category_id, kb_id)
		 VALUES ($1::uuid, $2::uuid, $3::uuid)`, owner, catID, row.ID); err != nil {
		t.Fatalf("insert kb_user_category_links: %v", err)
	}

	ownerList, err := store.ListKnowledgeBases(ctx, owner, 100, 0)
	if err != nil {
		t.Fatalf("ListKnowledgeBases(owner): %v", err)
	}
	got := findRow(ownerList, row.ID)
	if got == nil {
		t.Fatalf("the owner's own KB %s is missing from their list", row.ID)
	}
	if !got.IsFavourite {
		t.Error("isFavourite = false for the user who starred it, want true")
	}
	if len(got.UserCategoryIDs) != 1 || got.UserCategoryIDs[0] != catID {
		t.Errorf("userCategoryIds = %v, want [%s]", got.UserCategoryIDs, catID)
	}

	memberList, err := store.ListKnowledgeBases(ctx, member, 100, 0)
	if err != nil {
		t.Fatalf("ListKnowledgeBases(member): %v", err)
	}
	other := findRow(memberList, row.ID)
	if other == nil {
		t.Fatalf("the shared KB %s is missing from the second member's list", row.ID)
	}
	if other.IsFavourite {
		t.Error("isFavourite = true for a user who never starred it — the query lost its user_id predicate")
	}
	if len(other.UserCategoryIDs) != 0 {
		t.Errorf("userCategoryIds = %v, want empty — those are another user's categories", other.UserCategoryIDs)
	}
	// [] and not null: the frontend maps over the field directly.
	if other.UserCategoryIDs == nil {
		t.Error("userCategoryIds is nil, want an empty slice so the JSON is [] rather than null")
	}
}

// TestListGlobalKnowledgeBases_UserFilterColumns pins the same join on
// GET /api/kb/global, which is a different query with a different WHERE
// clause and its own SELECT list.
func TestListGlobalKnowledgeBases_UserFilterColumns(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kb.NewStore(pool)

	starrer := insertUser(t, pool, "kbfilters-global-starrer")
	bystander := insertUser(t, pool, "kbfilters-global-bystander")

	var kbID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO knowledge_bases (name, visibility, is_published, auto_subscribe)
		VALUES ('kbfilters-global-kb', 'public', true, true) RETURNING id::text`).Scan(&kbID); err != nil {
		t.Fatalf("insert public KB: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, kbID) //nolint:errcheck
	})

	catID := insertUserCategory(t, pool, starrer, "kbfilters-global-cat")
	if _, err := pool.Exec(ctx,
		`INSERT INTO kb_favourites (user_id, kb_id) VALUES ($1::uuid, $2::uuid)`,
		starrer, kbID); err != nil {
		t.Fatalf("insert kb_favourites: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO kb_user_category_links (user_id, category_id, kb_id)
		 VALUES ($1::uuid, $2::uuid, $3::uuid)`, starrer, catID, kbID); err != nil {
		t.Fatalf("insert kb_user_category_links: %v", err)
	}

	mine, err := store.ListGlobalKnowledgeBases(ctx, starrer, false)
	if err != nil {
		t.Fatalf("ListGlobalKnowledgeBases(starrer): %v", err)
	}
	got := findRow(mine, kbID)
	if got == nil {
		t.Fatalf("auto-subscribed public KB %s is missing from the overview", kbID)
	}
	if !got.IsFavourite {
		t.Error("isFavourite = false for the user who starred it, want true")
	}
	if len(got.UserCategoryIDs) != 1 || got.UserCategoryIDs[0] != catID {
		t.Errorf("userCategoryIds = %v, want [%s]", got.UserCategoryIDs, catID)
	}

	theirs, err := store.ListGlobalKnowledgeBases(ctx, bystander, false)
	if err != nil {
		t.Fatalf("ListGlobalKnowledgeBases(bystander): %v", err)
	}
	other := findRow(theirs, kbID)
	if other == nil {
		t.Fatalf("auto-subscribed public KB %s is missing from the bystander's overview", kbID)
	}
	if other.IsFavourite {
		t.Error("isFavourite = true for a user who never starred it")
	}
	if len(other.UserCategoryIDs) != 0 {
		t.Errorf("userCategoryIds = %v, want empty", other.UserCategoryIDs)
	}
}
