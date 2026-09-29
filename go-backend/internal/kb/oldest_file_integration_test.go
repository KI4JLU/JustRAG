//go:build integration

// Integration tests for the oldest_file_at / newest_file_at card aggregates
// (migration 0071; newest added by KI-848).
// Requires a live main Postgres; skipped when DB_* env is unset.

package kb_test

import (
	"context"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/kb"
)

// TestKBCards_OldestFileAt pins that the card's corpus-age aggregate keys on
// the EFFECTIVE date. The KB below holds one file ingested five years ago
// whose publication date is last week, and one ingested last month with no
// publication date — so the oldest effective date is last month, not the
// five-year-old ingest timestamp.
//
// Mutation: swap MIN(COALESCE(published_at, created_at)) for MIN(created_at)
// in kbStatsJoins → the card reports the five-year-old date and this fails.
func TestKBCards_OldestFileAt(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := insertUser(t, pool, "kbcards-oldest")

	var kbID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO knowledge_bases (name, user_id) VALUES ('cards-oldest', $1::uuid)
		RETURNING id::text`, userID).Scan(&kbID); err != nil {
		t.Fatalf("insert kb: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, kbID) //nolint:errcheck
	})
	// ListKnowledgeBases selects on kb_members, which a raw INSERT does not
	// create — see TestListKnowledgeBases_TurnStatsFromUsageLedger.
	if _, err := pool.Exec(ctx,
		`INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')`,
		kbID, userID); err != nil {
		t.Fatalf("insert kb_members owner row: %v", err)
	}

	now := time.Now().UTC()
	ancientIngest := now.AddDate(-5, 0, 0)
	recentPublication := now.AddDate(0, 0, -7)
	monthOld := now.AddDate(0, -1, 0)

	seed := func(name string, created time.Time, published *time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO files (kb_id, name, type, status, storage_path, created_at, published_at)
			VALUES ($1::uuid, $2, 'text/markdown', 'completed', $3, $4, $5)`,
			kbID, name, "p/"+name, created, published); err != nil {
			t.Fatalf("seed file %s: %v", name, err)
		}
	}
	seed("republished.md", ancientIngest, &recentPublication)
	seed("plain.md", monthOld, nil)

	rows, err := kb.NewStore(pool).ListKnowledgeBases(ctx, userID, 50, 0)
	if err != nil {
		t.Fatalf("ListKnowledgeBases: %v", err)
	}
	var found *kb.KBRow
	for i := range rows {
		if rows[i].ID == kbID {
			found = &rows[i]
		}
	}
	if found == nil {
		t.Fatal("KB not returned")
	}
	if found.OldestFileAt == nil {
		t.Fatal("oldestFileAt must be set once the KB has files")
	}
	// Tolerance covers the timestamptz round trip; the assertion that matters
	// is "a month ago, not five years ago".
	if diff := found.OldestFileAt.UTC().Sub(monthOld); diff > time.Minute || diff < -time.Minute {
		t.Errorf("oldestFileAt = %v, want the month-old effective date %v", found.OldestFileAt.UTC(), monthOld)
	}
}

// TestKBCards_OldestAndNewestFileAt pins BOTH ends of the card's effective-
// date range (KI-848 adds newest_file_at for the card's „Aktualisiert" line).
//
// ORACLE: the fixture's dates, with MIN and MAX of the effective date
// (COALESCE(published_at, created_at)) worked out by hand below — not read
// back from the code under test.
//
//	a.md  created 2026-01-10, published —          → effective 2026-01-10
//	b.md  created 2020-01-01, published 2026-03-05 → effective 2026-03-05  (MAX)
//	c.md  created 2026-02-01, published 2025-12-24 → effective 2025-12-24  (MIN)
//
// Mutations: MAX(created_at) → 2026-02-01 (c's ingest); MIN(created_at) →
// 2020-01-01 (b's ingest); swapping MIN/MAX → the two swap. Each fails here.
// A KB with no files reports neither.
func TestKBCards_OldestAndNewestFileAt(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := insertUser(t, pool, "kbcards-range")

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
			`INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')`,
			id, userID); err != nil {
			t.Fatalf("insert kb_members owner row: %v", err)
		}
		return id
	}
	day := func(s string) time.Time {
		t.Helper()
		d, err := time.Parse("2006-01-02", s)
		if err != nil {
			t.Fatalf("parse %s: %v", s, err)
		}
		return d.UTC()
	}
	withFiles := newKB("cards-range")
	empty := newKB("cards-range-empty")

	seed := func(name string, created time.Time, published *time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO files (kb_id, name, type, status, storage_path, created_at, published_at)
			VALUES ($1::uuid, $2, 'text/markdown', 'completed', $3, $4, $5)`,
			withFiles, name, "p/"+name, created, published); err != nil {
			t.Fatalf("seed file %s: %v", name, err)
		}
	}
	pubB, pubC := day("2026-03-05"), day("2025-12-24")
	seed("a.md", day("2026-01-10"), nil)
	seed("b.md", day("2020-01-01"), &pubB)
	seed("c.md", day("2026-02-01"), &pubC)

	rows, err := kb.NewStore(pool).ListKnowledgeBases(ctx, userID, 50, 0)
	if err != nil {
		t.Fatalf("ListKnowledgeBases: %v", err)
	}
	byID := map[string]*kb.KBRow{}
	for i := range rows {
		byID[rows[i].ID] = &rows[i]
	}

	got := byID[withFiles]
	if got == nil {
		t.Fatal("KB with files not returned")
	}
	if got.OldestFileAt == nil || !got.OldestFileAt.UTC().Equal(day("2025-12-24")) {
		t.Errorf("oldestFileAt = %v, want 2025-12-24 (c.md's publication date)", got.OldestFileAt)
	}
	if got.NewestFileAt == nil || !got.NewestFileAt.UTC().Equal(day("2026-03-05")) {
		t.Errorf("newestFileAt = %v, want 2026-03-05 (b.md's publication date)", got.NewestFileAt)
	}

	none := byID[empty]
	if none == nil {
		t.Fatal("empty KB not returned")
	}
	if none.OldestFileAt != nil || none.NewestFileAt != nil {
		t.Errorf("empty KB: oldest=%v newest=%v, want both nil", none.OldestFileAt, none.NewestFileAt)
	}
}
