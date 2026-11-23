//go:build integration

// Integration tests for kb_invite_links (migration 0067). Require a live
// main Postgres; skipped when DB_* env is unset. Pool/skip pattern follows
// internal/kbmembers/store_pg_integration_test.go.

package kbinvites_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/kbinvites"
)

// testRunSuffix is fixed once per process, not once per test: t.Name() alone
// is deterministic across separate invocations of `go test`, so it cannot by
// itself prevent the aborted-run collision below — the whole point is that
// the SAME test, run twice, must NOT try to insert the same username twice.
var testRunSuffix = fmt.Sprintf("%d", time.Now().UnixNano())

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	host, port, name := os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")
	if host == "" || port == "" || name == "" {
		t.Skip("kb_invite_links tests require DB_* env (main Postgres)")
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

// uniqueUsername builds base-{testName}-{testRunSuffix}. An aborted run
// (panic, ctrl-C, CI timeout) leaves its fixture rows behind — there is no
// TRUNCATE between local runs against the throwaway DB — so the next run's
// insertUser would collide on the users.username unique constraint unless
// the username carries something that changes between runs. testRunSuffix
// supplies that; t.Name() is folded in purely so a stray leftover row in the
// DB is traceable back to the test that created it.
func uniqueUsername(t *testing.T, base string) string {
	t.Helper()
	name := strings.NewReplacer("/", "-", " ", "-").Replace(t.Name())
	return base + "-" + name + "-" + testRunSuffix
}

// insertUser inserts a throwaway user (username suffixed via uniqueUsername)
// and returns its id.
func insertUser(t *testing.T, pool *pgxpool.Pool, username string) string {
	t.Helper()
	ctx := context.Background()
	username = uniqueUsername(t, username)
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'x-not-a-real-hash', 'user')
		RETURNING id::text`, username).Scan(&id)
	if err != nil {
		t.Fatalf("insert user %s: %v", username, err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM users WHERE id = $1::uuid`, id) //nolint:errcheck
	})
	return id
}

// insertKB inserts a KB owned by ownerID and writes its owner row into
// kb_members, matching the invariant application code maintains: every KB
// has exactly one kb_members row with role='owner'.
func insertKB(t *testing.T, pool *pgxpool.Pool, ownerID string, isGlobal, isPublished bool) string {
	t.Helper()
	ctx := context.Background()
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO knowledge_bases (name, description, visibility, is_published, user_id)
		VALUES ('kb-invites-test', 'fixture', CASE WHEN $1 THEN 'public' ELSE 'private' END, $2, $3::uuid)
		RETURNING id::text`, isGlobal, isPublished, ownerID).Scan(&id)
	if err != nil {
		t.Fatalf("insert kb: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM knowledge_bases WHERE id = $1::uuid`, id) //nolint:errcheck
	})
	mustExec(t, pool, `INSERT INTO kb_members (kb_id, user_id, role) VALUES ($1, $2, 'owner')`, id, ownerID)
	return id
}

// mustExec runs a statement and fails the test on error.
func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func TestCreateListRevoke(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "invites-owner")
	kbID := insertKB(t, pool, ownerID, false, false)

	tok, err := kbinvites.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	label := "WS26 Studierende"
	created, err := store.Create(ctx, kbID, tok, "edit", &label, ownerID)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.Token != tok || created.Role != "edit" {
		t.Fatalf("Create returned %+v, want token %q role edit", created, tok)
	}
	wantOwnerName := uniqueUsername(t, "invites-owner")
	if created.CreatedByName == nil || *created.CreatedByName != wantOwnerName {
		t.Fatalf("CreatedByName = %v, want %s", created.CreatedByName, wantOwnerName)
	}
	if created.RedemptionCount != 0 {
		t.Fatalf("RedemptionCount = %d, want 0", created.RedemptionCount)
	}

	links, err := store.List(ctx, kbID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(links) != 1 || links[0].ID != created.ID {
		t.Fatalf("List returned %d links, want the one just created", len(links))
	}

	if err := store.Revoke(ctx, kbID, created.ID); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	links, err = store.List(ctx, kbID)
	if err != nil {
		t.Fatalf("List after revoke: %v", err)
	}
	if len(links) != 0 {
		t.Fatalf("List after revoke returned %d links, want 0", len(links))
	}

	// The revoked token still resolves to its KB, but nobody joins through it.
	joinerID := insertUser(t, pool, "invites-late-joiner")
	target, err := store.Resolve(ctx, tok, joinerID)
	if err != nil {
		t.Fatalf("Resolve after revoke: %v", err)
	}
	if !target.Revoked || target.KBID != kbID {
		t.Fatalf("Resolve after revoke = %+v, want revoked link on %s", target, kbID)
	}
	if _, err := store.Redeem(ctx, tok, joinerID); !errors.Is(err, kbinvites.ErrRevoked) {
		t.Fatalf("Redeem after revoke returned %v, want ErrRevoked", err)
	}
	if got := memberRole(t, pool, kbID, joinerID); got != "" {
		t.Fatalf("kb_members role = %q after redeeming a revoked link, want none", got)
	}
	if err := store.Revoke(ctx, kbID, created.ID); !errors.Is(err, kbinvites.ErrNotFound) {
		t.Fatalf("second Revoke returned %v, want ErrNotFound", err)
	}
}

