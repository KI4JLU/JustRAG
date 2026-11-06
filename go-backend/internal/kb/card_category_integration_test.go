//go:build integration

// Integration test for the home card's category: the catalog category the
// topic's title card shows. Requires a live main Postgres; skipped when DB_*
// env is unset.

package kb_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/justrag/go-backend/internal/kb"
)

// TestKBCards_Category pins which category a card shows.
//
// ORACLE: the fixture, worked out by hand from the rule „the first of the
// KB's categories by the taxonomy's order (sort_order, then name)":
// a KB linked to „Zweite" (sort 2) and „Erste" (sort 1, slot 3) shows
// „Erste"; a KB without a link has no category.
func TestKBCards_Category(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := insertUser(t, pool, "kbcards-category")

	newKB := func(name string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO knowledge_bases (name, user_id) VALUES ($1, $2::uuid)
			RETURNING id::text`, name, userID).Scan(&id); err != nil {
			t.Fatalf("insert kb %s: %v", name, err)
		}
		t.Cleanup(func() {
			pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, id) //nolint:errcheck
		})
		if _, err := pool.Exec(ctx,
			`INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')`, id, userID); err != nil {
			t.Fatalf("insert kb_members owner row: %v", err)
		}
		return id
	}
	newCategory := func(name string, sort, slot int) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO kb_categories (name, sort_order, color_slot) VALUES ($1, $2, $3)
			RETURNING id::text`, name+"-"+userID[:8], sort, slot).Scan(&id); err != nil {
			t.Fatalf("insert category %s: %v", name, err)
		}
		t.Cleanup(func() {
			pool.Exec(ctx, `DELETE FROM kb_categories WHERE id = $1::uuid`, id) //nolint:errcheck
		})
		return id
	}

	linked := newKB("kbcards-category-linked")
	plain := newKB("kbcards-category-plain")
	second := newCategory("Zweite", 2, 5)
	first := newCategory("Erste", 1, 3)
	for _, c := range []string{second, first} {
		if _, err := pool.Exec(ctx, `INSERT INTO kb_category_links (kb_id, category_id) VALUES ($1::uuid, $2::uuid)`, linked, c); err != nil {
			t.Fatalf("link category: %v", err)
		}
	}

	rows, err := kb.NewStore(pool).ListKnowledgeBases(ctx, userID, 100, 0)
	if err != nil {
		t.Fatalf("ListKnowledgeBases: %v", err)
	}
	got := map[string]json.RawMessage{}
	for _, r := range rows {
		got[r.ID] = r.Category
	}
	var cat struct {
		ID        string `json:"id"`
		ColorSlot int    `json:"colorSlot"`
	}
	if err := json.Unmarshal(got[linked], &cat); err != nil {
		t.Fatalf("linked KB category %s: %v", got[linked], err)
	}
	if cat.ID != first || cat.ColorSlot != 3 {
		t.Errorf("linked KB shows %+v, want the first category %s with slot 3", cat, first)
	}
	if got[plain] != nil {
		t.Errorf("KB without a category shows %s, want none", got[plain])
	}
}
