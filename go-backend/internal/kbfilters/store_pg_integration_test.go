//go:build integration

// Integration tests for migration 0068 and the kbfilters store.
//
// Oracle: PostgreSQL's own constraint machinery. Every assertion in the
// "constraints" half below is made against a RAW statement executed straight
// on the pool, with none of the code under test in the path — the test states
// what the schema must refuse, and Postgres is the thing that refuses it.
// That is the whole point of putting the cross-user rule in a composite
// foreign key instead of a handler guard: a guard can only be proven by
// re-running the guard, while a constraint can be proven by trying to break
// it. The store-level assertions that follow each raw one show that kbfilters
// translates that same rejection into ErrNotFound / ErrDuplicateName rather
// than a 500.
//
// Require a live main Postgres; skipped when DB_* env is unset. Pool/skip
// pattern follows internal/kbsubs/store_pg_integration_test.go.

package kbfilters_test

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/kbfilters"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	host, port, name := os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")
	if host == "" || port == "" || name == "" {
		t.Skip("kbfilters tests require DB_* env (main Postgres)")
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

func insertTestUser(t *testing.T, pool *pgxpool.Pool, username string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'x-not-a-real-hash', 'user') RETURNING id::text`, username).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", username, err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, id) }) //nolint:errcheck
	return id
}

func insertTestKB(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO knowledge_bases (name, visibility) VALUES ($1, 'private')
		RETURNING id::text`, name).Scan(&id); err != nil {
		t.Fatalf("insert kb %s: %v", name, err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, id) }) //nolint:errcheck
	return id
}

// sqlState returns the SQLSTATE of a Postgres error, or "" for anything else.
func sqlState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func countRows(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

// ---------------------------------------------------------------------------
// The constraints themselves
// ---------------------------------------------------------------------------

// TestCompositeFKRejectsACrossUserLink is the reason the link table carries a
// redundant user_id. The first half writes the offending row directly, with
// no kbfilters code in the path at all: the composite FK (category_id,
// user_id) -> kb_user_categories (id, user_id) must refuse it, so a
// cross-user assignment is not merely unreachable through the handler but
// unrepresentable in the database. The second half then shows the store
// surfacing exactly that rejection as ErrNotFound.
func TestCompositeFKRejectsACrossUserLink(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbfilters.NewStore(pool)

	owner := insertTestUser(t, pool, "kbfilters-fk-owner")
	intruder := insertTestUser(t, pool, "kbfilters-fk-intruder")
	kbID := insertTestKB(t, pool, "kbfilters-fk-kb")

	cat, err := store.CreateCategory(ctx, owner, "kbfilters-fk-cat", 0)
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}

	// Raw write, no store: the schema is the thing under test here.
	_, rawErr := pool.Exec(ctx, `
		INSERT INTO kb_user_category_links (user_id, category_id, kb_id)
		VALUES ($1::uuid, $2::uuid, $3::uuid)`, intruder, cat.ID, kbID)
	if rawErr == nil {
		t.Fatal("the database accepted a link to another user's category; " +
			"the composite FK is missing or does not cover (category_id, user_id)")
	}
	if got := sqlState(rawErr); got != "23503" {
		t.Fatalf("SQLSTATE = %q (%v), want 23503 foreign_key_violation", got, rawErr)
	}

	// Same attempt through the store: the rejection becomes ErrNotFound, which
	// the handler answers as 404.
	if err := store.AssignCategory(ctx, intruder, cat.ID, kbID); !errors.Is(err, kbfilters.ErrNotFound) {
		t.Fatalf("AssignCategory(intruder) = %v, want ErrNotFound", err)
	}

	// And the owner's own assignment still works, so the FK is not simply
	// rejecting everything.
	if err := store.AssignCategory(ctx, owner, cat.ID, kbID); err != nil {
		t.Fatalf("AssignCategory(owner): %v", err)
	}
	if n := countRows(t, pool,
		`SELECT COUNT(*)::int FROM kb_user_category_links WHERE category_id = $1::uuid`,
		cat.ID); n != 1 {
		t.Fatalf("link rows = %d, want exactly the owner's one", n)
	}
}