// Resolve reports the caller's standing without writing anything. Oracle:
// the rows the fixture inserts.
func TestResolve(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "resolve-owner")
	memberID := insertUser(t, pool, "resolve-member")
	outsiderID := insertUser(t, pool, "resolve-outsider")
	kbID := insertKB(t, pool, ownerID, true, true) // public + published
	setMemberRole(t, pool, kbID, memberID, "view")
	mustExec(t, pool, `INSERT INTO kb_subscriptions (kb_id, user_id, state) VALUES ($1, $2, 'opted_out')`, kbID, memberID)
	mustExec(t, pool, `INSERT INTO kb_favorites (user_id, kb_id) VALUES ($1, $2)`, memberID, kbID)
	// description is empty, so the header_text blurb is what the modal shows.
	mustExec(t, pool, `UPDATE knowledge_bases SET description = '', header_text = 'Blurb' WHERE id = $1`, kbID)

	tok, _ := kbinvites.NewToken()
	if _, err := store.Create(ctx, kbID, tok, "edit", nil, ownerID); err != nil {
		t.Fatalf("Create: %v", err)
	}

	m, err := store.Resolve(ctx, tok, memberID)
	if err != nil {
		t.Fatalf("Resolve member: %v", err)
	}
	// Opted out: a member of a public KB, yet not in their overview.
	if m.MemberRole != "view" || m.InOverview || !m.IsFavorite || m.Revoked || m.LinkRole != "edit" ||
		!m.IsGlobal || !m.IsPublished || m.Description == nil || *m.Description != "Blurb" {
		t.Fatalf("Resolve member = %+v", m)
	}

	o, err := store.Resolve(ctx, tok, outsiderID)
	if err != nil {
		t.Fatalf("Resolve outsider: %v", err)
	}
	// Published, not auto_subscribe, no subscription: not in the overview.
	if o.MemberRole != "" || o.InOverview || o.IsFavorite {
		t.Fatalf("Resolve outsider = %+v, want no membership, not in overview, no favorite", o)
	}
	mustExec(t, pool, `INSERT INTO kb_subscriptions (kb_id, user_id, state) VALUES ($1, $2, 'subscribed')`, kbID, outsiderID)
	if o, err = store.Resolve(ctx, tok, outsiderID); err != nil || !o.InOverview {
		t.Fatalf("Resolve subscribed outsider = %+v, %v, want in overview", o, err)
	}

	if _, err := store.Resolve(ctx, "no-such-token", outsiderID); !errors.Is(err, kbinvites.ErrNotFound) {
		t.Fatalf("Resolve unknown token returned %v, want ErrNotFound", err)
	}
}

// Revoke must be scoped to the KB in the URL. Without the kb_id predicate an
// admin of KB A could revoke a link belonging to KB B by guessing its id.
func TestRevokeRejectsForeignKB(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "invites-foreign-owner")
	kbA := insertKB(t, pool, ownerID, false, false)
	kbB := insertKB(t, pool, ownerID, false, false)

	tok, _ := kbinvites.NewToken()
	link, err := store.Create(ctx, kbA, tok, "view", nil, ownerID)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	err = store.Revoke(ctx, kbB, link.ID)
	if !errors.Is(err, kbinvites.ErrNotFound) {
		t.Fatalf("Revoke across KBs returned %v, want ErrNotFound", err)
	}

	links, _ := store.List(ctx, kbA)
	if len(links) != 1 {
		t.Fatalf("link was revoked through the wrong KB")
	}
}

// The role CHECK is the backstop behind kbaccess.Assignable: even a direct
// store call must not be able to mint an owner-granting link.
func TestCreateRejectsOwnerRole(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "invites-owner-role")
	kbID := insertKB(t, pool, ownerID, false, false)

	tok, _ := kbinvites.NewToken()
	if _, err := store.Create(ctx, kbID, tok, "owner", nil, ownerID); err == nil {
		t.Fatal("Create with role=owner succeeded, want a CHECK-constraint error")
	}
}

