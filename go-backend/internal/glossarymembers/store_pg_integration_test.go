//go:build integration

// Integration tests for the glossary sharing store against a live main
// Postgres (migration 0109); skipped when DB_* env is unset.

package glossarymembers_test

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/justrag/go-backend/internal/glossaryaccess"
	"github.com/justrag/go-backend/internal/glossarymembers"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	host, port, name := os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME")
	if host == "" || port == "" || name == "" {
		t.Skip("glossary members tests require DB_* env (main Postgres)")
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

// newGlossary inserts a private glossary owned by ownerID, with its owner row.
func newGlossary(t *testing.T, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `INSERT INTO glossaries (name) VALUES ('members-test') RETURNING id::text`).Scan(&id); err != nil {
		t.Fatalf("insert glossary: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM glossaries WHERE id = $1::uuid`, id) }) //nolint:errcheck
	if _, err := pool.Exec(ctx, `INSERT INTO glossary_members (glossary_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')`, id, ownerID); err != nil {
		t.Fatalf("insert owner row: %v", err)
	}
	return id
}

func TestOwnerInvariants(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	s := glossarymembers.NewStore(pool)
	owner, ann, ben := insertUser(t, pool, "gm-owner"), insertUser(t, pool, "gm-ann"), insertUser(t, pool, "gm-ben")
	g := newGlossary(t, pool, owner)

	// A second owner row violates the partial unique index.
	if _, err := pool.Exec(ctx, `INSERT INTO glossary_members (glossary_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')`, g, ann); err == nil {
		t.Error("two owners of one glossary must be impossible")
	}
	if err := s.SetRole(ctx, g, ann, glossaryaccess.RoleOwner, owner); !errors.Is(err, glossarymembers.ErrOwnerImmutable) {
		t.Errorf("assigning owner through SetRole: %v, want ErrOwnerImmutable", err)
	}
	if err := s.SetRole(ctx, g, ann, glossaryaccess.RoleEditor, owner); err != nil {
		t.Fatalf("SetRole editor: %v", err)
	}
	if err := s.SetRole(ctx, g, ann, glossaryaccess.RoleAdmin, owner); err != nil {
		t.Fatalf("SetRole admin: %v", err)
	}
	if err := s.SetRole(ctx, g, owner, glossaryaccess.RoleViewer, owner); !errors.Is(err, glossarymembers.ErrOwnerImmutable) {
		t.Errorf("demoting the owner row: %v, want ErrOwnerImmutable", err)
	}
	if err := s.RemoveMember(ctx, g, owner); !errors.Is(err, glossarymembers.ErrOwnerImmutable) {
		t.Errorf("removing the owner row: %v, want ErrOwnerImmutable", err)
	}
	if err := s.Leave(ctx, g, owner); !errors.Is(err, glossarymembers.ErrOwnerImmutable) {
		t.Errorf("the owner leaving: %v, want ErrOwnerImmutable", err)
	}
	if err := s.RemoveMember(ctx, g, ben); !errors.Is(err, glossarymembers.ErrNotFound) {
		t.Errorf("removing a stranger: %v, want ErrNotFound", err)
	}

	// AddMember never re-roles an existing member.
	added, err := s.AddMember(ctx, g, ann, glossaryaccess.RoleViewer, owner)
	if err != nil || added {
		t.Errorf("AddMember of an existing member = %v, %v; want false, nil", added, err)
	}
	if r, _ := s.GetRole(ctx, g, ann); r != glossaryaccess.RoleAdmin {
		t.Errorf("the existing role must stay, got %q", r)
	}
	if added, err := s.AddMember(ctx, g, ben, glossaryaccess.RoleViewer, owner); err != nil || !added {
		t.Errorf("AddMember of a new member = %v, %v; want true, nil", added, err)
	}
	if _, err := s.AddMember(ctx, g, ben, glossaryaccess.RoleOwner, owner); !errors.Is(err, glossarymembers.ErrOwnerImmutable) {
		t.Errorf("AddMember as owner: %v", err)
	}

	// Listing: strongest role first.
	members, err := s.ListMembers(ctx, g)
	if err != nil {
		t.Fatal(err)
	}
	var order []string
	for _, m := range members {
		order = append(order, m.Role)
	}
	if fmt.Sprint(order) != "[owner admin viewer]" {
		t.Errorf("member order = %v, want [owner admin viewer]", order)
	}

	// Transfer: the target must be a member; the old owner becomes admin; the
	// unique owner index holds throughout.
	if err := s.TransferOwner(ctx, g, owner, insertUser(t, pool, "gm-nobody")); !errors.Is(err, glossarymembers.ErrNotFound) {
		t.Errorf("transfer to a non-member: %v, want ErrNotFound", err)
	}
	if r, _ := s.GetRole(ctx, g, owner); r != glossaryaccess.RoleOwner {
		t.Errorf("a refused transfer must roll back, owner row is %q", r)
	}
	if err := s.TransferOwner(ctx, g, owner, ann); err != nil {
		t.Fatalf("TransferOwner: %v", err)
	}
	if r, _ := s.GetRole(ctx, g, ann); r != glossaryaccess.RoleOwner {
		t.Errorf("new owner role = %q", r)
	}
	if r, _ := s.GetRole(ctx, g, owner); r != glossaryaccess.RoleAdmin {
		t.Errorf("old owner role = %q, want admin", r)
	}
	// The old owner holds no owner row any more: acting as owner is refused.
	if err := s.TransferOwner(ctx, g, owner, ben); !errors.Is(err, glossarymembers.ErrNotOwner) {
		t.Errorf("a transfer by a former owner: %v, want ErrNotOwner", err)
	}
	if err := s.Leave(ctx, g, ben); err != nil {
		t.Errorf("a viewer leaving: %v", err)
	}
	if err := s.Leave(ctx, g, ben); !errors.Is(err, glossarymembers.ErrNotFound) {
		t.Errorf("leaving twice: %v, want ErrNotFound", err)
	}
}

func TestPendingInvitesAndLookup(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	s := glossarymembers.NewStore(pool)
	owner := insertUser(t, pool, "gm-owner2")
	g := newGlossary(t, pool, owner)

	if id, found, err := s.UserIDByUsername(ctx, "GM-OWNER2"); err != nil || !found || id != owner {
		t.Errorf("lookup is case-insensitive: %q %v %v", id, found, err)
	}
	if _, found, _ := s.UserIDByUsername(ctx, "nobody-here"); found {
		t.Error("an unknown username must not be found")
	}
	if err := s.UpsertPendingInvite(ctx, g, "Carla", glossaryaccess.RoleEditor, owner); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertPendingInvite(ctx, g, "carla", glossaryaccess.RoleViewer, owner); err != nil {
		t.Fatal(err)
	}
	pending, err := s.ListPendingInvites(ctx, g)
	if err != nil || len(pending) != 1 || pending[0].Username != "carla" || pending[0].Role != glossaryaccess.RoleViewer {
		t.Errorf("pending = %+v %v; want one lower-cased invite with the latest role", pending, err)
	}
	if err := s.RemovePendingInvite(ctx, g, "CARLA"); err != nil {
		t.Errorf("remove: %v", err)
	}
	if err := s.RemovePendingInvite(ctx, g, "carla"); !errors.Is(err, glossarymembers.ErrNotFound) {
		t.Errorf("remove twice: %v, want ErrNotFound", err)
	}
	// 'owner' is not representable in a pending invite, not even directly.
	if _, err := pool.Exec(ctx, `INSERT INTO glossary_pending_invites (glossary_id, username, role) VALUES ($1::uuid, 'x', 'owner')`, g); err == nil {
		t.Error("a pending invite as owner must violate the CHECK")
	}
}

func TestInviteLinks(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	s := glossarymembers.NewStore(pool)
	owner, joiner := insertUser(t, pool, "gm-owner3"), insertUser(t, pool, "gm-joiner")
	g := newGlossary(t, pool, owner)

	label := "Kurs"
	link, err := s.CreateLink(ctx, g, "tok-"+g, glossaryaccess.RoleEditor, &label, owner)
	if err != nil {
		t.Fatal(err)
	}
	if link.GlossaryID != g || link.Role != glossaryaccess.RoleEditor || link.RedemptionCount != 0 {
		t.Errorf("link = %+v", link)
	}
	if _, err := s.CreateLink(ctx, g, "tok-owner-"+g, glossaryaccess.RoleOwner, nil, owner); err == nil {
		t.Error("an owner link must violate the CHECK")
	}

	target, err := s.ResolveLink(ctx, link.Token, joiner)
	if err != nil || target.MemberRole != "" || target.Revoked || target.GlossaryID != g {
		t.Errorf("resolve for a stranger = %+v %v", target, err)
	}
	res, err := s.RedeemLink(ctx, link.Token, joiner)
	if err != nil || res.AlreadyMember || res.Role != glossaryaccess.RoleEditor {
		t.Fatalf("redeem = %+v %v", res, err)
	}
	// The same person again, and the owner: nothing changes.
	for _, who := range []string{joiner, owner} {
		again, err := s.RedeemLink(ctx, link.Token, who)
		if err != nil || !again.AlreadyMember {
			t.Errorf("redeeming as an existing member = %+v %v", again, err)
		}
	}
	if r, _ := s.GetRole(ctx, g, owner); r != glossaryaccess.RoleOwner {
		t.Errorf("a link must never change the owner, got %q", r)
	}
	links, err := s.ListLinks(ctx, g)
	if err != nil || len(links) != 1 || links[0].RedemptionCount != 1 || links[0].LastUsedAt == nil {
		t.Errorf("links = %+v %v; want one link, one distinct joiner", links, err)
	}

	// Leaving and coming back through the link counts the person once.
	if err := s.Leave(ctx, g, joiner); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RedeemLink(ctx, link.Token, joiner); err != nil {
		t.Fatal(err)
	}
	if links, _ := s.ListLinks(ctx, g); links[0].RedemptionCount != 1 {
		t.Errorf("a returning person counts once, got %d", links[0].RedemptionCount)
	}

	// Revoking: the token keeps resolving, redeem refuses, the list drops it,
	// existing members stay.
	if err := s.RevokeLink(ctx, g, link.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeLink(ctx, g, link.ID); !errors.Is(err, glossarymembers.ErrNotFound) {
		t.Errorf("revoking twice: %v, want ErrNotFound", err)
	}
	if t2, err := s.ResolveLink(ctx, link.Token, insertUser(t, pool, "gm-late")); err != nil || !t2.Revoked {
		t.Errorf("a revoked token still resolves, as revoked: %+v %v", t2, err)
	}
	if _, err := s.RedeemLink(ctx, link.Token, insertUser(t, pool, "gm-late2")); !errors.Is(err, glossarymembers.ErrRevoked) {
		t.Errorf("redeeming a revoked link: %v, want ErrRevoked", err)
	}
	if links, _ := s.ListLinks(ctx, g); len(links) != 0 {
		t.Errorf("a revoked link leaves the list, got %d", len(links))
	}
	if r, _ := s.GetRole(ctx, g, joiner); r != glossaryaccess.RoleEditor {
		t.Errorf("existing members stay after a revoke, got %q", r)
	}
	if _, err := s.ResolveLink(ctx, "no-such-token", joiner); !errors.Is(err, glossarymembers.ErrNotFound) {
		t.Errorf("unknown token: %v, want ErrNotFound", err)
	}
}

// Two transfers by the same owner pass the HTTP role check together. Exactly
// one may win; the other must not demote the owner the first one made, and the
// glossary keeps exactly one owner.
func TestConcurrentTransfersByTheSameOwner(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	s := glossarymembers.NewStore(pool)
	owner := insertUser(t, pool, "gm-race-owner")
	ann, ben := insertUser(t, pool, "gm-race-ann"), insertUser(t, pool, "gm-race-ben")
	g := newGlossary(t, pool, owner)
	for _, u := range []string{ann, ben} {
		if _, err := s.AddMember(ctx, g, u, glossaryaccess.RoleEditor, owner); err != nil {
			t.Fatal(err)
		}
	}

	for round := range 20 {
		start := make(chan struct{})
		targets := []string{ann, ben}
		errs := make([]error, len(targets))
		var wg sync.WaitGroup
		for i, target := range targets {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				errs[i] = s.TransferOwner(ctx, g, owner, target)
			}()
		}
		close(start)
		wg.Wait()

		wins, notOwner := 0, 0
		for _, err := range errs {
			switch {
			case err == nil:
				wins++
			case errors.Is(err, glossarymembers.ErrNotOwner):
				notOwner++
			default:
				t.Fatalf("round %d: unexpected error %v", round, err)
			}
		}
		if wins != 1 || notOwner != 1 {
			t.Fatalf("round %d: %d transfers won and %d lost with ErrNotOwner, want exactly 1 and 1 (%v)", round, wins, notOwner, errs)
		}
		var owners int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM glossary_members WHERE glossary_id = $1::uuid AND role = 'owner'`, g).Scan(&owners); err != nil || owners != 1 {
			t.Fatalf("round %d: owners = %d, %v; want exactly one", round, owners, err)
		}
		// The winner is the owner and still is: the loser did not demote them.
		var winner string
		if err := pool.QueryRow(ctx, `SELECT user_id::text FROM glossary_members WHERE glossary_id = $1::uuid AND role = 'owner'`, g).Scan(&winner); err != nil {
			t.Fatal(err)
		}
		if winner != ann && winner != ben {
			t.Fatalf("round %d: the owner is %s, want one of the targets", round, winner)
		}
		// Put the glossary back for the next round: the winner hands it to the first owner.
		if err := s.TransferOwner(ctx, g, winner, owner); err != nil {
			t.Fatalf("round %d: reset: %v", round, err)
		}
	}
}