// TestCategoryNameIsUniquePerUserCaseInsensitively pins the unique index. Two
// chips reading "Studium" and "studium" are indistinguishable in the filter
// row, so the second is a mistake — but only within one user: two different
// people naming their own category the same thing is the normal case, and a
// globally unique name would make the first one to pick "Studium" the owner
// of the word.
func TestCategoryNameIsUniquePerUserCaseInsensitively(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbfilters.NewStore(pool)

	userA := insertTestUser(t, pool, "kbfilters-uniq-a")
	userB := insertTestUser(t, pool, "kbfilters-uniq-b")

	if _, err := store.CreateCategory(ctx, userA, "kbfilters-Uniq-Studium", 0); err != nil {
		t.Fatalf("CreateCategory(A): %v", err)
	}

	// Raw write with a different case, no store: the index is under test.
	_, rawErr := pool.Exec(ctx, `
		INSERT INTO kb_user_categories (user_id, name) VALUES ($1::uuid, $2)`,
		userA, "kbfilters-uniq-studium")
	if got := sqlState(rawErr); got != "23505" {
		t.Fatalf("SQLSTATE = %q (%v), want 23505 unique_violation for a case-variant duplicate", got, rawErr)
	}

	// Through the store it becomes ErrDuplicateName -> 409.
	if _, err := store.CreateCategory(ctx, userA, "KBFILTERS-UNIQ-STUDIUM", 0); !errors.Is(err, kbfilters.ErrDuplicateName) {
		t.Fatalf("CreateCategory(A, case variant) = %v, want ErrDuplicateName", err)
	}

	// The very same name for another user must be accepted.
	if _, err := store.CreateCategory(ctx, userB, "kbfilters-Uniq-Studium", 0); err != nil {
		t.Fatalf("CreateCategory(B, same name) = %v, want success — uniqueness is per user", err)
	}
}

// TestDeletingACategoryCascadesItsLinks: a removed chip must stop filtering,
// not block the delete, and must leave no orphan assignment behind. The
// cascade rides the composite FK, so this also pins that the FK carries
// ON DELETE CASCADE.
func TestDeletingACategoryCascadesItsLinks(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbfilters.NewStore(pool)

	user := insertTestUser(t, pool, "kbfilters-cascade-user")
	kbID := insertTestKB(t, pool, "kbfilters-cascade-kb")

	cat, err := store.CreateCategory(ctx, user, "kbfilters-cascade-cat", 0)
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	if err := store.AssignCategory(ctx, user, cat.ID, kbID); err != nil {
		t.Fatalf("AssignCategory: %v", err)
	}
	if err := store.DeleteCategory(ctx, user, cat.ID); err != nil {
		t.Fatalf("DeleteCategory: %v", err)
	}
	if n := countRows(t, pool,
		`SELECT COUNT(*)::int FROM kb_user_category_links WHERE category_id = $1::uuid`,
		cat.ID); n != 0 {
		t.Fatalf("orphan link rows = %d, want 0", n)
	}
}

// TestDeletingAKBCascadesFavouritesAndLinks: neither table may keep a
// dangling reference to a deleted topic — a stale favourite would be a chip
// filtering for something that no longer exists.
func TestDeletingAKBCascadesFavouritesAndLinks(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbfilters.NewStore(pool)

	user := insertTestUser(t, pool, "kbfilters-kbdel-user")
	kbID := insertTestKB(t, pool, "kbfilters-kbdel-kb")

	cat, err := store.CreateCategory(ctx, user, "kbfilters-kbdel-cat", 0)
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	if err := store.AddFavourite(ctx, user, kbID); err != nil {
		t.Fatalf("AddFavourite: %v", err)
	}
	if err := store.AssignCategory(ctx, user, cat.ID, kbID); err != nil {
		t.Fatalf("AssignCategory: %v", err)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, kbID); err != nil {
		t.Fatalf("delete KB: %v", err)
	}
	if n := countRows(t, pool,
		`SELECT COUNT(*)::int FROM kb_favourites WHERE kb_id = $1::uuid`, kbID); n != 0 {
		t.Errorf("favourite rows after KB delete = %d, want 0", n)
	}
	if n := countRows(t, pool,
		`SELECT COUNT(*)::int FROM kb_user_category_links WHERE kb_id = $1::uuid`, kbID); n != 0 {
		t.Errorf("link rows after KB delete = %d, want 0", n)
	}
}