// A brand-new member gets exactly the link's role.
func TestRedeemGrantsRole(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "redeem-owner")
	joinerID := insertUser(t, pool, "redeem-joiner")
	kbID := insertKB(t, pool, ownerID, false, false)

	tok, _ := kbinvites.NewToken()
	link, err := store.Create(ctx, kbID, tok, "edit", nil, ownerID)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	res, err := store.Redeem(ctx, tok, joinerID)
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	if res.Role != "edit" || res.AlreadyMember {
		t.Fatalf("Redeem = %+v, want role edit and AlreadyMember false", res)
	}
	if res.KBID != kbID {
		t.Fatalf("Redeem KBID = %q, want %q", res.KBID, kbID)
	}

	if got := memberRole(t, pool, kbID, joinerID); got != "edit" {
		t.Fatalf("kb_members role = %q, want edit", got)
	}

	links, _ := store.List(ctx, kbID)
	if links[0].ID != link.ID || links[0].RedemptionCount != 1 {
		t.Fatalf("RedemptionCount = %d, want 1", links[0].RedemptionCount)
	}
	if links[0].LastUsedAt == nil {
		t.Fatal("LastUsedAt is nil after a redemption")
	}
}

// A link never changes an existing membership: not downwards ...
func TestRedeemNeverDowngrades(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "downgrade-owner")
	taID := insertUser(t, pool, "downgrade-ta")
	kbID := insertKB(t, pool, ownerID, false, false)
	setMemberRole(t, pool, kbID, taID, "edit")

	tok, _ := kbinvites.NewToken()
	if _, err := store.Create(ctx, kbID, tok, "view", nil, ownerID); err != nil {
		t.Fatalf("Create: %v", err)
	}

	res, err := store.Redeem(ctx, tok, taID)
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	if res.Role != "edit" || !res.AlreadyMember {
		t.Fatalf("Redeem = %+v, want role edit and AlreadyMember true", res)
	}
	if got := memberRole(t, pool, kbID, taID); got != "edit" {
		t.Fatalf("kb_members role = %q, want edit — the view link downgraded a member", got)
	}
}

// ... and not upwards either: role changes go through the members panel.
// Nothing is written for an existing member — no counter, no last_used_at.
func TestRedeemNeverUpgrades(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "upgrade-owner")
	memberID := insertUser(t, pool, "upgrade-member")
	kbID := insertKB(t, pool, ownerID, false, false)
	setMemberRole(t, pool, kbID, memberID, "view")

	tok, _ := kbinvites.NewToken()
	link, err := store.Create(ctx, kbID, tok, "admin", nil, ownerID)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	res, err := store.Redeem(ctx, tok, memberID)
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	if res.Role != "view" || !res.AlreadyMember {
		t.Fatalf("Redeem = %+v, want the unchanged role view and AlreadyMember true", res)
	}
	if got := memberRole(t, pool, kbID, memberID); got != "view" {
		t.Fatalf("kb_members role = %q, want view — the admin link upgraded a member", got)
	}

	links, _ := store.List(ctx, kbID)
	if links[0].ID != link.ID || links[0].RedemptionCount != 0 || links[0].LastUsedAt != nil {
		t.Fatalf("link = %+v, want no redemption recorded for an existing member", links[0])
	}
}

