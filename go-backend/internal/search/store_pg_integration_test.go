//go:build integration

// Integration tests for the search store.
//
// The central test, TestVisibilityAgreesWithEffectiveRole, is the proof the
// card asks for: the SQL predicate (visibleKBsCTE) and kbaccess.EffectiveRole
// run over the SAME fixture matrix and must agree on every (caller, topic)
// pair — on visibility and on the role.
//
// Oracle: the production access path of every KB-scoped route, i.e. what
// kbaccess.Middleware.RequireKBRole does — kbaccess.PGStore.GetKBByID plus
// GetKBRole feeding kbaccess.EffectiveRole. It is independent of the code
// under test: it is a different package's Go ladder, reviewed on its own
// cards, reading the rows through its own queries. No expected value in this
// file comes from the search queries themselves; the only thing search
// contributes is the observation being checked.
//
// The remaining tests pin the matching semantics (LIKE escaping, case
// folding, snippet, order, limit) against literal expectations written from
// the card and the doc comments in store_pg.go, not from query output.
//
// Require a live main Postgres; skipped when DB_* env is unset. Pool/skip
// pattern follows internal/kbfilters/store_pg_integration_test.go. Every row
// is created with a per-run random marker and removed in t.Cleanup, so the
// suite neither depends on nor disturbs other data in the database.

package search_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/auth"
	"github.com/justrag/go-backend/internal/kbaccess"
	"github.com/justrag/go-backend/internal/search"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	host, port, name := os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")
	if host == "" || port == "" || name == "" {
		t.Skip("search tests require DB_* env (main Postgres)")
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

// marker returns a per-run token that no other row in the database contains.
// Hex only: no LIKE metacharacters, so it matches itself literally.
func marker(t *testing.T) string {
	t.Helper()
	b := make([]byte, 5)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return "srch" + hex.EncodeToString(b)
}

func insertUser(t *testing.T, pool *pgxpool.Pool, username, sysRole string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'x-not-a-real-hash', $2) RETURNING id::text`, username, sysRole).Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", username, err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, id) }) //nolint:errcheck
	return id
}

type kbSpec struct {
	name        string
	visibility  string
	published   bool
	description string
	headerText  string
}

func insertKB(t *testing.T, pool *pgxpool.Pool, s kbSpec) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO knowledge_bases (name, visibility, is_published, description, header_text)
		VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, '')) RETURNING id::text`,
		s.name, s.visibility, s.published, s.description, s.headerText).Scan(&id); err != nil {
		t.Fatalf("insert kb %s: %v", s.name, err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, id) }) //nolint:errcheck
	return id
}

func insertMember(t *testing.T, pool *pgxpool.Pool, kbID, userID, role string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)`,
		kbID, userID, role); err != nil {
		t.Fatalf("insert member %s on %s: %v", role, kbID, err)
	}
}

// insertFile adds a files row; it is removed by the knowledge_bases cascade.
func insertFile(t *testing.T, pool *pgxpool.Pool, kbID, name string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO files (kb_id, name, type, status) VALUES ($1::uuid, $2, 'pdf', 'completed')
		RETURNING id::text`, kbID, name).Scan(&id); err != nil {
		t.Fatalf("insert file %s: %v", name, err)
	}
	return id
}

// ---------------------------------------------------------------------------
// The oracle test
// ---------------------------------------------------------------------------

type matrixKB struct {
	id, fileID, key string
	visibility      string
}

type matrixCaller struct {
	caller search.Caller
	label  string
}

// ladderRule names the EffectiveRole rule a (caller, KB) pair falls under. It
// is used ONLY to prove the matrix covers every rule — never to compute an
// expected value; expected values come from kbaccess alone.
func ladderRule(kb *kbaccess.KnowledgeBase, sysRole, memberRole string) string {
	switch {
	case sysRole == auth.RoleSuperAdmin:
		return "1 superadmin"
	case kbaccess.Valid(memberRole):
		return "2 member " + memberRole
	case kb.IsGlobal && sysRole == auth.RoleAdmin:
		return "3 public+sysadmin"
	case kb.IsGlobal && kb.IsPublished:
		return "4 public+published"
	default:
		return "5 invisible"
	}
}