// TestDeletingAUserCascadesTheirFilters: the filters are personal state and
// must not outlive their owner.
func TestDeletingAUserCascadesTheirFilters(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbfilters.NewStore(pool)

	user := insertTestUser(t, pool, "kbfilters-userdel-user")
	kbID := insertTestKB(t, pool, "kbfilters-userdel-kb")

	cat, err := store.CreateCategory(ctx, user, "kbfilters-userdel-cat", 0)
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	if err := store.AddFavourite(ctx, user, kbID); err != nil {
		t.Fatalf("AddFavourite: %v", err)
	}
	if err := store.AssignCategory(ctx, user, cat.ID, kbID); err != nil {
		t.Fatalf("AssignCategory: %v", err)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, user); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	for _, q := range []struct {
		what string
		sql  string
	}{
		{"kb_favourites", `SELECT COUNT(*)::int FROM kb_favourites WHERE user_id = $1::uuid`},
		{"kb_user_categories", `SELECT COUNT(*)::int FROM kb_user_categories WHERE user_id = $1::uuid`},
		{"kb_user_category_links", `SELECT COUNT(*)::int FROM kb_user_category_links WHERE user_id = $1::uuid`},
	} {
		if n := countRows(t, pool, q.sql, user); n != 0 {
			t.Errorf("%s rows after user delete = %d, want 0", q.what, n)
		}
	}
}

// ---------------------------------------------------------------------------
// The store's own contract
// ---------------------------------------------------------------------------

// TestFavouriteIsIdempotentAndPerUser: the row's existence is the flag, so
// PUT twice must not be an error and DELETE of an absent row must not be
// either — the client is declaring a state, not a transition. And one user's
// star must be invisible to another.
func TestFavouriteIsIdempotentAndPerUser(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbfilters.NewStore(pool)

	userA := insertTestUser(t, pool, "kbfilters-fav-a")
	userB := insertTestUser(t, pool, "kbfilters-fav-b")
	kbID := insertTestKB(t, pool, "kbfilters-fav-kb")

	if err := store.AddFavourite(ctx, userA, kbID); err != nil {
		t.Fatalf("AddFavourite: %v", err)
	}
	if err := store.AddFavourite(ctx, userA, kbID); err != nil {
		t.Fatalf("AddFavourite twice: %v", err)
	}
	if n := countRows(t, pool,
		`SELECT COUNT(*)::int FROM kb_favourites WHERE kb_id = $1::uuid`, kbID); n != 1 {
		t.Fatalf("favourite rows = %d, want 1 after two PUTs", n)
	}
	if n := countRows(t, pool,
		`SELECT COUNT(*)::int FROM kb_favourites WHERE kb_id = $1::uuid AND user_id = $2::uuid`,
		kbID, userB); n != 0 {
		t.Errorf("user B has %d favourite rows for a KB only user A starred, want 0", n)
	}

	if err := store.RemoveFavourite(ctx, userB, kbID); err != nil {
		t.Fatalf("RemoveFavourite of an absent row: %v, want nil", err)
	}
	if n := countRows(t, pool,
		`SELECT COUNT(*)::int FROM kb_favourites WHERE kb_id = $1::uuid`, kbID); n != 1 {
		t.Fatalf("favourite rows = %d after B's no-op delete, want A's 1 untouched", n)
	}

	if err := store.RemoveFavourite(ctx, userA, kbID); err != nil {
		t.Fatalf("RemoveFavourite: %v", err)
	}
	if n := countRows(t, pool,
		`SELECT COUNT(*)::int FROM kb_favourites WHERE kb_id = $1::uuid`, kbID); n != 0 {
		t.Fatalf("favourite rows = %d after A's delete, want 0", n)
	}
}

