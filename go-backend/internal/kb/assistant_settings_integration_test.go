//go:build integration

// Integration tests for the combined assistant settings save and its version
// history (internal/kbassistant, migration 0094). Skipped when DB_* env is
// unset; helpers are shared with behavior_integration_test.go.

package kb_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/justrag/go-backend/internal/kbassistant"
	"github.com/justrag/go-backend/internal/kbbehavior"
	"github.com/justrag/go-backend/internal/kbcategories"
	"github.com/justrag/go-backend/internal/kbstartpage"
)

func inputOf(s kbassistant.Settings) kbassistant.Input {
	return kbassistant.Input{
		Title: s.Title, Description: s.Description, CategoryID: s.CategoryID,
		Behavior: s.Behavior.Behavior, StartPage: s.StartPage, BaseVersion: s.Version,
	}
}

// Oracle: the first save records the untouched legacy state as v1 and the
// save as v2; restoring v1 later writes a new version and brings the legacy
// prompt back byte for byte (behavior NULL again), so nothing is lost or
// overwritten.
func TestAssistantSettings_SaveVersionsRestore(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	legacy := "Du bist X.\n"
	kbID := insertBehaviorKB(t, pool, &legacy)
	userID := insertUser(t, pool, "it-assistant-author")
	owner := kbassistant.Author{ID: userID, CanRename: true}
	st := kbassistant.NewStore(pool)

	s, err := st.Get(ctx, kbID, true)
	if err != nil || s.Version != 0 || s.Behavior.Customized || s.StartPageConfigured {
		t.Fatalf("fresh: %+v (%v)", s, err)
	}
	// Saving what was loaded changes nothing and writes no version.
	if s, err = st.Save(ctx, kbID, inputOf(s), owner); err != nil || s.Version != 0 {
		t.Fatalf("no-op save: version %d (%v)", s.Version, err)
	}

	// A title-only save leaves a never-customized behavior NULL: the legacy
	// prompt stays byte for byte.
	in := inputOf(s)
	in.Title = "Nur der Titel"
	if s, err = st.Save(ctx, kbID, in, owner); err != nil || s.Version != 2 || s.Behavior.Customized {
		t.Fatalf("title-only save: %+v (%v)", s, err)
	}
	var stillNull bool
	if err := pool.QueryRow(ctx, `SELECT behavior IS NULL FROM knowledge_bases WHERE id = $1`, kbID).Scan(&stillNull); err != nil || !stillNull {
		t.Fatalf("behavior after a title-only save: null=%v (%v)", stillNull, err)
	}

	cat, err := kbcategories.NewStore(pool).Create(ctx, "it-assistant-cat", 999, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { kbcategories.NewStore(pool).Delete(context.Background(), cat.ID) }) //nolint:errcheck

	in = inputOf(s)
	in.Title = "Neuer Titel"
	in.CategoryID = &cat.ID
	in.Behavior = kbbehavior.Default()
	in.Behavior.ActiveRoleID = "tutor"
	in.StartPage = kbstartpage.Default()
	in.StartPage.Colors = &kbstartpage.Colors{From: "#112233", To: "#445566"}
	if s, err = st.Save(ctx, kbID, in, owner); err != nil || s.Version != 3 || s.Title != "Neuer Titel" ||
		s.CategoryID == nil || *s.CategoryID != cat.ID || !s.StartPageConfigured {
		t.Fatalf("save: %+v (%v)", s, err)
	}

	// A stale base version is a conflict; a non-owner may not rename.
	if _, err := st.Save(ctx, kbID, in, owner); !errors.Is(err, kbassistant.ErrConflict) {
		t.Errorf("stale save: %v", err)
	}
	in.BaseVersion = 3
	in.Title = "Anders"
	if _, err := st.Save(ctx, kbID, in, kbassistant.Author{ID: userID}); !errors.Is(err, kbassistant.ErrRenameForbidden) {
		t.Errorf("rename without right: %v", err)
	}

	vs, err := st.Versions(ctx, kbID)
	if err != nil || len(vs) != 3 || vs[0].Number != 3 || vs[2].Kind != kbassistant.KindBaseline ||
		vs[0].AuthorName != "it-assistant-author" || len(vs[0].Changes) == 0 {
		t.Fatalf("versions: %+v (%v)", vs, err)
	}

	if s, err = st.Restore(ctx, kbID, 1, 3, owner); err != nil || s.Version != 4 || s.Title != "kb-behavior-it" ||
		s.Behavior.Customized || s.StartPageConfigured || s.CategoryID != nil {
		t.Fatalf("restore: %+v (%v)", s, err)
	}
	var behaviorNull, pageNull bool
	var prompt *string
	if err := pool.QueryRow(ctx, `SELECT behavior IS NULL, start_page IS NULL, system_prompt FROM knowledge_bases WHERE id = $1`, kbID).
		Scan(&behaviorNull, &pageNull, &prompt); err != nil {
		t.Fatal(err)
	}
	if !behaviorNull || !pageNull || prompt == nil || *prompt != legacy {
		t.Fatalf("restored columns: behavior null %v, page null %v, prompt %v", behaviorNull, pageNull, prompt)
	}
	vs, _ = st.Versions(ctx, kbID)
	if len(vs) != 4 || vs[0].Kind != kbassistant.KindRestore || vs[0].RestoredFrom == nil || *vs[0].RestoredFrom != 1 {
		t.Fatalf("after restore: %+v", vs)
	}
	if _, err := st.Restore(ctx, kbID, 99, 4, owner); err == nil {
		t.Error("restoring a missing version must error")
	}
}