// TestVisibilityAgreesWithEffectiveRole builds, for each of four callers (one
// per system role), 20 topics: {private, public} x {published, staged} x
// {no row, view, edit, admin, owner} on that caller. Every caller is then
// checked against all 80 topics, so each also sees the 60 topics on which it
// has no row but somebody else does (owner included). That is 320 pairs, each
// asserted twice: once through an unscoped search that can only match that
// one topic, once through a kb_id-scoped search.
func TestVisibilityAgreesWithEffectiveRole(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := search.NewStore(pool)
	access := kbaccess.NewStore(pool)
	m := marker(t)

	sysRoles := []string{auth.RoleUser, auth.RoleAPIUser, auth.RoleAdmin, auth.RoleSuperAdmin}
	memberRoles := []string{"", kbaccess.RoleView, kbaccess.RoleEdit, kbaccess.RoleAdmin, kbaccess.RoleOwner}

	var callers []matrixCaller
	var kbs []matrixKB
	n := 0
	for _, sysRole := range sysRoles {
		uid := insertUser(t, pool, fmt.Sprintf("%s-%s", m, sysRole), sysRole)
		callers = append(callers, matrixCaller{
			caller: search.Caller{UserID: uid, SysRole: sysRole},
			label:  sysRole,
		})
		for _, vis := range []string{"private", "public"} {
			for _, published := range []bool{true, false} {
				for _, mr := range memberRoles {
					n++
					// Zero-padded and hyphen-terminated, so the key of k001
					// is not a substring of k0010's.
					key := fmt.Sprintf("%s-k%03d-", m, n)
					id := insertKB(t, pool, kbSpec{name: key + "topic", visibility: vis, published: published})
					if mr != "" {
						insertMember(t, pool, id, uid, mr)
					}
					kbs = append(kbs, matrixKB{
						id: id, key: key, visibility: vis,
						fileID: insertFile(t, pool, id, key+"file.pdf"),
					})
				}
			}
		}
	}

	coverage := map[string]int{}
	visible := 0
	for _, c := range callers {
		for _, k := range kbs {
			// --- oracle: the RequireKBRole path, verbatim ---
			kb, err := access.GetKBByID(ctx, k.id)
			if err != nil || kb == nil {
				t.Fatalf("oracle GetKBByID(%s): %v, %v", k.id, kb, err)
			}
			memberRole, err := access.GetKBRole(ctx, k.id, c.caller.UserID)
			if err != nil {
				t.Fatalf("oracle GetKBRole: %v", err)
			}
			want := kbaccess.EffectiveRole(kb, c.caller.SysRole, memberRole)
			coverage[ladderRule(kb, c.caller.SysRole, memberRole)]++
			if want != "" {
				visible++
			}

			pair := fmt.Sprintf("caller=%s kb=%s (public=%v published=%v member=%q) want role %q",
				c.label, k.key, kb.IsGlobal, kb.IsPublished, memberRole, want)

			// --- unscoped: the key matches exactly this one topic and file ---
			got, err := store.Search(ctx, c.caller, search.Query{Text: k.key, Limit: search.MaxLimit})
			if err != nil {
				t.Fatalf("%s: unscoped Search: %v", pair, err)
			}
			assertAgreement(t, pair+" [unscoped]", got, k, want)

			// --- scoped to the topic itself, with a query matching every
			// fixture row: only the scope can narrow it down ---
			got, err = store.Search(ctx, c.caller, search.Query{Text: m, KBID: k.id, Limit: search.MaxLimit})
			if want == "" {
				if !errors.Is(err, search.ErrNotFound) {
					t.Errorf("%s [scoped]: err = %v, want ErrNotFound", pair, err)
				}
				continue
			}
			if err != nil {
				t.Fatalf("%s [scoped]: Search: %v", pair, err)
			}
			assertAgreement(t, pair+" [scoped]", got, k, want)
			if got.KBID == nil || *got.KBID != k.id {
				t.Errorf("%s [scoped]: response kbId = %v, want %s", pair, got.KBID, k.id)
			}
		}
	}

	// The matrix must not be vacuous: every rung of the ladder, and each
	// membership role under rule 2, has to have been exercised.
	for _, rule := range []string{
		"1 superadmin",
		"2 member view", "2 member edit", "2 member admin", "2 member owner",
		"3 public+sysadmin", "4 public+published", "5 invisible",
	} {
		if coverage[rule] == 0 {
			t.Errorf("fixture matrix never exercised ladder rule %q", rule)
		}
	}
	t.Logf("pairs=%d visible=%d invisible=%d coverage=%v",
		len(callers)*len(kbs), visible, len(callers)*len(kbs)-visible, coverage)
}