// The counter is the number of distinct people who joined through the link,
// not the number of redemptions (migration 0087): a person opening the same
// link again adds nothing and does not even move last_used_at (they are
// already a member, nothing is written); a second person adds one. Oracle:
// the fixture's own users and call sequence — two calls by one person and
// one by another must read back as 2.
func TestRedeemCountsPeopleNotVisits(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "people-owner")
	aliceID := insertUser(t, pool, "people-alice")
	bobID := insertUser(t, pool, "people-bob")
	kbID := insertKB(t, pool, ownerID, false, false)

	tok, _ := kbinvites.NewToken()
	if _, err := store.Create(ctx, kbID, tok, "view", nil, ownerID); err != nil {
		t.Fatalf("Create: %v", err)
	}
	count := func() (int, *time.Time) {
		t.Helper()
		links, err := store.List(ctx, kbID)
		if err != nil || len(links) != 1 {
			t.Fatalf("List = %v, %v", links, err)
		}
		return links[0].RedemptionCount, links[0].LastUsedAt
	}

	if _, err := store.Redeem(ctx, tok, aliceID); err != nil {
		t.Fatalf("Redeem alice: %v", err)
	}
	if n, _ := count(); n != 1 {
		t.Fatalf("after alice: RedemptionCount = %d, want 1", n)
	}
	_, firstUse := count()

	// Alice again: a repeat visit, not a new person.
	time.Sleep(10 * time.Millisecond)
	res, err := store.Redeem(ctx, tok, aliceID)
	if err != nil {
		t.Fatalf("Redeem alice again: %v", err)
	}
	if !res.AlreadyMember {
		t.Fatalf("Redeem alice again = %+v, want AlreadyMember", res)
	}
	n, again := count()
	if n != 1 {
		t.Fatalf("after alice twice: RedemptionCount = %d, want 1 — a repeat visit must not count", n)
	}
	if firstUse == nil || again == nil || !again.Equal(*firstUse) {
		t.Fatalf("last_used_at moved on a repeat visit that joined nobody: %v -> %v", firstUse, again)
	}

	if _, err := store.Redeem(ctx, tok, bobID); err != nil {
		t.Fatalf("Redeem bob: %v", err)
	}
	if n, _ := count(); n != 2 {
		t.Fatalf("after bob: RedemptionCount = %d, want 2", n)
	}

	var rows int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM kb_invite_link_redemptions r
		JOIN kb_invite_links l ON l.id = r.link_id WHERE l.kb_id = $1::uuid`, kbID).Scan(&rows); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if rows != 2 {
		t.Fatalf("kb_invite_link_redemptions rows = %d, want 2 (alice, bob)", rows)
	}
}

// The owner row is immutable outside the explicit transfer endpoint:
// redeeming a link never demotes an owner (the general no-touch rule for
// existing members, pinned here for the row that matters most).
func TestRedeemLeavesOwnerUntouched(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "owner-untouched")
	kbID := insertKB(t, pool, ownerID, false, false)

	tok, _ := kbinvites.NewToken()
	if _, err := store.Create(ctx, kbID, tok, "view", nil, ownerID); err != nil {
		t.Fatalf("Create: %v", err)
	}

	res, err := store.Redeem(ctx, tok, ownerID)
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	if res.Role != "owner" || !res.AlreadyMember {
		t.Fatalf("Redeem = %+v, want role owner and AlreadyMember true", res)
	}
	if got := memberRole(t, pool, kbID, ownerID); got != "owner" {
		t.Fatalf("kb_members role = %q, want owner — the owner was demoted", got)
	}
}

// Opt-out beats membership in the overview queries, so a stale opted_out row
// would leave the joiner a member of a KB they cannot see anywhere.
func TestRedeemClearsOptOut(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "optout-owner")
	joinerID := insertUser(t, pool, "optout-joiner")
	kbID := insertKB(t, pool, ownerID, true, true) // public + published
	if _, err := pool.Exec(ctx, `
		INSERT INTO kb_subscriptions (kb_id, user_id, state)
		VALUES ($1::uuid, $2::uuid, 'opted_out')`, kbID, joinerID); err != nil {
		t.Fatalf("insert opt-out: %v", err)
	}

	tok, _ := kbinvites.NewToken()
	if _, err := store.Create(ctx, kbID, tok, "edit", nil, ownerID); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := store.Redeem(ctx, tok, joinerID); err != nil {
		t.Fatalf("Redeem: %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM kb_subscriptions
		WHERE kb_id = $1::uuid AND user_id = $2::uuid AND state = 'opted_out'`,
		kbID, joinerID).Scan(&count); err != nil {
		t.Fatalf("count opt-out: %v", err)
	}
	if count != 0 {
		t.Fatal("opted_out subscription survived the redemption — the KB stays invisible")
	}
}

func TestRedeemUnknownToken(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	userID := insertUser(t, pool, "unknown-token-user")
	if _, err := store.Redeem(ctx, "this-token-does-not-exist", userID); !errors.Is(err, kbinvites.ErrNotFound) {
		t.Fatalf("Redeem with unknown token returned %v, want ErrNotFound", err)
	}
}

// memberRole reads a user's kb_members role, or "" when there is no row.
func memberRole(t *testing.T, pool *pgxpool.Pool, kbID, userID string) string {
	t.Helper()
	var role string
	err := pool.QueryRow(context.Background(),
		`SELECT role FROM kb_members WHERE kb_id = $1::uuid AND user_id = $2::uuid`,
		kbID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return ""
	}
	if err != nil {
		t.Fatalf("memberRole: %v", err)
	}
	return role
}