// TestAnotherUsersCategoryIsInvisible: list must not show it, and update and
// delete must report it missing rather than 403 — the store never
// distinguishes "does not exist" from "not yours", so a probe cannot use the
// status code to learn that a category id exists.
func TestAnotherUsersCategoryIsInvisible(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbfilters.NewStore(pool)

	owner := insertTestUser(t, pool, "kbfilters-vis-owner")
	other := insertTestUser(t, pool, "kbfilters-vis-other")

	cat, err := store.CreateCategory(ctx, owner, "kbfilters-vis-cat", 0)
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}

	list, err := store.ListCategories(ctx, other)
	if err != nil {
		t.Fatalf("ListCategories(other): %v", err)
	}
	for _, c := range list {
		if c.ID == cat.ID {
			t.Fatalf("another user's category %s leaked into ListCategories", cat.ID)
		}
	}

	if _, err := store.UpdateCategory(ctx, other, cat.ID, "hijacked", 0); !errors.Is(err, kbfilters.ErrNotFound) {
		t.Errorf("UpdateCategory(other) = %v, want ErrNotFound", err)
	}
	if err := store.DeleteCategory(ctx, other, cat.ID); !errors.Is(err, kbfilters.ErrNotFound) {
		t.Errorf("DeleteCategory(other) = %v, want ErrNotFound", err)
	}

	// The owner's row survived both attempts.
	ownerList, err := store.ListCategories(ctx, owner)
	if err != nil {
		t.Fatalf("ListCategories(owner): %v", err)
	}
	var found bool
	for _, c := range ownerList {
		if c.ID == cat.ID {
			found = true
			if c.Name != "kbfilters-vis-cat" {
				t.Errorf("name = %q, want it unchanged", c.Name)
			}
		}
	}
	if !found {
		t.Error("the owner's category is gone after another user's failed attempts")
	}
}

// TestAssignCategoryIsIdempotentAndUnassignIsANoOpWhenAbsent mirrors the
// favourite contract: PUT and DELETE declare a state.
func TestAssignCategoryIsIdempotentAndUnassignIsANoOpWhenAbsent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbfilters.NewStore(pool)

	user := insertTestUser(t, pool, "kbfilters-assign-user")
	kbID := insertTestKB(t, pool, "kbfilters-assign-kb")
	cat, err := store.CreateCategory(ctx, user, "kbfilters-assign-cat", 0)
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}

	if err := store.UnassignCategory(ctx, user, cat.ID, kbID); err != nil {
		t.Fatalf("UnassignCategory before any assignment: %v, want nil", err)
	}
	for i := 0; i < 2; i++ {
		if err := store.AssignCategory(ctx, user, cat.ID, kbID); err != nil {
			t.Fatalf("AssignCategory #%d: %v", i+1, err)
		}
	}
	if n := countRows(t, pool, `
		SELECT COUNT(*)::int FROM kb_user_category_links
		WHERE user_id = $1::uuid AND category_id = $2::uuid AND kb_id = $3::uuid`,
		user, cat.ID, kbID); n != 1 {
		t.Fatalf("link rows = %d, want 1 after two PUTs", n)
	}
	if err := store.UnassignCategory(ctx, user, cat.ID, kbID); err != nil {
		t.Fatalf("UnassignCategory: %v", err)
	}
	if n := countRows(t, pool, `
		SELECT COUNT(*)::int FROM kb_user_category_links WHERE kb_id = $1::uuid`, kbID); n != 0 {
		t.Fatalf("link rows = %d after the delete, want 0", n)
	}
}

// TestAssignToAMissingCategoryIsNotFound: an id that never existed and an id
// that belongs to somebody else are the same answer, by construction — both
// hit the same composite FK.
func TestAssignToAMissingCategoryIsNotFound(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbfilters.NewStore(pool)

	user := insertTestUser(t, pool, "kbfilters-missing-user")
	kbID := insertTestKB(t, pool, "kbfilters-missing-kb")

	err := store.AssignCategory(ctx, user, "00000000-0000-0000-0000-000000000000", kbID)
	if !errors.Is(err, kbfilters.ErrNotFound) {
		t.Fatalf("AssignCategory(nonexistent category) = %v, want ErrNotFound", err)
	}
}