// assertAgreement checks one search response against the oracle's verdict for
// one fixture topic: invisible -> no hit in any group; visible -> exactly that
// topic, carrying exactly the oracle's role, and exactly its file.
func assertAgreement(t *testing.T, pair string, got *search.Response, k matrixKB, want string) {
	t.Helper()
	if want == "" {
		if len(got.Topics) != 0 || len(got.Sources) != 0 {
			t.Errorf("%s: invisible topic leaked: topics=%+v sources=%+v", pair, got.Topics, got.Sources)
		}
		return
	}
	if len(got.Topics) != 1 || got.Topics[0].ID != k.id {
		t.Errorf("%s: topics = %+v, want exactly %s", pair, got.Topics, k.id)
		return
	}
	if got.Topics[0].Role != want {
		t.Errorf("%s: SQL role %q disagrees with EffectiveRole %q", pair, got.Topics[0].Role, want)
	}
	if got.Topics[0].Visibility != k.visibility {
		t.Errorf("%s: visibility = %q, want %q", pair, got.Topics[0].Visibility, k.visibility)
	}
	if len(got.Sources) != 1 || got.Sources[0].ID != k.fileID || got.Sources[0].KBID != k.id {
		t.Errorf("%s: sources = %+v, want exactly file %s in %s", pair, got.Sources, k.fileID, k.id)
		return
	}
	if want := k.key + "topic"; got.Sources[0].KBName != want {
		t.Errorf("%s: source kbName = %q, want %q", pair, got.Sources[0].KBName, want)
	}
}

