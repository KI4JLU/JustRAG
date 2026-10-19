//go:build integration

package userfiles_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/justrag/go-backend/internal/userfiles"
)

// Oracle: migration 0090's contract — a chat attachment is hidden from the
// library list but readable by its owner, and a library upload of the same
// bytes promotes it.
func TestScope_ChatAttachmentHiddenThenPromoted(t *testing.T) {
	pool := openMainPool(t)
	st := userfiles.NewStore(pool)
	ctx := context.Background()
	owner := seedUser(t, pool)

	f := newFile(owner, sha("c"), 10)
	f.Scope = userfiles.ScopeChat
	att := mustInsert(t, st, f)
	if att.IsLibrary() || att.Scope != userfiles.ScopeChat {
		t.Fatalf("inserted scope %q, want chat", att.Scope)
	}
	items, total, err := st.List(ctx, owner, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 0 || len(items) != 0 {
		t.Fatalf("library lists %d (total %d), want the chat attachment hidden", len(items), total)
	}
	if got, err := st.Get(ctx, owner, att.ID); err != nil || got.Scope != userfiles.ScopeChat {
		t.Fatalf("owner Get = %+v, %v; want the chat attachment", got, err)
	}

	lib := newFile(owner, sha("c"), 10) // same bytes, library upload
	row, created, err := st.Insert(ctx, lib)
	if err != nil || created {
		t.Fatalf("library re-upload: created=%v err=%v, want the dedup hit", created, err)
	}
	if row.ID != att.ID || !row.IsLibrary() {
		t.Fatalf("dedup hit %+v, want the attachment promoted to library", row)
	}
	if _, total, _ := st.List(ctx, owner, 50, 0); total != 1 {
		t.Fatalf("library total %d after promotion, want 1", total)
	}
}

// Oracle: Promote is owner-scoped like every other store call.
func TestScope_PromoteForeignIsNotFound(t *testing.T) {
	pool := openMainPool(t)
	st := userfiles.NewStore(pool)
	owner, other := seedUser(t, pool), seedUser(t, pool)
	f := newFile(owner, sha("d"), 1)
	f.Scope = userfiles.ScopeChat
	att := mustInsert(t, st, f)
	if err := st.Promote(context.Background(), other, att.ID); !errors.Is(err, userfiles.ErrNotFound) {
		t.Fatalf("foreign promote: %v, want ErrNotFound", err)
	}
}

// Oracle: the pending sweep lists only chat attachments older than the
// cutoff that nothing references; a KB copy keeps one, a library file is
// never listed.
func TestPendingChatFiles(t *testing.T) {
	pool := openMainPool(t)
	st := userfiles.NewStore(pool)
	orphans := userfiles.NewOrphanStore(pool)
	ctx := context.Background()
	owner := seedUser(t, pool)

	mk := func(c, scope string) *userfiles.UserFile {
		f := newFile(owner, sha(c), 1)
		f.Scope = scope
		return mustInsert(t, st, f)
	}
	old := mk("e", userfiles.ScopeChat)
	young := mk("f", userfiles.ScopeChat)
	inKB := mk("g", userfiles.ScopeChat)
	library := mk("h", userfiles.ScopeLibrary)
	for _, id := range []string{old.ID, inKB.ID, library.ID} {
		if _, err := pool.Exec(ctx, `UPDATE user_files SET created_at = now() - interval '2 days' WHERE id = $1::uuid`, id); err != nil {
			t.Fatal(err)
		}
	}
	addCopy(t, pool, seedKBNamed(t, pool, "pending-sweep", "private"), inKB.ID)

	got, err := orphans.PendingChatFiles(ctx, time.Now().Add(-userfiles.OrphanGrace), 500)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, f := range got {
		found[f.ID] = true
	}
	if !found[old.ID] {
		t.Error("old unreferenced chat attachment not listed")
	}
	for name, id := range map[string]string{"young": young.ID, "in a KB": inKB.ID, "library": library.ID} {
		if found[id] {
			t.Errorf("%s file listed as pending", name)
		}
	}
}
