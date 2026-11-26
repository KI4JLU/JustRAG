//go:build integration

// Integration tests for the glossary store (migration 0109) against a live
// main Postgres; skipped when DB_* env is unset.

package translator_test

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/glossaryaccess"
	"github.com/justrag/go-backend/internal/translator"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	host, port, name := os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")
	if host == "" || port == "" || name == "" {
		t.Skip("glossary store tests require DB_* env (main Postgres)")
	}
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s",
		url.QueryEscape(os.Getenv("DB_USER")), url.QueryEscape(os.Getenv("DB_PASSWORD")), host, port, name)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func insertUser(t *testing.T, pool *pgxpool.Pool, username, first string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (username, password_hash, role, first_name, last_name)
		VALUES ($1, 'x-not-a-real-hash', 'user', $2, 'Tester') RETURNING id::text`, username, first).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", username, err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, id) }) //nolint:errcheck
	return id
}

func entry(src, tgt string) translator.GlossaryEntry {
	return translator.GlossaryEntry{SourceLanguage: "de", SourceTerm: src, TargetLanguage: "en", TargetTerm: tgt}
}

func TestGlossaryLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	s := translator.NewStore(pool)
	owner := insertUser(t, pool, "gs-owner", "Olga")
	other := insertUser(t, pool, "gs-other", "Otto")

	id, err := s.Create(ctx, owner, translator.GlossaryInput{
		Name: "Fachbegriffe", Description: "d", Category: "general", Visibility: glossaryaccess.VisibilityPrivate,
		Entries: []translator.GlossaryEntry{entry("Hochschule", "university"), entry("Mensa", "canteen")},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM glossaries WHERE id = $1::uuid`, id) }) //nolint:errcheck

	// The creator is the owner, in the same transaction.
	var role string
	if err := pool.QueryRow(ctx, `SELECT role FROM glossary_members WHERE glossary_id = $1::uuid AND user_id = $2::uuid`, id, owner).Scan(&role); err != nil || role != "owner" {
		t.Fatalf("owner row = %q, %v", role, err)
	}

	d, err := s.Get(ctx, id)
	if err != nil || d == nil || len(d.Entries) != 2 || d.EntryCount != 2 || d.CreatorName != "Olga Tester" || d.Entries[0].SourceTerm != "Hochschule" {
		t.Fatalf("Get = %+v %v", d, err)
	}

	// Private: the owner sees it with canDelete, a stranger does not.
	list, err := s.List(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	var mine *translator.GlossarySummary
	for i := range list {
		if list[i].ID == id {
			mine = &list[i]
		}
	}
	if mine == nil || mine.Role != "owner" || !mine.CanDelete || !mine.CanManage || !mine.CanEdit || mine.EntryCount != 2 || !mine.IsMember {
		t.Fatalf("owner's view = %+v", mine)
	}
	strangerList, _ := s.List(ctx, other)
	for _, g := range strangerList {
		if g.ID == id {
			t.Fatal("a private glossary must not be listed for a stranger")
		}
	}

	// Global: the stranger sees it as viewer, with no flags.
	before := d.UpdatedAt
	time.Sleep(10 * time.Millisecond)
	if err := s.SetVisibility(ctx, id, glossaryaccess.VisibilityGlobal); err != nil {
		t.Fatal(err)
	}
	d2, _ := s.Get(ctx, id)
	if !d2.UpdatedAt.Equal(before) {
		t.Error("sharing is not a change of content and must not bump updated_at")
	}
	strangerList, _ = s.List(ctx, other)
	var seen *translator.GlossarySummary
	for i := range strangerList {
		if strangerList[i].ID == id {
			seen = &strangerList[i]
		}
	}
	if seen == nil || seen.Role != "viewer" || seen.CanEdit || seen.CanManage || seen.CanDelete {
		t.Fatalf("stranger's view of a global glossary = %+v", seen)
	}
	// That viewer role comes from the visibility, not from a row: nothing to leave.
	if seen.IsMember {
		t.Errorf("a viewer through a global glossary has no membership row, isMember = %v", seen.IsMember)
	}
	// Once added, the same viewer holds a row.
	if _, err := pool.Exec(ctx, `INSERT INTO glossary_members (glossary_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'viewer')`, id, other); err != nil {
		t.Fatal(err)
	}
	strangerList, _ = s.List(ctx, other)
	seen = nil
	for i := range strangerList {
		if strangerList[i].ID == id {
			seen = &strangerList[i]
		}
	}
	if seen == nil || seen.Role != "viewer" || !seen.IsMember {
		t.Errorf("an added viewer = %+v, want role viewer and isMember", seen)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM glossary_members WHERE glossary_id = $1::uuid AND user_id = $2::uuid`, id, other); err != nil {
		t.Fatal(err)
	}

	// Update is a full replacement: it clears an empty description and category,
	// replaces the entries and bumps updated_at.
	if err := s.Update(ctx, id, translator.GlossaryInput{Name: "Neu", Entries: []translator.GlossaryEntry{entry("Bibliothek", "library")}}); err != nil {
		t.Fatal(err)
	}
	d3, _ := s.Get(ctx, id)
	if d3.Name != "Neu" || d3.Description != "" || d3.Category != "" || len(d3.Entries) != 1 || !d3.UpdatedAt.After(before) {
		t.Errorf("after Update = %+v (an empty description and category must be cleared)", d3)
	}
	// And it can set them again.
	if err := s.Update(ctx, id, translator.GlossaryInput{Name: "Neu", Description: "wieder", Category: "Recht", Entries: []translator.GlossaryEntry{entry("Bibliothek", "library")}}); err != nil {
		t.Fatal(err)
	}
	if d4, _ := s.Get(ctx, id); d4.Description != "wieder" || d4.Category != "Recht" {
		t.Errorf("after the second Update = %+v", d4)
	}

	// Readable: both callers read it (global); an unknown id makes the call fail.
	for _, who := range []string{owner, other} {
		data, err := s.ReadableGlossaries(ctx, who, []string{id})
		if err != nil || len(data) != 1 || data[0].Entries[0].SourceTerm != "Bibliothek" {
			t.Errorf("ReadableGlossaries(%s) = %+v %v", who, data, err)
		}
	}
	if _, err := s.ReadableGlossaries(ctx, other, []string{id, "3f2b8c1e-0b1d-4a55-9d3e-7c1a2b3c4dff"}); !errors.Is(err, translator.ErrGlossaryUnavailable) {
		t.Errorf("an unknown id: %v, want ErrGlossaryUnavailable", err)
	}
	// Back to private: the stranger can no longer read it.
	if err := s.SetVisibility(ctx, id, glossaryaccess.VisibilityPrivate); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadableGlossaries(ctx, other, []string{id}); !errors.Is(err, translator.ErrGlossaryUnavailable) {
		t.Errorf("a private glossary for a stranger: %v, want ErrGlossaryUnavailable", err)
	}

	if err := s.Delete(ctx, id); err != nil {
		t.Fatal(err)
	}
	if d, _ := s.Get(ctx, id); d != nil {
		t.Error("deleted glossary must be gone")
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM glossary_members WHERE glossary_id = $1::uuid`, id).Scan(&n)
	if n != 0 {
		t.Errorf("member rows must follow the glossary, %d left", n)
	}
	if err := s.Delete(ctx, id); err == nil {
		t.Error("deleting twice must report the missing row")
	}
}

func TestReadableGlossariesOldestFirst(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	s := translator.NewStore(pool)
	owner := insertUser(t, pool, "gs-order", "Ora")
	mk := func(name string) string {
		id, err := s.Create(ctx, owner, translator.GlossaryInput{Name: name, Category: "general", Visibility: "private", Entries: []translator.GlossaryEntry{entry(name, name)}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM glossaries WHERE id = $1::uuid`, id) }) //nolint:errcheck
		return id
	}
	a := mk("A")
	time.Sleep(10 * time.Millisecond)
	b := mk("B")
	time.Sleep(10 * time.Millisecond)
	// Editing A makes it the newer one.
	if err := s.Update(ctx, a, translator.GlossaryInput{Name: "A", Entries: []translator.GlossaryEntry{entry("A", "A2")}}); err != nil {
		t.Fatal(err)
	}
	data, err := s.ReadableGlossaries(ctx, owner, []string{a, b})
	if err != nil || len(data) != 2 || data[0].ID != b || data[1].ID != a {
		t.Errorf("order = %+v %v; want B (older) then A (edited later), so the newer wins", data, err)
	}
}