// A kb_id that exists nowhere is ErrNotFound for everyone, superadmin
// included: rule 1 grants owner on every topic that exists, not on ids.
func TestScopeToMissingKBIsNotFound(t *testing.T) {
	pool := testPool(t)
	store := search.NewStore(pool)
	m := marker(t)
	uid := insertUser(t, pool, m+"-super", auth.RoleSuperAdmin)

	_, err := store.Search(context.Background(),
		search.Caller{UserID: uid, SysRole: auth.RoleSuperAdmin},
		search.Query{Text: m, KBID: uuid.NewString(), Limit: 5})
	if !errors.Is(err, search.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

// ---------------------------------------------------------------------------
// Matching semantics
// ---------------------------------------------------------------------------

func names(topics []search.TopicHit) []string {
	out := make([]string, len(topics))
	for i, h := range topics {
		out[i] = h.Name
	}
	return out
}

func sourceNames(sources []search.SourceHit) []string {
	out := make([]string, len(sources))
	for i, h := range sources {
		out[i] = h.Name
	}
	return out
}

// q is a literal substring: %, _ and \ in the query match only themselves.
// Each case pairs a name the query must match with one an UNescaped pattern
// would also match, so a missing pgxutil.EscapeLike fails here (the catalog
// query in internal/kbsubs has exactly that bug).
func TestQueryIsMatchedLiterally(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := search.NewStore(pool)
	m := marker(t)
	uid := insertUser(t, pool, m+"-super", auth.RoleSuperAdmin)
	caller := search.Caller{UserID: uid, SysRole: auth.RoleSuperAdmin}

	cases := []struct {
		q, match, decoy string
	}{
		{m + " pct 100%", m + " pct 100% sicher", m + " pct 1000 sicher"},
		{m + " und a_b", m + " und a_b", m + " und axb"},
		{m + ` bs back\s`, m + ` bs back\slash`, m + " bs backslash"},
	}
	for _, c := range cases {
		kbID := insertKB(t, pool, kbSpec{name: c.match, visibility: "private"})
		insertKB(t, pool, kbSpec{name: c.decoy, visibility: "private"})
		insertFile(t, pool, kbID, c.match+".pdf")
		insertFile(t, pool, kbID, c.decoy+".pdf")

		got, err := store.Search(ctx, caller, search.Query{Text: c.q, Limit: 20})
		if err != nil {
			t.Fatalf("q=%q: %v", c.q, err)
		}
		if gotNames := names(got.Topics); len(gotNames) != 1 || gotNames[0] != c.match {
			t.Errorf("q=%q: topics = %q, want only %q", c.q, gotNames, c.match)
		}
		if gotNames := sourceNames(got.Sources); len(gotNames) != 1 || gotNames[0] != c.match+".pdf" {
			t.Errorf("q=%q: sources = %q, want only %q", c.q, gotNames, c.match+".pdf")
		}
	}
}

// Matching is case-insensitive (ILIKE), for umlauts too.
func TestQueryIsCaseInsensitive(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := search.NewStore(pool)
	m := marker(t)
	uid := insertUser(t, pool, m+"-super", auth.RoleSuperAdmin)
	caller := search.Caller{UserID: uid, SysRole: auth.RoleSuperAdmin}

	name := m + " Prüfungsordnung"
	kbID := insertKB(t, pool, kbSpec{name: name, visibility: "private"})
	insertFile(t, pool, kbID, strings.ToUpper(m)+"-PRÜFUNG.pdf")

	got, err := store.Search(ctx, caller, search.Query{Text: strings.ToUpper(m) + " PRÜF", Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if gotNames := names(got.Topics); len(gotNames) != 1 || gotNames[0] != name {
		t.Errorf("topics = %q, want %q", gotNames, name)
	}
	got, err = store.Search(ctx, caller, search.Query{Text: m + "-prüfung", Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Sources) != 1 {
		t.Errorf("sources = %q, want the one upper-case file", sourceNames(got.Sources))
	}
}

// Topics match on description and header_text too (the catalog's three
// columns), and the snippet is description, falling back to header_text,
// whitespace-collapsed and cut at 160 characters with an ellipsis.
func TestTopicDescriptionMatchAndSnippet(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := search.NewStore(pool)
	m := marker(t)
	uid := insertUser(t, pool, m+"-super", auth.RoleSuperAdmin)
	caller := search.Caller{UserID: uid, SysRole: auth.RoleSuperAdmin}

	long := strings.Repeat("abcdefghij", 20) // 200 characters
	insertKB(t, pool, kbSpec{name: m + "-desc", visibility: "private",
		description: "Ordnungen für  das\n\nStudium " + m + "-needle"})
	insertKB(t, pool, kbSpec{name: m + "-header", visibility: "private",
		description: "   ", headerText: "  Willkommen\tim " + m + "-needle  "})
	insertKB(t, pool, kbSpec{name: m + "-long", visibility: "private",
		description: m + "-needle " + long})
	insertKB(t, pool, kbSpec{name: m + "-none", visibility: "private"})

	got, err := store.Search(ctx, caller, search.Query{Text: m + "-needle", Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	snippets := map[string]*string{}
	for _, h := range got.Topics {
		snippets[h.Name] = h.Description
	}
	if len(got.Topics) != 3 {
		t.Fatalf("topics = %q, want the three KBs whose description/header contains the needle", names(got.Topics))
	}
	wantLong := (m + "-needle " + long)[:159] + "…" // ASCII, so bytes == characters
	for name, want := range map[string]string{
		m + "-desc":   "Ordnungen für das Studium " + m + "-needle",
		m + "-header": "Willkommen im " + m + "-needle",
		m + "-long":   wantLong,
	} {
		gotSnip := snippets[name]
		if gotSnip == nil || *gotSnip != want {
			t.Errorf("%s: snippet = %v, want %q", name, deref(gotSnip), want)
		}
	}

	// A topic with neither text: matched by name, snippet null.
	got, err = store.Search(ctx, caller, search.Query{Text: m + "-none", Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Topics) != 1 || got.Topics[0].Description != nil {
		t.Errorf("-none: topics = %+v, want one hit with a null description", got.Topics)
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

// Order: name starts with q, then name contains q, then description-only;
// ties by case-folded name. Limit applies per group.
func TestOrderAndLimit(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := search.NewStore(pool)
	m := marker(t)
	uid := insertUser(t, pool, m+"-super", auth.RoleSuperAdmin)
	caller := search.Caller{UserID: uid, SysRole: auth.RoleSuperAdmin}

	q := "rk" + m
	order := []kbSpec{
		{name: q + " alpha", visibility: "private"},
		{name: q + " Beta", visibility: "private"},
		{name: "x " + q + " gamma", visibility: "private"},
		{name: "zz-desc-" + m, visibility: "private", description: "about " + q},
	}
	// Inserted in reverse so insertion order cannot pass for the sort.
	for i := len(order) - 1; i >= 0; i-- {
		id := insertKB(t, pool, order[i])
		insertFile(t, pool, id, order[i].name+".pdf")
	}

	got, err := store.Search(ctx, caller, search.Query{Text: q, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{order[0].name, order[1].name, order[2].name, order[3].name}
	if gotNames := names(got.Topics); strings.Join(gotNames, "|") != strings.Join(want, "|") {
		t.Errorf("topic order = %q, want %q", gotNames, want)
	}
	// Files: the fourth KB's file name does not contain q, so three hits,
	// prefix first.
	wantFiles := []string{order[0].name + ".pdf", order[1].name + ".pdf", order[2].name + ".pdf"}
	if gotNames := sourceNames(got.Sources); strings.Join(gotNames, "|") != strings.Join(wantFiles, "|") {
		t.Errorf("source order = %q, want %q", gotNames, wantFiles)
	}

	got, err = store.Search(ctx, caller, search.Query{Text: q, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Topics) != 2 || len(got.Sources) != 2 {
		t.Errorf("limit 2: %d topics, %d sources, want 2 and 2", len(got.Topics), len(got.Sources))
	}
}
