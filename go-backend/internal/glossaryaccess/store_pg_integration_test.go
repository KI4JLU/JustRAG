//go:build integration

// Parity test for the glossary access ladder: VisibleGlossariesCTE (SQL) and
// EffectiveRole (Go), fed by PGStore.GetGlossary and GetMemberRole exactly as
// RequireGlossaryRole feeds it, must agree for every (caller, glossary) pair
// of a fixture covering every rung. Requires a live main Postgres; skipped
// when DB_* env is unset.

package glossaryaccess_test

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/glossaryaccess"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	host, port, name := os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")
	if host == "" || port == "" || name == "" {
		t.Skip("glossary access tests require DB_* env (main Postgres)")
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

func insertUser(t *testing.T, pool *pgxpool.Pool, username string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO users (username, password_hash, role) VALUES ($1, 'x-not-a-real-hash', 'user')
		RETURNING id::text`, username).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", username, err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, id) }) //nolint:errcheck
	return id
}

func insertGlossary(t *testing.T, pool *pgxpool.Pool, visibility string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO glossaries (name, visibility) VALUES ('access-test', $1) RETURNING id::text`, visibility).Scan(&id); err != nil {
		t.Fatalf("insert glossary: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM glossaries WHERE id = $1::uuid`, id) }) //nolint:errcheck
	return id
}

func addMember(t *testing.T, pool *pgxpool.Pool, glossaryID, userID, role string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO glossary_members (glossary_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)`,
		glossaryID, userID, role); err != nil {
		t.Fatalf("add member: %v", err)
	}
}

// TestVisibleGlossariesAgreesWithEffectiveRole is the parity test named in
// the keep-in-sync notes of EffectiveRole and VisibleGlossariesCTE. Its oracle
// is the real EffectiveRole, not a hand-written table.
func TestVisibleGlossariesAgreesWithEffectiveRole(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := glossaryaccess.NewStore(pool)

	glossaries := map[string]string{
		"private": insertGlossary(t, pool, glossaryaccess.VisibilityPrivate),
		"global":  insertGlossary(t, pool, glossaryaccess.VisibilityGlobal),
	}
	callers := map[string]string{}
	for _, name := range []string{"stranger", glossaryaccess.RoleViewer, glossaryaccess.RoleEditor, glossaryaccess.RoleAdmin, glossaryaccess.RoleOwner} {
		callers[name] = insertUser(t, pool, "gaccess-"+name)
	}
	// Every member role on both glossaries; "stranger" has no row anywhere.
	// The owner row is unique per glossary, so the owner fixture holds it.
	for _, gid := range glossaries {
		for _, role := range []string{glossaryaccess.RoleViewer, glossaryaccess.RoleEditor, glossaryaccess.RoleAdmin, glossaryaccess.RoleOwner} {
			addMember(t, pool, gid, callers[role], role)
		}
	}

	for gname, gid := range glossaries {
		for cname, uid := range callers {
			g, err := store.GetGlossary(ctx, gid)
			if err != nil || g == nil {
				t.Fatalf("GetGlossary: %v %v", g, err)
			}
			member, err := store.GetMemberRole(ctx, gid, uid)
			if err != nil {
				t.Fatalf("GetMemberRole: %v", err)
			}
			want := glossaryaccess.EffectiveRole(g, member)

			var got *string
			err = pool.QueryRow(ctx, `WITH `+glossaryaccess.VisibleGlossariesCTE+`
				SELECT role FROM visible_glossaries WHERE id = $2::uuid`, uid, gid).Scan(&got)
			if err != nil {
				t.Fatalf("CTE (%s on %s): %v", cname, gname, err)
			}
			gotRole := ""
			if got != nil {
				gotRole = *got
			}
			if gotRole != want {
				t.Errorf("%s on %s glossary: SQL mirror says %q, EffectiveRole says %q", cname, gname, gotRole, want)
			}
			// The expectations written down, so a ladder that drifts on both
			// sides at once is still caught.
			switch {
			case cname == "stranger" && gname == "private" && want != "":
				t.Errorf("a stranger must not open a private glossary, got %q", want)
			case cname == "stranger" && gname == "global" && want != glossaryaccess.RoleViewer:
				t.Errorf("a stranger reads a global glossary as viewer, got %q", want)
			case cname != "stranger" && want != cname:
				t.Errorf("an explicit %s row must win on a %s glossary, got %q", cname, gname, want)
			}
		}
	}
}