// The bug of 27.10.2026: a further card switched from the input field to a
// file start (no text) was a save the change list could not name, and it
// was dropped. It is written and read back as a file start.
func TestAssistantSettings_SavesACardKindChange(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	st := kbassistant.NewStore(pool)
	kbID := insertBehaviorKB(t, pool, nil)
	owner := kbassistant.Author{ID: insertUser(t, pool, "it-assistant-kind"), CanRename: true}

	s, err := st.Get(ctx, kbID, true)
	if err != nil {
		t.Fatal(err)
	}
	in := inputOf(s)
	in.Behavior = kbbehavior.Default()
	in.StartPage = kbstartpage.Default()
	in.StartPage.StartMode = kbstartpage.StartRoles
	in.StartPage.RoleStarts = map[string]kbstartpage.EntryStart{"tutor": kbstartpage.DefaultStart()}
	in.StartPage.RoleEntries = []kbstartpage.RoleEntry{{ID: "re-1", RoleID: "tutor"}}
	if s, err = st.Save(ctx, kbID, in, owner); err != nil {
		t.Fatalf("save roles: %v", err)
	}
	in = inputOf(s)
	tutor := in.StartPage.RoleStarts["tutor"]
	tutor.Kind = kbstartpage.EntryFile
	in.StartPage.RoleStarts["tutor"] = tutor
	if s, err = st.Save(ctx, kbID, in, owner); err != nil {
		t.Fatalf("save kind: %v", err)
	}
	got, err := st.Get(ctx, kbID, true)
	if err != nil || got.StartPage.RoleStarts["tutor"].Kind != kbstartpage.EntryFile || got.Version != s.Version {
		t.Fatalf("read back: kind %q, version %d (%v)", got.StartPage.RoleStarts["tutor"].Kind, got.Version, err)
	}
}

// Oracle: optimistic concurrency — of saves racing on the same base version,
// exactly one wins and every other gets ErrConflict (409), never a duplicate
// version number (500).
func TestAssistantSettings_RacingSavesConflict(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	st := kbassistant.NewStore(pool)
	kbID := insertBehaviorKB(t, pool, nil)
	owner := kbassistant.Author{ID: insertUser(t, pool, "it-assistant-race"), CanRename: true}

	base, err := st.Get(ctx, kbID, true)
	if err != nil {
		t.Fatal(err)
	}
	const n = 8
	errs := make(chan error, n)
	for i := range n {
		go func() {
			in := inputOf(base)
			in.Title = fmt.Sprintf("Titel %d", i)
			_, err := st.Save(ctx, kbID, in, owner)
			errs <- err
		}()
	}
	wins := 0
	for range n {
		switch err := <-errs; {
		case err == nil:
			wins++
		case !errors.Is(err, kbassistant.ErrConflict):
			t.Errorf("racing save: %v", err)
		}
	}
	if wins != 1 {
		t.Fatalf("%d saves won, want exactly 1", wins)
	}
}