// setMemberRole seeds an existing membership.
func setMemberRole(t *testing.T, pool *pgxpool.Pool, kbID, userID, role string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO kb_members (kb_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT (kb_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
		kbID, userID, role); err != nil {
		t.Fatalf("setMemberRole: %v", err)
	}
}

// Details reads what the KB's title card shows. Oracle: the fixture — a
// fresh KB has no files, no category and the default template role, whose
// start page offers no further role cards, so its name is reported.
func TestDetails(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "details-owner")
	kbID := insertKB(t, pool, ownerID, false, false)

	d, err := store.Details(ctx, kbID)
	if err != nil {
		t.Fatalf("Details: %v", err)
	}
	if d.FileCount != 0 || d.LastIngestedAt != nil || d.Category != nil || d.RoleName == "" {
		t.Fatalf("Details of a fresh KB = %+v, want no files, no category, a role name", d)
	}

	var catID string
	name := uniqueUsername(t, "details-cat")
	if err := pool.QueryRow(ctx, `INSERT INTO kb_categories (name, sort_order, color_slot) VALUES ($1, 1, 3) RETURNING id::text`, name).Scan(&catID); err != nil {
		t.Fatalf("insert category: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM kb_categories WHERE id = $1::uuid`, catID) }) //nolint:errcheck
	mustExec(t, pool, `INSERT INTO kb_category_links (kb_id, category_id) VALUES ($1, $2)`, kbID, catID)

	d, err = store.Details(ctx, kbID)
	if err != nil {
		t.Fatalf("Details with category: %v", err)
	}
	var cat struct {
		Name      string `json:"name"`
		ColorSlot int    `json:"colorSlot"`
	}
	if err := json.Unmarshal(d.Category, &cat); err != nil || cat.Name != name || cat.ColorSlot != 3 {
		t.Fatalf("Category = %s (%v), want %s with colorSlot 3", d.Category, err, name)
	}
}

// A revoke that commits while a join is in flight rolls the join back.
// Oracle: PostgreSQL's row lock — the revoke holds the link row, Redeem's
// counter UPDATE waits for it and then re-reads revoked_at; the join's
// membership, opt-out removal and redemption row must all be gone.
func TestRedeemRollsBackOnConcurrentRevoke(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := kbinvites.NewStore(pool)

	ownerID := insertUser(t, pool, "race-owner")
	joinerID := insertUser(t, pool, "race-joiner")
	kbID := insertKB(t, pool, ownerID, true, true)
	mustExec(t, pool, `INSERT INTO kb_subscriptions (kb_id, user_id, state) VALUES ($1, $2, 'opted_out')`, kbID, joinerID)
	tok, _ := kbinvites.NewToken()
	link, err := store.Create(ctx, kbID, tok, "edit", nil, ownerID)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	revokeTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer revokeTx.Rollback(ctx) //nolint:errcheck
	if _, err := revokeTx.Exec(ctx, `UPDATE kb_invite_links SET revoked_at = NOW() WHERE id = $1::uuid`, link.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := store.Redeem(ctx, tok, joinerID)
		done <- err
	}()
	// Redeem reads the link (not yet revoked for it), joins, and then blocks
	// on the counter UPDATE behind the revoke's row lock.
	waitForLockWait(t, pool)
	if err := revokeTx.Commit(ctx); err != nil {
		t.Fatalf("commit revoke: %v", err)
	}
	if err := <-done; !errors.Is(err, kbinvites.ErrRevoked) {
		t.Fatalf("Redeem racing a revoke returned %v, want ErrRevoked", err)
	}

	if got := memberRole(t, pool, kbID, joinerID); got != "" {
		t.Fatalf("kb_members role = %q, want none — the join was not rolled back", got)
	}
	var optOut, redemptions int
	if err := pool.QueryRow(ctx, `SELECT
		    (SELECT COUNT(*) FROM kb_subscriptions WHERE kb_id = $1::uuid AND user_id = $2::uuid AND state = 'opted_out'),
		    (SELECT COUNT(*) FROM kb_invite_link_redemptions WHERE link_id = $3::uuid)`,
		kbID, joinerID, link.ID).Scan(&optOut, &redemptions); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if optOut != 1 || redemptions != 0 {
		t.Fatalf("opt-out rows = %d, redemptions = %d; want 1 and 0", optOut, redemptions)
	}
}

// waitForLockWait polls pg_stat_activity until Redeem's counter UPDATE waits
// on a lock, so the test commits the revoke only once Redeem is blocked
// behind it — past its token lookup, with its join written.
func waitForLockWait(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var waiting int
		if err := pool.QueryRow(context.Background(), `
			SELECT COUNT(*) FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'
			  AND query LIKE '%UPDATE kb_invite_links%redemption_count%'`).Scan(&waiting); err != nil {
			t.Fatalf("pg_stat_activity: %v", err)
		}
		if waiting > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("Redeem never blocked behind the revoke")
}
